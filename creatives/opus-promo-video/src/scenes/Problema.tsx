import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, formatARS, SNAPPY, springAt } from "../anim";
import { Headline } from "../components/Headline";
import { SceneShell, Sfx } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const TABS = [
  { store: "Súper A", price: 5320, x: 90, y: 780, rot: -7, at: 16 },
  { store: "Súper B", price: 4980, x: 560, y: 840, rot: 6, at: 23 },
  { store: "Súper C", price: 5150, x: 120, y: 1140, rot: 5, at: 30 },
  { store: "Súper D", price: 4590, x: 540, y: 1200, rot: -5, at: 37 },
];

export const Problema: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Problema");

  // Wobble grows with time: the more tabs, the more chaos.
  const chaos = interpolate(frame, [40, duration], [0.4, 1.6], CLAMP);
  const minutes = Math.round(
    interpolate(frame, [44, duration - 8], [5, 45], CLAMP),
  );
  const clockIn = springAt(frame, fps, 46, SNAPPY);

  return (
    <SceneShell background={COLORS.espresso} durationInFrames={duration}>
      <Headline
        delay={2}
        stagger={6}
        size={108}
        color={COLORS.offWhite}
        lines={[
          "¿Y COMPARAR",
          "PRECIOS",
          { text: "A MANO?", box: COLORS.arcilla, ink: COLORS.espresso },
        ]}
      />

      {TABS.map((tab, i) => {
        const s = springAt(frame, fps, tab.at, SNAPPY);
        const wobble = Math.sin((frame + i * 11) / 4.2) * chaos * 2.4;
        const jitter = Math.sin((frame + i * 7) / 2.1) * chaos * 3;
        return (
          <div
            key={tab.store}
            style={{
              position: "absolute",
              left: tab.x,
              top: tab.y,
              width: 430,
              padding: "28px 34px 30px",
              borderRadius: 32,
              background: COLORS.offWhite,
              color: COLORS.espresso,
              boxShadow: "0 30px 70px rgba(0,0,0,0.45)",
              rotate: `${tab.rot + wobble}deg`,
              translate: `${jitter}px ${(1 - s) * 80}px`,
              scale: String(0.4 + 0.6 * s),
              opacity: Math.min(1, s * 1.5),
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "8px 20px",
                borderRadius: 999,
                background: COLORS.espresso,
                color: COLORS.offWhite,
                fontSize: 30,
                fontWeight: 800,
              }}
            >
              {tab.store}
            </div>
            <div
              style={{
                fontSize: 34,
                fontWeight: 600,
                color: COLORS.muted,
                marginTop: 18,
              }}
            >
              Yerba mate 1 kg
            </div>
            <div
              style={{
                fontSize: 80,
                fontWeight: 900,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
                marginTop: 4,
              }}
            >
              {formatARS(tab.price)}
            </div>
          </div>
        );
      })}

      {/* Minutes counter */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 1560,
          display: "flex",
          justifyContent: "center",
          opacity: clockIn,
          scale: String(0.7 + 0.3 * clockIn),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "22px 40px 22px 26px",
            borderRadius: 999,
            background: "rgba(250,250,247,0.1)",
            border: "3px solid rgba(250,250,247,0.25)",
            color: COLORS.offWhite,
            fontSize: 48,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <svg width={64} height={64} viewBox="0 0 64 64">
            <circle
              cx={32}
              cy={32}
              r={27}
              fill="none"
              stroke={COLORS.sunflower}
              strokeWidth={6}
            />
            <line
              x1={32}
              y1={32}
              x2={32}
              y2={14}
              stroke={COLORS.sunflower}
              strokeWidth={6}
              strokeLinecap="round"
              style={{
                transformOrigin: "32px 32px",
                rotate: `${frame * 24}deg`,
              }}
            />
            <circle cx={32} cy={32} r={4} fill={COLORS.sunflower} />
          </svg>
          Ya van {minutes} minutos…
        </div>
      </div>

      {[2, 8, 14].map((at) => (
        <Sfx key={at} name="pop" at={at} volume={0.35} />
      ))}
      {TABS.map((t) => (
        <Sfx key={t.store} name="tap" at={t.at} volume={0.45} />
      ))}
    </SceneShell>
  );
};
