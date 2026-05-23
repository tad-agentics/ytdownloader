import fs from "fs";
import os from "os";
import path from "path";

let cachedCookiesPath: string | null | undefined;

export function isYtdlpCookiesConfigured(): boolean {
  return getYtdlpCookiesPath() !== null;
}

export function getYtdlpCookiesPath(): string | null {
  if (cachedCookiesPath !== undefined) return cachedCookiesPath;

  const filePath = process.env.YT_DLP_COOKIES_FILE?.trim();
  if (filePath && fs.existsSync(filePath)) {
    cachedCookiesPath = filePath;
    return cachedCookiesPath;
  }

  const b64 = process.env.YT_DLP_COOKIES_B64?.trim();
  if (b64) {
    const dest = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
    fs.writeFileSync(dest, Buffer.from(b64, "base64").toString("utf8"));
    cachedCookiesPath = dest;
    return cachedCookiesPath;
  }

  cachedCookiesPath = null;
  return null;
}
