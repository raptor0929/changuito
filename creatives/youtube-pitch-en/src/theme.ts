import timeline from "./timeline.json";

/** Changuito brand tokens. Locked kit — apps/branding/tokens. */
export const COLORS = {
  espresso: "#2A1A14",
  sunflower: "#F4B942",
  arcilla: "#E07A5F",
  offWhite: "#FAFAF7",
  white: "#FFFFFF",
  crema: "#F5ECE0",
  muted: "#4A332C",
  border: "rgba(42, 26, 20, 0.14)",
  ok: "#1A7F4B",
} as const;

export const FONT_FAMILY = "Inter";

/** Keep key type inside this margin on a 1920×1080 frame. */
export const SAFE = {
  x: 96,
  top: 72,
  bottom: 80,
} as const;

export const SHADOW = {
  card: "0 28px 70px rgba(42, 26, 20, 0.18), 0 6px 16px rgba(42, 26, 20, 0.08)",
  cardOnDark: "0 36px 90px rgba(0, 0, 0, 0.42)",
  soft: "0 14px 34px rgba(42, 26, 20, 0.16)",
} as const;

export type SceneId = (typeof timeline.scenes)[number]["id"];

export const sceneDuration = (id: SceneId): number => {
  const scene = timeline.scenes.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown scene ${id}`);
  return scene.durationInFrames;
};

export const TOTAL_FRAMES = timeline.scenes.reduce(
  (sum, s) => sum + s.durationInFrames,
  0,
);

export { timeline };
