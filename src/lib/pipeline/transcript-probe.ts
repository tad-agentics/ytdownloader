import { spawn } from "child_process";
import { getYtdlpCookiesPath } from "./ytdlp-cookies";
import { pickEnglishLang } from "./subtitle-languages";

const PLAYER_CLIENTS = ["android_vr,tv,ios,android", "mweb,web_safari,web"];

const PROBE_TIMEOUT_MS = 12_000;
const MAX_PROBE_BATCH = 12;

function pickLangFromTracks(
  subtitles: Record<string, unknown> | undefined,
  automaticCaptions: Record<string, unknown> | undefined
): string | null {
  const langs = [
    ...Object.keys(subtitles || {}),
    ...Object.keys(automaticCaptions || {}),
  ];
  return pickEnglishLang(langs);
}

function parseListSubsOutput(output: string): string[] {
  const langs: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\s+/i);
    if (match) langs.push(match[1]);
  }
  return langs;
}

function isBotBlockError(message: string): boolean {
  return /not a bot|Sign in to confirm|bot check|HTTP Error 403/i.test(message);
}

function runYtdlp(
  args: string[],
  videoId: string,
  timeoutMs: number,
  opts: { allowNonZeroExit?: boolean } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
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
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const combined = `${stdout}\n${stderr}`;
      if (opts.allowNonZeroExit && parseListSubsOutput(combined).length > 0) {
        resolve({ stdout, stderr, code: exitCode });
        return;
      }
      if (exitCode !== 0) {
        reject(new Error(`yt-dlp probe exit ${exitCode}: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function baseArgs(playerClients: string): string[] {
  const args = [
    "--skip-download",
    "--no-warnings",
    "--quiet",
    "--no-playlist",
    "--socket-timeout",
    "10",
    "--extractor-args",
    `youtube:player_client=${playerClients}`,
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ];
  const cookiesPath = getYtdlpCookiesPath();
  if (cookiesPath) args.push("--cookies", cookiesPath);
  return args;
}

async function runListSubsProbe(
  url: string,
  videoId: string,
  playerClients: string
): Promise<string | null> {
  const args = [...baseArgs(playerClients), "--list-subs", url];
  const { stdout, stderr } = await runYtdlp(args, videoId, PROBE_TIMEOUT_MS, {
    allowNonZeroExit: true,
  });
  const langs = parseListSubsOutput(`${stdout}\n${stderr}`);
  return pickEnglishLang(langs);
}

async function runDumpJsonProbe(
  url: string,
  videoId: string,
  playerClients: string
): Promise<string | null> {
  const args = [...baseArgs(playerClients), "--dump-json", url];
  const { stdout } = await runYtdlp(args, videoId, PROBE_TIMEOUT_MS);
  const data = JSON.parse(stdout) as {
    subtitles?: Record<string, unknown>;
    automatic_captions?: Record<string, unknown>;
  };
  return pickLangFromTracks(data.subtitles, data.automatic_captions);
}

async function runProbeOnce(url: string, videoId: string, playerClients: string): Promise<string | null> {
  try {
    return await runListSubsProbe(url, videoId, playerClients);
  } catch {
    return runDumpJsonProbe(url, videoId, playerClients);
  }
}

const PROBE_RETRIES = 2;
const PROBE_RETRY_DELAY_MS = 900;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function probeTranscriptAvailability(
  url: string,
  videoId: string
): Promise<{ available: boolean; lang: string | null; checked: boolean }> {
  let lastError = "probe failed";

  for (let attempt = 0; attempt <= PROBE_RETRIES; attempt++) {
    if (attempt > 0) await sleep(PROBE_RETRY_DELAY_MS * attempt);

    for (const clients of PLAYER_CLIENTS) {
      try {
        const lang = await runProbeOnce(url, videoId, clients);
        return { available: lang !== null, lang, checked: true };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!isBotBlockError(lastError)) break;
      }
    }
  }

  console.warn(`Transcript probe failed for ${videoId}: ${lastError}`);
  return { available: false, lang: null, checked: false };
}

export async function enrichVideosWithTranscriptAvailability<
  T extends { videoId: string; url: string },
>(
  videos: T[],
  opts: { concurrency?: number } = {}
): Promise<
  Array<
    T & {
      transcriptAvailable: boolean | null;
      transcriptLang: string | null;
    }
  >
> {
  if (!videos.length) return [];

  const concurrency = Math.min(Math.max(opts.concurrency ?? 1, 1), 2);
  const out: Array<
    T & { transcriptAvailable: boolean | null; transcriptLang: string | null }
  > = [];
  let index = 0;

  async function worker() {
    while (index < videos.length) {
      const i = index++;
      const video = videos[i];
      const probe = await probeTranscriptAvailability(video.url, video.videoId);
      out[i] = {
        ...video,
        transcriptAvailable: probe.checked ? probe.available : null,
        transcriptLang: probe.checked ? probe.lang : null,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, videos.length) }, () => worker()));

  return out;
}

export { MAX_PROBE_BATCH };
