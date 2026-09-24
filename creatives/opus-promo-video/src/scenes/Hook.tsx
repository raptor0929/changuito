import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, SNAPPY, springAt } from "../anim";
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
  "Huevos x 12",
  "Arroz",
  "Detergente",
  "Galletitas",
  "Queso cremoso",
  "Manzanas",
  "Papel higiénico",
  "Café",
  "Azúcar",
  "Harina",
  "Carne para el asado",
  "Carbón",
  "Lechuga",
  "Jabón en polvo",
  "Dulce de leche",
  "Pañales",
  "Yogur",
  "Papas",
  "Cebolla",
  "Esponjas",
  "Mermelada",
  "Agua x 6",
];

const ROW = 86;

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Hook");

  const paperIn = springAt(frame, fps, 14, { damping: 18, stiffness: 110 });
  // The list scrolls slowly, then keeps speeding up: it never ends.
  const scroll = interpolate(frame, [26, duration], [0, 1850], {
    ...CLAMP,
    easing: Easing.in(Easing.cubic),
  });
  const count = Math.round(
    interpolate(frame, [26, duration - 6], [4, 47], CLAMP),
  );
  const counterIn = springAt(frame, fps, 40, SNAPPY);

  return (
    <SceneShell background={COLORS.espresso} durationInFrames={duration}>
      <Headline
        delay={2}
        stagger={6}
        size={112}
        color={COLORS.offWhite}
        lines={[
          "¿OTRA VEZ",
          "LA LISTA",
          { text: "ETERNA", box: COLORS.arcilla, ink: COLORS.espresso },
          "DEL SÚPER?",
        ]}
      />

      {/* The paper list */}
      <div
        style={{
          position: "absolute",
          left: 150,
          width: 780,
          top: 820,
          height: 1500,
          rotate: "-3deg",
          translate: `0 ${(1 - paperIn) * 1100}px`,
          background: COLORS.offWhite,
          borderRadius: 28,
          boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "40px 56px 22px",
            fontSize: 46,
            fontWeight: 900,
            color: COLORS.espresso,
            borderBottom: `4px solid ${COLORS.arcilla}`,
            background: COLORS.offWhite,
            position: "relative",
            zIndex: 1,
          }}
        >
          Lista del súper
        </div>
        <div style={{ translate: `0 ${-scroll}px`, padding: "18px 56px" }}>
          {ITEMS.map((item, i) => {
            const checked = i % 5 === 1 || i % 7 === 3;
            return (
              <div
                key={item}
                style={{
                  height: ROW,
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                  fontSize: 44,
                  fontWeight: 600,
                  color: COLORS.espresso,
                  borderBottom: "2px dashed rgba(42,26,20,0.15)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    border: `4px solid ${COLORS.espresso}`,
                    background: checked ? COLORS.espresso : "transparent",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    textDecoration: checked ? "line-through" : "none",
                    textDecorationThickness: 4,
                    opacity: checked ? 0.65 : 1,
                  }}
                >
                  {item}
                </span>
              </div>
            );
          })}
        </div>
        {/* fade the bottom of the paper into the page */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 640,
            bottom: 0,
            background: `linear-gradient(to bottom, rgba(42,26,20,0), ${COLORS.espresso} 480px)`,
          }}
        />
      </div>

      {/* Item counter */}
      <div
        style={{
          position: "absolute",
          right: 80,
          top: 780,
          padding: "18px 32px",
          borderRadius: 999,
          background: COLORS.arcilla,
          color: COLORS.espresso,
          fontSize: 44,
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          rotate: "4deg",
          scale: String(counterIn),
          boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
        }}
      >
        {count} cosas
      </div>

      {[2, 8, 14, 20].map((at) => (
        <Sfx key={at} name="pop" at={at} volume={0.35} />
      ))}
      <Sfx name="whoosh" at={12} volume={0.45} />
      {Array.from({ length: 12 }, (_, i) => 44 + i * 6).map((at) => (
        <Sfx key={`t${at}`} name="tick" at={at} volume={0.18} />
      ))}
    </SceneShell>
  );
};
