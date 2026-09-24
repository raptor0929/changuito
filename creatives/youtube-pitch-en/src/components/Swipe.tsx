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

type Props = {
  color: string;
  durationInFrames: number;
  pattern?: boolean;
  direction?: "up" | "left";
};

/**
 * Full-bleed panel that sweeps across a cut. Used as a TransitionSeries
 * overlay: the panel covers the frame around the midpoint, which is where
 * the underlying scenes swap, so the cut is never visible.
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
  const panel = screen * 1.35;
  const pos = interpolate(frame, [0, durationInFrames - 1], [screen, -panel], {
    ...CLAMP,
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const curve = vertical
    ? "50% 50% 50% 50% / 180px 180px 180px 180px"
    : "180px 180px 180px 180px / 50% 50% 50% 50%";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...(vertical
            ? {
                left: -width * 0.15,
                width: width * 1.3,
                height: panel,
                top: pos,
              }
            : {
                top: -height * 0.08,
                height: height * 1.16,
                width: panel,
                left: pos,
              }),
          background: color,
          backgroundImage: pattern
            ? `url(${staticFile("brand/patron-mate-pan.png")})`
            : undefined,
          backgroundSize: pattern ? "960px 540px" : undefined,
          borderRadius: curve,
        }}
      />
    </AbsoluteFill>
  );
};
