import timeline from "./timeline.json";

/** Changuito brand tokens (locked kit — see apps/branding/tokens). */
export const COLORS = {
  espresso: "#2A1A14",
  sunflower: "#F4B942",
  arcilla: "#E07A5F",
  offWhite: "#FAFAF7",
  white: "#FFFFFF",
  // Warm cream background allowed by the brief ("off-white / cream cálido").
  crema: "#F5ECE0",
  // Same values the product UI uses (apps/web/app/globals.css).
  muted: "#4A332C",
  border: "rgba(42, 26, 20, 0.14)",
  ok: "#1A7F4B",
} as const;

export const FONT_FAMILY = "Inter";

/** Keep key content inside these margins on a 1080×1920 canvas. */
export const SAFE = {
  x: 80,
  top: 200,
  bottom: 140,
} as const;

export const CONTENT_WIDTH = timeline.width - SAFE.x * 2;

export const SHADOW = {
  card: "0 36px 90px rgba(42, 26, 20, 0.22), 0 6px 18px rgba(42, 26, 20, 0.10)",
  cardOnDark: "0 40px 100px rgba(0, 0, 0, 0.45)",
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
