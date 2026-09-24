import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SMOOTH, SNAPPY, springAt } from "../anim";
import { COLORS, FONT_FAMILY, SAFE } from "../theme";

export type HeadlineLine =
  | string
  | {
      text: string;
      box: string;
      ink: string;
    };

type Props = {
  lines: HeadlineLine[];
  delay?: number;
  stagger?: number;
  size?: number;
  color?: string;
  top?: number;
  left?: number;
  right?: number;
  align?: "left" | "center";
};

/**
 * Big uppercase kinetic headline. Plain lines rise out of a mask; highlight
 * lines draw a slightly tilted box first and then drop the text in.
 */
export const Headline: React.FC<Props> = ({
  lines,
  delay = 0,
  stagger = 6,
  size = 96,
  color = COLORS.espresso,
  top = SAFE.top,
  left = SAFE.x,
  right = SAFE.x,
  align = "left",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        right,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: size * 0.04,
        fontFamily: FONT_FAMILY,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 0.98,
        letterSpacing: "-0.03em",
        color,
      }}
    >
      {lines.map((line, i) => {
        const start = delay + i * stagger;
        const rise = springAt(frame, fps, start, SMOOTH);
        const textStyle: React.CSSProperties = {
          display: "block",
          translate: `0 ${(1 - rise) * 110}%`,
          whiteSpace: "nowrap",
        };

        if (typeof line === "string") {
          return (
            <div
              key={i}
              style={{
                overflow: "hidden",
                padding: "0.12em 0.04em 0.02em",
                margin: "-0.12em -0.04em -0.02em",
              }}
            >
              <span style={textStyle}>{line}</span>
            </div>
          );
        }

        const box = springAt(frame, fps, start - 2, SNAPPY);
        const inner = springAt(frame, fps, start + 3, SMOOTH);
        return (
          <div
            key={i}
            style={{
              position: "relative",
              marginTop: size * 0.06,
              rotate: "-1.5deg",
              padding: `${size * 0.08}px ${size * 0.18}px ${size * 0.1}px`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: line.box,
                borderRadius: size * 0.14,
                scale: `${Math.max(0, box)} 1`,
                transformOrigin: align === "center" ? "50% 50%" : "0% 50%",
              }}
            />
            <div
              style={{
                position: "relative",
                overflow: "hidden",
                padding: "0.12em 0.04em 0.02em",
                margin: "-0.12em -0.04em -0.02em",
                color: line.ink,
              }}
            >
              <span
                style={{
                  display: "block",
                  whiteSpace: "nowrap",
                  translate: `0 ${(1 - inner) * 110}%`,
                }}
              >
                {line.text}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
