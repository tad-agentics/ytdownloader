import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type VideoQuality = "360p" | "480p" | "720p" | "1080p";

const FORMAT: Record<VideoQuality, string> = {
  "360p": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
  "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
  "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
  "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
};

export interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileSizeMB: number;
}

export function downloadYouTubeVideo(
  url: string,
  videoId: string,
  quality: VideoQuality = "720p",
  timeoutMs = 5 * 60 * 1000
): Promise<DownloadResult> {
  const template = path.join(os.tmpdir(), `yt_${videoId}_${Date.now()}.%(ext)s`);
  const args = [
    "--format",
    FORMAT[quality],
    "--merge-output-format",
    "mp4",
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`yt-dlp timeout for ${videoId}`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 300)}`));
      }
      const mp4 = template.replace("%(ext)s", "mp4");
      const mkv = template.replace("%(ext)s", "mkv");
      const p = fs.existsSync(mp4) ? mp4 : fs.existsSync(mkv) ? mkv : null;
      if (!p) return reject(new Error(`Output not found for ${videoId}`));
      const stats = fs.statSync(p);
      resolve({
        filePath: p,
        fileName: path.basename(p),
        fileSizeBytes: stats.size,
        fileSizeMB: Math.round((stats.size / 1024 / 1024) * 10) / 10,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function cleanupTempFile(p: string) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore cleanup errors */
  }
}
