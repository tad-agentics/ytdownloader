export const DEFAULT_SUBTITLE_LANGS = "en,en-orig,en.*";

export const ENGLISH_LANG_PRIORITY = ["en", "en-us", "en-gb", "en-orig"] as const;

export function subtitleLangs(): string {
  return process.env.SUBTITLE_LANGS?.trim() || DEFAULT_SUBTITLE_LANGS;
}

export function isEnglishSubtitleLang(lang: string): boolean {
  const lower = lang.toLowerCase();
  return lower === "en" || lower.startsWith("en-") || lower.startsWith("en.");
}

export function pickEnglishLang(langs: Iterable<string>): string | null {
  const list = Array.from(langs);
  for (const pref of ENGLISH_LANG_PRIORITY) {
    const hit = list.find(
      (lang) =>
        lang.toLowerCase() === pref ||
        lang.toLowerCase().startsWith(`${pref}-`) ||
        lang.toLowerCase().startsWith(pref)
    );
    if (hit) return hit;
  }
  return list.find((lang) => isEnglishSubtitleLang(lang)) ?? null;
}
