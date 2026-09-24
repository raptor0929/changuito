import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, formatARS, SNAPPY, springAt } from "../anim";
import { Headline } from "../components/Headline";
import { SceneShell, Sfx } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const ITEMS = [
  "Leche",
  "Pan",
  "Yerba",
  "Fideos",
  "Tomates",
  "Aceite",
  "Huevos",
  "Arroz",
  "Queso",
  "Manzanas",
  "Café",
  "Azúcar",
  "Asado",
  "Carbón",
  "Lechuga",
  "Yogur",
  "Papas",
  "Agua",
];

const TABS = [
  { store: "Súper A", price: 5320, x: 1120, y: 160, rot: -6, at: 130 },
  { store: "Súper B", price: 4210, x: 1480, y: 280, rot: 5, at: 148 },
  { store: "Súper C", price: 4650, x: 1160, y: 500, rot: 4, at: 166 },
  { store: "Súper D", price: 4980, x: 1500, y: 640, rot: -4, at: 184 },
];

const NOTES = [
  { text: "La lista eterna.", at: 48 },
  { text: "Precios que se mueven.", at: 128 },
  { text: "Tiempo que no vuelve.", at: 208 },
];

export const Insight: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Insight");
  const paperIn = springAt(frame, fps, 18, { damping: 18, stiffness: 100 });
  const scroll = interpolate(frame, [36, duration], [0, 720], {
    ...CLAMP,
    easing: Easing.in(Easing.quad),
  });
  const minutes = Math.round(interpolate(frame, [200, duration - 8], [8, 47], CLAMP));
  const chaos = interpolate(frame, [150, duration], [0.2, 1.2], CLAMP);

  return (
    <SceneShell background={COLORS.espresso} durationInFrames={duration} push={0.025}>
      <Headline
        delay={4}
        stagger={6}
        size={92}
        color={COLORS.offWhite}
        lines={[
          "EN ARGENTINA,",
          "EL SÚPER ES",
          { text: "OTRO TRABAJO.", box: COLORS.arcilla, ink: COLORS.espresso },
        ]}
      />

      <div style={{ position: "absolute", left: 96, top: 500, width: 860 }}>
        {NOTES.map((note) => {
          const s = springAt(frame, fps, note.at, SNAPPY);
          return (
            <div
              key={note.text}
              style={{
                fontSize: 40,
                fontWeight: 750,
                color: COLORS.offWhite,
                marginTop: 14,
                opacity: Math.min(1, s * 1.2),
                translate: `0 ${(1 - s) * 16}px`,
              }}
            >
              {note.text}
            </div>
          );
        })}
        <div
          style={{
            marginTop: 28,
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 22px",
            borderRadius: 999,
            background: COLORS.sunflower,
            color: COLORS.espresso,
            fontSize: 32,
            fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
            opacity: springAt(frame, fps, 214, SNAPPY),
          }}
        >
          {minutes} minutos
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 72,
          top: 64,
          width: 560,
          height: 960,
          rotate: "-2deg",
          translate: `${(1 - paperIn) * 640}px 0`,
          background: COLORS.offWhite,
          borderRadius: 28,
          overflow: "hidden",
          boxShadow: "0 36px 80px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            padding: "22px 32px 16px",
            fontSize: 30,
            fontWeight: 900,
            borderBottom: `4px solid ${COLORS.arcilla}`,
          }}
        >
          Lista del súper
        </div>
        <div style={{ translate: `0 ${-scroll}px`, padding: "6px 32px" }}>
          {ITEMS.map((item, i) => (
            <div
              key={item}
              style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontSize: 28,
                fontWeight: 650,
                borderBottom: "2px dashed rgba(42,26,20,0.14)",
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `3px solid ${COLORS.espresso}`,
                  background: i % 4 === 1 ? COLORS.espresso : "transparent",
                }}
              />
              {item}
            </div>
          ))}
        </div>
      </div>

      {TABS.map((tab, i) => {
        const s = springAt(frame, fps, tab.at, SNAPPY);
        const wobble = Math.sin((frame + i * 9) / 5) * chaos * 1.4;
        return (
          <div
            key={tab.store}
            style={{
              position: "absolute",
              left: tab.x,
              top: tab.y,
              width: 340,
              padding: "16px 20px 18px",
              borderRadius: 24,
              background: COLORS.offWhite,
              boxShadow: "0 20px 50px rgba(0,0,0,0.38)",
              rotate: `${tab.rot + wobble}deg`,
              scale: String(0.5 + 0.5 * s),
              opacity: Math.min(1, s * 1.4),
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "4px 12px",
                borderRadius: 999,
                background: COLORS.espresso,
                color: COLORS.offWhite,
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              {tab.store}
            </div>
            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 650, color: COLORS.muted }}>
              Yerba 1 kg
            </div>
            <div
              style={{
                fontSize: 44,
                fontWeight: 900,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatARS(tab.price)}
            </div>
          </div>
        );
      })}

      <Sfx name="whoosh" at={16} volume={0.3} />
      {TABS.map((t) => (
        <Sfx key={t.store} name="tap" at={t.at} volume={0.28} />
      ))}
    </SceneShell>
  );
};
