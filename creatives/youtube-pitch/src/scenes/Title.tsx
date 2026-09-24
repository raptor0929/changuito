import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress, SMOOTH, SNAPPY, springAt } from "../anim";
import { BrandAccent, Mascot, SceneShell, Sfx, Wordmark } from "../components/ui";
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
      <BrandAccent
        icon="blob-arcilla"
        size={620}
        style={{ right: -160, top: -180, opacity: 0.55, rotate: "-18deg" }}
      />
      <BrandAccent
        icon="pan"
        size={280}
        style={{ left: -40, bottom: -30, opacity: 0.28, rotate: "12deg" }}
      />
      <BrandAccent
        icon="mate"
        size={220}
        style={{ right: 80, top: 36, opacity: 0.22, rotate: "-8deg" }}
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
