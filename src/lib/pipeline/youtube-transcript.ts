import fs from "fs";

export type TranscriptCue = {
  startMs: number;
  endMs: number;
  text: string;
};

/** Format seconds like the YouTube transcript panel (e.g. 43:46 or 1:05:12). */
export function formatYoutubeTimestamp(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function parseSrtTimestamp(raw: string): number {
  const m = raw.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  const hours = +(m[1] || 0);
  const minutes = +m[2];
  const seconds = +m[3];
  const millis = +m[4].padEnd(3, "0").slice(0, 3);
  return ((hours * 3600 + minutes * 60 + seconds) * 1000 + millis) | 0;
}

export function parseSrt(content: string): TranscriptCue[] {
  const blocks = content.replace(/\r/g, "").split(/\n\n+/);
  const cues: TranscriptCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const [startRaw, endRaw] = timeLine.split("-->").map((s) => s.trim());
    const text = lines
      .filter((l) => l !== timeLine && !/^\d+$/.test(l))
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!text) continue;

    cues.push({
      startMs: parseSrtTimestamp(startRaw),
      endMs: parseSrtTimestamp(endRaw),
      text,
    });
  }

  return cues.sort((a, b) => a.startMs - b.startMs);
}

/** Collapse rolling auto-caption cues into stable blocks like the YouTube UI. */
export function collapseRollingCaptions(cues: TranscriptCue[]): TranscriptCue[] {
  const out: TranscriptCue[] = [];
  let i = 0;

  const norm = (text: string) => text.replace(/\s+/g, " ").trim();

  while (i < cues.length) {
    let j = i;
    let best = cues[i];
    let bestText = norm(best.text);

    while (j + 1 < cues.length) {
      const cur = norm(cues[j].text);
      const next = norm(cues[j + 1].text);
      if (!next || (!next.startsWith(cur) && cur !== next)) break;
      j++;
      const candidate = norm(cues[j].text);
      if (candidate.length >= bestText.length) {
        best = cues[j];
        bestText = candidate;
      }
    }

    if (bestText) {
      out.push({
        startMs: cues[i].startMs,
        endMs: best.endMs,
        text: bestText,
      });
    }

    i = j + 1;
  }

  return out;
}

export function srtToYoutubeTranscriptText(srtContent: string, opts: { header?: string } = {}): string {
  const collapsed = collapseRollingCaptions(parseSrt(srtContent));
  const blocks: string[] = [];

  if (opts.header) {
    blocks.push(opts.header);
  }

  for (const cue of collapsed) {
    const stamp = formatYoutubeTimestamp(cue.startMs / 1000);
    blocks.push(`${stamp}\n${cue.text}`);
  }

  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

export function srtFileToYoutubeTranscriptText(
  srtPath: string,
  opts: { header?: string } = {}
): string {
  return srtToYoutubeTranscriptText(fs.readFileSync(srtPath, "utf8"), opts);
}
