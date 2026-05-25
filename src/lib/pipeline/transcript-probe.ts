import { spawn } from "child_process";
import { getYtdlpCookiesPath } from "./ytdlp-cookies";
import { pickEnglishLang } from "./subtitle-languages";

const PLAYER_CLIENTS = ["android_vr,tv,ios,android", "mweb,web_safari,web"];

const PROBE_TIMEOUT_MS = 12_000;
const FAST_PROBE_TIMEOUT_MS = 12_000;
const MAX_PROBE_BATCH = 4;

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
    if (!trimmed || /^language\b/i.test(trimmed) || /^available\b/i.test(trimmed)) continue;
    const match = trimmed.match(/^([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\b/i);
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
  playerClients: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<string | null> {
  const args = [...baseArgs(playerClients), "--list-subs", url];
  const { stdout, stderr } = await runYtdlp(args, videoId, timeoutMs, {
    allowNonZeroExit: true,
  });
  const langs = parseListSubsOutput(`${stdout}\n${stderr}`);
  return pickEnglishLang(langs);
}

async function runDumpJsonProbe(
  url: string,
  videoId: string,
  playerClients: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<string | null> {
  const args = [...baseArgs(playerClients), "--dump-json", url];
  const { stdout } = await runYtdlp(args, videoId, timeoutMs);
  const data = JSON.parse(stdout) as {
    subtitles?: Record<string, unknown>;
    automatic_captions?: Record<string, unknown>;
  };
  return pickLangFromTracks(data.subtitles, data.automatic_captions);
}

async function runProbeOnce(
  url: string,
  videoId: string,
  playerClients: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<string | null> {
  try {
    return await runDumpJsonProbe(url, videoId, playerClients, timeoutMs);
  } catch {
    return runListSubsProbe(url, videoId, playerClients, timeoutMs);
  }
}

const PROBE_RETRIES = 1;
const PROBE_RETRY_DELAY_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function probeTranscriptAvailability(
  url: string,
  videoId: string,
  opts: { fast?: boolean } = {}
): Promise<{ available: boolean; lang: string | null; checked: boolean }> {
  if (opts.fast) {
    try {
      const lang = await runProbeOnce(url, videoId, PLAYER_CLIENTS[0], FAST_PROBE_TIMEOUT_MS);
      return { available: lang !== null, lang, checked: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Fast transcript probe failed for ${videoId}, retrying full probe: ${message}`);
    }
  }

  let lastError = "probe failed";

  for (let attempt = 0; attempt <= PROBE_RETRIES; attempt++) {
    if (attempt > 0) await sleep(PROBE_RETRY_DELAY_MS * attempt);

    for (const clients of PLAYER_CLIENTS) {
      try {
        const lang = await runProbeOnce(url, videoId, clients, PROBE_TIMEOUT_MS);
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
  opts: { concurrency?: number; fast?: boolean } = {}
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
      let probe = await probeTranscriptAvailability(video.url, video.videoId, {
        fast: opts.fast,
      });
      if (!probe.checked && opts.fast) {
        probe = await probeTranscriptAvailability(video.url, video.videoId, {
          fast: false,
        });
      }
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

export async function filterToEnglishTranscripts<
  T extends { videoId: string; url: string },
>(
  videos: T[],
  targetCount: number
): Promise<{
  videos: Array<T & { transcriptAvailable: true; transcriptLang: string | null }>;
  excludedNoCc: number;
  probesFailed: number;
}> {
  if (!videos.length || targetCount <= 0) {
    return { videos: [], excludedNoCc: 0, probesFailed: 0 };
  }

  const out: Array<T & { transcriptAvailable: true; transcriptLang: string | null }> = [];
  let excludedNoCc = 0;
  let probesFailed = 0;

  for (const video of videos) {
    if (out.length >= targetCount) break;

    let probe = await probeTranscriptAvailability(video.url, video.videoId, { fast: true });
    if (!probe.checked) {
      probe = await probeTranscriptAvailability(video.url, video.videoId, { fast: false });
    }

    if (!probe.checked) {
      probesFailed++;
      continue;
    }
    if (probe.available && probe.lang) {
      out.push({
        ...video,
        transcriptAvailable: true,
        transcriptLang: probe.lang,
      });
    } else {
      excludedNoCc++;
    }
  }

  return { videos: out, excludedNoCc, probesFailed };
}

export { MAX_PROBE_BATCH };
