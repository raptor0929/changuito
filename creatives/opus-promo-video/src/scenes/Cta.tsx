import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { progress, SMOOTH, SNAPPY, springAt } from "../anim";
import { Mascot, SceneShell, Sfx, Wordmark } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const BUTTON_AT = 34;

export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Cta");

  const mark = springAt(frame, fps, 2, SMOOTH);
  const mascot = springAt(frame, fps, 6, { damping: 11, stiffness: 120 });
  const blob = springAt(frame, fps, 0, SMOOTH);
  const line1 = springAt(frame, fps, 16, SMOOTH);
  const box = springAt(frame, fps, 21, SNAPPY);
  const button = springAt(frame, fps, BUTTON_AT, SNAPPY);
  const url = progress(frame, BUTTON_AT + 8, BUTTON_AT + 20);
  const beta = springAt(frame, fps, BUTTON_AT + 18, SNAPPY);
  const pulse =
    frame > BUTTON_AT + 24
      ? 1 + Math.sin((frame - BUTTON_AT - 24) / 5) * 0.025
      : 1;
  const dot = 0.5 + 0.5 * Math.sin(frame / 4);

  return (
    <SceneShell
      background={COLORS.offWhite}
      durationInFrames={duration}
      push={0.02}
    >
      {/* Soft arcilla blobs, as in the brand IG pieces */}
      <div
        style={{
          position: "absolute",
          right: -220,
          top: -160,
          width: 720,
          height: 560,
          borderRadius: "58% 42% 55% 45% / 52% 60% 40% 48%",
          background: "rgba(224,122,95,0.18)",
          scale: String(blob),
          rotate: `${frame * 0.2}deg`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -260,
          bottom: 260,
          width: 560,
          height: 460,
          borderRadius: "45% 55% 40% 60% / 55% 45% 55% 45%",
          background: "rgba(244,185,66,0.22)",
          scale: String(blob),
          rotate: `${-frame * 0.25}deg`,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 210,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ opacity: mark, scale: String(0.85 + 0.15 * mark) }}>
          <Wordmark width={640} />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 420,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          translate: `0 ${(1 - mascot) * 700}px`,
        }}
      >
        <Mascot pose="lleno" height={600} bob={frame > 24 ? 7 : 0} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 1060,
          left: 80,
          right: 80,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontWeight: 900,
          letterSpacing: "-0.03em",
          color: COLORS.espresso,
          lineHeight: 1.04,
        }}
      >
        <div
          style={{
            fontSize: 108,
            opacity: line1,
            translate: `0 ${(1 - line1) * 40}px`,
          }}
        >
          ARMÁ EL SÚPER
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 108,
            padding: "8px 34px 16px",
            borderRadius: 22,
            background: COLORS.sunflower,
            rotate: "-1.6deg",
            scale: String(box),
          }}
        >
          SIN PENSAR.
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 1400,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "0 60px",
            height: 128,
            borderRadius: 999,
            background: COLORS.espresso,
            color: COLORS.offWhite,
            fontSize: 50,
            fontWeight: 800,
            scale: String(button * pulse),
            boxShadow: "0 24px 50px rgba(42,26,20,0.28)",
          }}
        >
          Probar Changuito
          <svg width={46} height={46} viewBox="0 0 24 24">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              fill="none"
              stroke={COLORS.sunflower}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div
          style={{
            fontSize: 60,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            color: COLORS.espresso,
            opacity: url,
            translate: `0 ${(1 - url) * 20}px`,
          }}
        >
          www.changuito.me
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 30px",
            borderRadius: 999,
            border: `3px solid ${COLORS.espresso}`,
            fontSize: 36,
            fontWeight: 800,
            color: COLORS.espresso,
            scale: String(beta),
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 18,
              background: COLORS.arcilla,
              boxShadow: `0 0 0 ${6 * dot}px rgba(224,122,95,0.3)`,
            }}
          />
          Sumate a la beta
        </div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 600,
            color: COLORS.muted,
            opacity: interpolate(beta, [0, 1], [0, 1]),
          }}
        >
          Pagá con tarjeta o USDC.
        </div>
      </div>

      <Sfx name="whoosh" at={0} volume={0.35} />
      <Sfx name="pop" at={6} volume={0.5} />
      <Sfx name="impact" at={21} volume={0.45} />
      <Sfx name="pop" at={BUTTON_AT} volume={0.5} />
      <Sfx name="ding" at={BUTTON_AT + 18} volume={0.45} />
    </SceneShell>
  );
};
