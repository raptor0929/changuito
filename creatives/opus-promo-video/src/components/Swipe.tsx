import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CLAMP } from "../anim";
import { COLORS } from "../theme";

type Props = {
  color: string;
  durationInFrames: number;
  /** Fill the panel with the canonical mate + pan pattern. */
  pattern?: boolean;
  direction?: "up" | "left";
};

/**
 * Full-bleed panel that sweeps across a cut. Used as a TransitionSeries
 * overlay: the panel fully covers the frame around the midpoint, which is
 * exactly where the underlying scenes swap, so the cut is never visible.
 */
export const Swipe: React.FC<Props> = ({
  color,
  durationInFrames,
  pattern = false,
  direction = "up",
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = direction === "up";
  const screen = vertical ? height : width;
  const panel = screen * 1.6;
  // A mild in-out keeps the panel covering the frame for ~3 frames around the
  // cut; a steeper curve whips through and flashes the incoming scene early.
  const pos = interpolate(frame, [0, durationInFrames - 1], [screen, -panel], {
    ...CLAMP,
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const curve = vertical
    ? "50% 50% 50% 50% / 260px 260px 260px 260px"
    : "260px 260px 260px 260px / 50% 50% 50% 50%";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...(vertical
            ? {
                left: -width * 0.25,
                width: width * 1.5,
                height: panel,
                top: pos,
              }
            : {
                top: -height * 0.1,
                height: height * 1.2,
                width: panel,
                left: pos,
              }),
          background: color,
          backgroundImage: pattern
            ? `url(${staticFile("brand/patron-mate-pan.png")})`
            : undefined,
          backgroundSize: pattern ? "1280px 720px" : undefined,
          borderRadius: curve,
          boxShadow: `0 0 0 1px ${COLORS.border}`,
        }}
      />
    </AbsoluteFill>
  );
};
