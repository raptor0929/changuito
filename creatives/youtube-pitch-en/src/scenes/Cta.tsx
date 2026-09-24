import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress, SMOOTH, SNAPPY, springAt } from "../anim";
import { BrandAccent, Mascot, SceneShell, Sfx, Wordmark } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Cta");
  const mark = springAt(frame, fps, 4, SMOOTH);
  const mascot = springAt(frame, fps, 10, { damping: 14, stiffness: 110 });
  const line = springAt(frame, fps, 28, SMOOTH);
  const pill = springAt(frame, fps, 48, SNAPPY);
  const app = progress(frame, 78, 96);
  const pulse = frame > 70 ? 1 + Math.sin((frame - 70) / 8) * 0.015 : 1;

  return (
    <SceneShell background={COLORS.offWhite} durationInFrames={duration} push={0.015}>
      <BrandAccent
        icon="blob-arcilla"
        size={520}
        style={{ right: -140, top: -160, opacity: 0.45, rotate: "16deg" }}
      />
      <BrandAccent
        icon="blob-espresso"
        size={360}
        style={{ left: -80, bottom: 40, opacity: 0.12, rotate: "-12deg" }}
      />
      <BrandAccent
        icon="mate"
        size={200}
        style={{ left: 90, top: 48, opacity: 0.35, rotate: "-10deg" }}
      />
      <BrandAccent
        icon="pan"
        size={210}
        style={{ right: -36, bottom: -40, opacity: 0.34, rotate: "14deg" }}
      />

      <div
        style={{
          position: "absolute",
          top: 72,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: mark,
        }}
      >
        <Wordmark width={520} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 200,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          translate: `0 ${(1 - mascot) * 80}px`,
        }}
      >
        <Mascot pose="lleno" height={340} bob={frame > 24 ? 5 : 0} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 560,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          color: COLORS.espresso,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: "-0.04em",
            opacity: line,
          }}
        >
          JOIN THE BETA
        </div>
        <div
          style={{
            marginTop: 22,
            padding: "16px 36px",
            borderRadius: 999,
            background: COLORS.sunflower,
            fontSize: 40,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            scale: String(pill * pulse),
            boxShadow: "0 16px 40px rgba(42,26,20,0.12)",
          }}
        >
          www.changuito.me/whitelist
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 28,
            fontWeight: 700,
            color: COLORS.muted,
            opacity: app,
          }}
        >
          app.changuito.me
        </div>
      </div>

      <Sfx name="ding" at={50} volume={0.35} />
      <Sfx name="success" at={78} volume={0.3} />
    </SceneShell>
  );
};
