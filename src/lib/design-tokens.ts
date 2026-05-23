export const tokens = {
  font: { sans: "'DM Sans', sans-serif", mono: "'DM Mono', monospace" },
  color: {
    bg: "#e8e9eb",
    card: "#ffffff",
    header: "#111111",
    teal: "#7fd4d8",
    tealLight: "#c4eaec",
    tealDark: "#1a5c60",
    cardGray: "#d4d5d8",
    cardBlack: "#111111",
    border: "#e2e2e2",
    border2: "#d0d0d0",
    amber: "#f59e0b",
    purple: "#a78bfa",
    muted: "#888888",
    hint: "#aaaaaa",
    text: "#111111",
    failed: "#fca5a5",
    success: "#4ade80",
    warn: "#fb923c",
  },
};

/** CSS custom properties injected in layout — single source of truth for dashboard styling */
export function cssRootBlock(): string {
  const c = tokens.color;
  const f = tokens.font;
  return `:root {
  --black: ${c.header};
  --white: ${c.card};
  --bg: ${c.bg};
  --teal: ${c.teal};
  --teal-lt: ${c.tealLight};
  --teal-dk: ${c.tealDark};
  --tx: ${c.text};
  --tx2: ${c.muted};
  --tx3: ${c.hint};
  --bdr: ${c.border};
  --bdr2: ${c.border2};
  --amber: ${c.amber};
  --purple: ${c.purple};
  --failed: ${c.failed};
  --f: ${f.sans};
  --m: ${f.mono};
}`;
}
