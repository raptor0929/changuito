import { Audio } from "@remotion/media";
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CLAMP, SNAPPY, springAt } from "../anim";
import { COLORS, FONT_FAMILY, SAFE, SHADOW } from "../theme";

// ------------------------------------------------------------------ scene

type SceneShellProps = {
  background: string;
  durationInFrames: number;
  children: React.ReactNode;
  /** Slow camera push across the scene; keeps static moments alive. */
  push?: number;
};

export const SceneShell: React.FC<SceneShellProps> = ({
  background,
  durationInFrames,
  children,
  push = 0.035,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ background, fontFamily: FONT_FAMILY, overflow: "hidden" }}
    >
      <AbsoluteFill
        style={{
          scale: interpolate(
            frame,
            [0, durationInFrames],
            [1, 1 + push],
            CLAMP,
          ),
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ brand

export type MascotPose = "idle" | "lleno" | "comparando" | "corriendo";

/** Canonical mascot PNGs from the brand pack. Never redrawn. */
export const Mascot: React.FC<{
  pose: MascotPose;
  height: number;
  style?: React.CSSProperties;
  /** Gentle idle bob in px. */
  bob?: number;
}> = ({ pose, height, style, bob = 0 }) => {
  const frame = useCurrentFrame();
  return (
    <Img
      src={staticFile(`brand/mascot/${pose}@2x.png`)}
      style={{
        height,
        width: "auto",
        display: "block",
        translate: `0 ${Math.sin(frame / 7) * bob}px`,
        ...style,
      }}
    />
  );
};

/** The canonical lettering PNG. The name is never set in a generic font. */
export const Wordmark: React.FC<{
  width: number;
  style?: React.CSSProperties;
}> = ({ width, style }) => (
  <Img
    src={staticFile("brand/wordmark@2x.png")}
    style={{ width, height: "auto", display: "block", ...style }}
  />
);

export const Isotipo: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size,
      background: COLORS.crema,
      border: `2px solid ${COLORS.border}`,
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
      flexShrink: 0,
    }}
  >
    <Img
      src={staticFile("brand/isotipo-mascot@2x.png")}
      style={{ height: size * 0.82, width: "auto", marginTop: size * 0.08 }}
    />
  </div>
);

// ------------------------------------------------------------------ chrome

export const StepTag: React.FC<{
  step: number;
  label: string;
  delay?: number;
  dark?: boolean;
}> = ({ step, label, delay = 0, dark = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = springAt(frame, fps, delay, SNAPPY);
  return (
    <div
      style={{
        position: "absolute",
        top: SAFE.top - 40,
        left: SAFE.x,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "12px 30px 12px 12px",
        borderRadius: 999,
        background: dark ? COLORS.offWhite : COLORS.espresso,
        color: dark ? COLORS.espresso : COLORS.offWhite,
        fontSize: 36,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        opacity: s,
        scale: String(0.6 + 0.4 * s),
        transformOrigin: "0% 50%",
      }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 58,
          background: COLORS.sunflower,
          color: COLORS.espresso,
          display: "grid",
          placeItems: "center",
          fontSize: 34,
          fontWeight: 900,
          letterSpacing: 0,
        }}
      >
        {step}
      </div>
      {label}
    </div>
  );
};

export const Card: React.FC<{
  style?: React.CSSProperties;
  children: React.ReactNode;
  onDark?: boolean;
}> = ({ style, children, onDark = false }) => (
  <div
    style={{
      background: COLORS.white,
      borderRadius: 44,
      border: `2px solid ${COLORS.border}`,
      boxShadow: onDark ? SHADOW.cardOnDark : SHADOW.card,
      overflow: "hidden",
      color: COLORS.espresso,
      ...style,
    }}
  >
    {children}
  </div>
);

export const CheckIcon: React.FC<{
  size: number;
  color?: string;
  stroke?: number;
  draw?: number;
}> = ({ size, color = COLORS.offWhite, stroke = 10, draw = 1 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    style={{ display: "block" }}
  >
    <path
      d="M22 53 L42 72 L79 31"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - draw}
    />
  </svg>
);

// ------------------------------------------------------------------ audio

export type SfxName =
  | "pop"
  | "tick"
  | "tap"
  | "whoosh"
  | "impact"
  | "ding"
  | "success";

// Headroom for the sum of music + effects; at 1.0 the drop clips.
const SFX_GAIN = 0.8;

/** One-shot sound effect at a scene-relative frame. */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number }> = ({
  name,
  at,
  volume = 0.6,
}) => (
  <Sequence from={at} layout="none" name={`sfx:${name}`}>
    <Audio
      src={staticFile(`audio/sfx/${name}.wav`)}
      volume={volume * SFX_GAIN}
    />
  </Sequence>
);
