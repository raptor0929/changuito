import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress, SMOOTH, SNAPPY, springAt } from "../anim";
import { Mascot, SceneShell, Sfx, Wordmark } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const NOTS = [
  { text: "No es un exchange.", at: 96 },
  { text: "No es un comparador.", at: 118 },
];

export const Promesa: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Promesa");
  const mark = springAt(frame, fps, 4, SMOOTH);
  const a = springAt(frame, fps, 16, SMOOTH);
  const b = progress(frame, 48, 68);
  const ride = springAt(frame, fps, 10, { damping: 16, stiffness: 90, mass: 1 });

  return (
    <SceneShell background={COLORS.sunflower} durationInFrames={duration} push={0.03}>
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 80,
          opacity: mark,
        }}
      >
        <Wordmark width={420} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 100,
          top: 250,
          width: 780,
          color: COLORS.espresso,
        }}
      >
        <div
          style={{
            fontSize: 92,
            fontWeight: 900,
            letterSpacing: "-0.045em",
            lineHeight: 0.95,
            opacity: a,
            translate: `0 ${(1 - a) * 30}px`,
          }}
        >
          Te arma
          <br />
          el súper.
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.3,
            maxWidth: 720,
            opacity: b,
          }}
        >
          Pedís en natural. Compara precios reales.
          <br />
          Confirmás antes de pagar.
        </div>
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 14 }}>
          {NOTS.map((n) => {
            const s = springAt(frame, fps, n.at, SNAPPY);
            return (
              <div
                key={n.text}
                style={{
                  alignSelf: "flex-start",
                  padding: "12px 22px",
                  borderRadius: 16,
                  background: COLORS.espresso,
                  color: COLORS.sunflower,
                  fontSize: 32,
                  fontWeight: 800,
                  opacity: Math.min(1, s * 1.3),
                  scale: String(0.92 + 0.08 * s),
                  transformOrigin: "0% 50%",
                }}
              >
                {n.text}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: -30,
          translate: `${(1 - ride) * 220}px 0`,
        }}
      >
        <Mascot pose="comparando" height={540} bob={frame > 30 ? 4 : 0} />
      </div>

      <Sfx name="impact" at={16} volume={0.45} />
      <Sfx name="pop" at={98} volume={0.3} />
      <Sfx name="pop" at={120} volume={0.3} />
    </SceneShell>
  );
};
