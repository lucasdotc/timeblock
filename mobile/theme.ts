// Hex approximations of the web app's OKLCH dark-teal palette (RN doesn't
// support oklch() color strings).
export const C = {
  bg: "#0e1417",
  surface: "#161f23",
  surface2: "#1e292f",
  surface3: "#26333a",
  line: "#2b3a41",
  lineStrong: "#394b53",
  ink: "#e9eef0",
  muted: "#94a4a9",
  faint: "#6d7f85",
  accent: "#3cc4ca",
  accentInk: "#08191b",
  ok: "#4fca8b",
  warn: "#e2b65c",
  err: "#eb746b",
};

// Curated categorical block hues (hex), stable per task title.
const BLOCK = ["#3a6a9e", "#6d5bb0", "#3f9a6a", "#a58033", "#b0605c", "#9a5aa0", "#4a7fb0", "#5a9a55"];
export function blockColor(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return BLOCK[h % BLOCK.length];
}
