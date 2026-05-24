import { spawn } from "child_process";
import { getYtdlpCookiesPath } from "./ytdlp-cookies";

const LANG_PRIORITY = ["en", "en-us", "en-gb", "vi", "vi-vn"];

const PLAYER_CLIENTS = [
  "android_vr,tv,ios,android",
  "mweb,web_safari,web",
  "web_embedded",
];

const PROBE_TIMEOUT_MS = 45_000;
const PROBE_CONCURRENCY = 3;

function pickLangFromTracks(
  subtitles: Record<string, unknown> | undefined,
  automaticCaptions: Record<string, unknown> | undefined
): string | null {
  const langs = new Set([
    ...Object.keys(subtitles || {}),
    ...Object.keys(automaticCaptions || {}),
  ]);

  for (const pref of LANG_PRIORITY) {
    for (const lang of Array.from(langs)) {
      const lower = lang.toLowerCase();
      if (lower === pref || lower.startsWith(`${pref}-`) || lower.startsWith(pref)) {
        return lang;
      }
    }
  }

  return langs.size > 0 ? Array.from(langs)[0] : null;
}

function runProbeOnce(url: string, videoId: string, playerClients: string): Promise<string | null> {
  const args = [
    "--dump-json",
    "--skip-download",
    "--no-warnings",
    "--quiet",
    "--extractor-args",
    `youtube:player_client=${playerClients}`,
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ];

  const cookiesPath = getYtdlpCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, {
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`transcript probe timeout for ${videoId}`));
    }, PROBE_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp probe exit ${code}: ${stderr.slice(0, 300)}`));
        return;
      }

      try {
        const data = JSON.parse(stdout) as {
          subtitles?: Record<string, unknown>;
          automatic_captions?: Record<string, unknown>;
        };
        resolve(pickLangFromTracks(data.subtitles, data.automatic_captions));
      } catch {
        reject(new Error(`Invalid probe JSON for ${videoId}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function probeTranscriptAvailability(
  url: string,
  videoId: string
): Promise<{ available: boolean; lang: string | null }> {
  let lastError = "probe failed";

  for (const clients of PLAYER_CLIENTS) {
    try {
      const lang = await runProbeOnce(url, videoId, clients);
      return { available: lang !== null, lang };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  console.warn(`Transcript probe failed for ${videoId}: ${lastError}`);
  return { available: false, lang: null };
}

export async function enrichVideosWithTranscriptAvailability<
  T extends { videoId: string; url: string },
>(videos: T[]): Promise<Array<T & { transcriptAvailable: boolean; transcriptLang: string | null }>> {
  if (!videos.length) return [];

  const out: Array<T & { transcriptAvailable: boolean; transcriptLang: string | null }> = [];
  let index = 0;

  async function worker() {
    while (index < videos.length) {
      const i = index++;
      const video = videos[i];
      const probe = await probeTranscriptAvailability(video.url, video.videoId);
      out[i] = {
        ...video,
        transcriptAvailable: probe.available,
        transcriptLang: probe.lang,
      };
    }
  }

  const workers = Math.min(PROBE_CONCURRENCY, videos.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return out;
}
