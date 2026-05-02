// Pinky theme tokens for unir-cli. Used in human-mode output only;
// JSON mode is always colorless. Heredado de la idea del banner gradient
// de cligentic con palette pink (Tailwind pink-500/300/700).

import pc from "picocolors";

const ansi = (rgb: [number, number, number]) => (s: string) =>
  `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${s}\x1b[0m`;

export const PINK = ansi([236, 72, 153]); // pink-500
export const PINK_SOFT = ansi([249, 168, 212]); // pink-300
export const PINK_DEEP = ansi([190, 24, 93]); // pink-700

export const theme = {
  primary: PINK,
  soft: PINK_SOFT,
  deep: PINK_DEEP,
  muted: pc.dim,
  ok: pc.green,
  warn: pc.yellow,
  err: pc.red,
  bold: pc.bold,
  emoji: {
    bullet: "❀",
    spark: "✿",
    flower: "❁",
  },
};

export const BANNER_GRADIENT: [string, string] = ["#EC4899", "#BE185D"]; // pink-500 → pink-700
