import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { downloadTimeoutMs } from "./duration-limits";
import { getYtdlpCookiesPath } from "./ytdlp-cookies";

export type VideoQuality = "360p" | "480p" | "720p" | "1080p";

const FORMAT: Record<VideoQuality, string> = {
  "360p": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
  "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
  "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
  "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
};

const LANG_PRIORITY = ["en", "en-us", "en-gb", "vi", "vi-vn"];

const PLAYER_CLIENTS = [
  "android_vr,tv,ios,android",
  "mweb,web_safari,web",
  "web_embedded",
];

export interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileSizeMB: number;
  transcriptPath: string | null;
  transcriptLang: string | null;
}

function subtitleLangs(): string {
  return process.env.SUBTITLE_LANGS?.trim() || "en,vi,en.*,vi.*";
}

function isBotBlockError(message: string): boolean {
  return /not a bot|Sign in to confirm|bot check|HTTP Error 403/i.test(message);
}

function pickSubtitleFile(stemPath: string): { filePath: string; lang: string } | null {
  const dir = path.dirname(stemPath);
  const stem = path.basename(stemPath);
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\.([^.]+)\\.srt$`, "i");

  const candidates = fs
    .readdirSync(dir)
    .map((name) => {
      const match = name.match(pattern);
      if (!match) return null;
      return { filePath: path.join(dir, name), lang: match[1].toLowerCase() };
    })
    .filter((entry): entry is { filePath: string; lang: string } => entry !== null);

  if (!candidates.length) return null;

  for (const pref of LANG_PRIORITY) {
    const hit = candidates.find(
      (c) => c.lang === pref || c.lang.startsWith(`${pref}-`) || c.lang.startsWith(pref)
    );
    if (hit) return hit;
  }

  return candidates[0];
}

function runYtdlpOnce(
  url: string,
  videoId: string,
  quality: VideoQuality,
  playerClients: string,
  stemPath: string,
  effectiveTimeout: number
): Promise<DownloadResult> {
  const template = `${stemPath}.%(ext)s`;
  const args = [
    "--format",
    FORMAT[quality],
    "--merge-output-format",
    "mp4",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    subtitleLangs(),
    "--convert-subs",
    "srt",
    "--extractor-args",
    `youtube:player_client=${playerClients}`,
    "--output",
    template,
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--no-part",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--concurrent-fragments",
    "4",
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
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`yt-dlp timeout for ${videoId}`));
    }, effectiveTimeout);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 400)}`));
      }
      const mp4 = `${stemPath}.mp4`;
      const mkv = `${stemPath}.mkv`;
      const p = fs.existsSync(mp4) ? mp4 : fs.existsSync(mkv) ? mkv : null;
      if (!p) return reject(new Error(`Output not found for ${videoId}`));
      const stats = fs.statSync(p);
      const subtitle = pickSubtitleFile(stemPath);
      resolve({
        filePath: p,
        fileName: path.basename(p),
        fileSizeBytes: stats.size,
        fileSizeMB: Math.round((stats.size / 1024 / 1024) * 10) / 10,
        transcriptPath: subtitle?.filePath ?? null,
        transcriptLang: subtitle?.lang ?? null,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function downloadYouTubeVideo(
  url: string,
  videoId: string,
  quality: VideoQuality = "720p",
  durationSeconds = 0,
  timeoutMs?: number
): Promise<DownloadResult> {
  const stamp = Date.now();
  const stemPath = path.join(os.tmpdir(), `yt_${videoId}_${stamp}`);
  const effectiveTimeout = timeoutMs ?? downloadTimeoutMs(durationSeconds);
  let lastError = "yt-dlp failed";

  for (const clients of PLAYER_CLIENTS) {
    try {
      return await runYtdlpOnce(url, videoId, quality, clients, stemPath, effectiveTimeout);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!isBotBlockError(lastError)) {
        throw err instanceof Error ? err : new Error(lastError);
      }
    }
  }

  throw new Error(lastError);
}

export function cleanupTempFile(p: string) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore cleanup errors */
  }
}

export function cleanupTempSubtitleStem(stemPath: string) {
  const dir = path.dirname(stemPath);
  const stem = path.basename(stemPath);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(stem) && name.endsWith(".srt")) {
        cleanupTempFile(path.join(dir, name));
      }
    }
  } catch {
    /* ignore cleanup errors */
  }
}
