import { Easing, interpolate, spring, SpringConfig } from "remotion";

export const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

/** Snappy UI spring: small overshoot, settles in ~15 frames at 30fps. */
export const SNAPPY: Partial<SpringConfig> = {
  damping: 13,
  stiffness: 170,
  mass: 0.7,
};

/** No overshoot — for masks and bars that must not exceed their target. */
export const SMOOTH: Partial<SpringConfig> = {
  damping: 200,
  stiffness: 120,
};

/** Heavy slam used by the promise headline. */
export const SLAM: Partial<SpringConfig> = {
  damping: 16,
  stiffness: 260,
  mass: 0.9,
};

export const springAt = (
  frame: number,
  fps: number,
  delay = 0,
  config: Partial<SpringConfig> = SNAPPY,
) => spring({ frame: frame - delay, fps, config });

/** Linear 0→1 progress between two frames, clamped. */
export const progress = (
  frame: number,
  from: number,
  to: number,
  easing: (t: number) => number = EASE_OUT,
) => interpolate(frame, [from, to], [0, 1], { ...CLAMP, easing });

/** Decaying shake used after impacts. Returns a pixel offset. */
export const shake = (frame: number, at: number, strength = 14, seed = 1) => {
  const t = frame - at;
  if (t < 0 || t > 14) return 0;
  const decay = Math.exp(-t / 3.5);
  return Math.sin(t * 2.6 + seed * 1.7) * strength * decay;
};

/** Argentine peso formatting: $38.390 */
export const formatARS = (value: number) =>
  `$${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
