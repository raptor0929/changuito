import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress, SMOOTH, SNAPPY, springAt } from "../anim";
import { Mascot, SceneShell, Sfx, Wordmark } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Title");

  const mark = springAt(frame, fps, 4, SMOOTH);
  const ride = springAt(frame, fps, 8, {
    damping: 15,
    stiffness: 90,
    mass: 1,
  });
  const line = springAt(frame, fps, 28, SMOOTH);
  const box = springAt(frame, fps, 40, SNAPPY);
  const url = progress(frame, 62, 80);

  return (
    <SceneShell background={COLORS.offWhite} durationInFrames={duration} push={0.02}>
      <div
        style={{
          position: "absolute",
          right: -160,
          top: -80,
          width: 640,
          height: 480,
          borderRadius: "58% 42% 55% 45% / 52% 60% 40% 48%",
          background: "rgba(244,185,66,0.28)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -180,
          bottom: -80,
          width: 520,
          height: 380,
          borderRadius: "45% 55% 40% 60%",
          background: "rgba(224,122,95,0.16)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 110,
          top: 120,
          width: 900,
        }}
      >
        <div style={{ clipPath: `inset(-20% ${(1 - mark) * 100}% -20% 0)` }}>
          <Wordmark width={540} />
        </div>
        <div
          style={{
            marginTop: 48,
            color: COLORS.espresso,
            fontWeight: 900,
            letterSpacing: "-0.045em",
            lineHeight: 0.92,
          }}
        >
          <div
            style={{
              fontSize: 80,
              opacity: line,
              translate: `0 ${(1 - line) * 24}px`,
            }}
          >
            ARMÁ EL SÚPER
          </div>
          <div
            style={{
              marginTop: 16,
              display: "inline-block",
              padding: "8px 26px 14px",
              borderRadius: 18,
              background: COLORS.sunflower,
              fontSize: 76,
              rotate: "-1.2deg",
              scale: String(0.86 + 0.14 * box),
              opacity: box,
              transformOrigin: "0% 50%",
            }}
          >
            SIN PENSAR.
          </div>
          <div
            style={{
              marginTop: 36,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "0.01em",
              opacity: url,
            }}
          >
            www.changuito.me
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 90,
          bottom: 0,
          translate: `${(1 - ride) * 180}px 0`,
        }}
      >
        <Mascot pose="idle" height={520} bob={frame > 36 ? 5 : 0} />
      </div>

      <Sfx name="whoosh" at={6} volume={0.35} />
      <Sfx name="ding" at={42} volume={0.35} />
    </SceneShell>
  );
};
