import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CLAMP,
  EASE_OUT,
  formatARS,
  progress,
  SNAPPY,
  springAt,
} from "../anim";
import { Headline } from "../components/Headline";
import {
  Card,
  CheckIcon,
  Mascot,
  SceneShell,
  Sfx,
  StepTag,
} from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const LINES = [
  { qty: "3 kg", name: "Asado de tira", amount: 21600 },
  { qty: "1", name: "Carbón 4 kg", amount: 6200 },
  { qty: "1 kg", name: "Pan francés", amount: 2900 },
  { qty: "1", name: "Yerba mate 1 kg", amount: 4590 },
  { qty: "1", name: "Chimichurri", amount: 3100 },
];
const TOTAL = LINES.reduce((sum, l) => sum + l.amount, 0);
const LINE_AT = 14;
const TAP = 74;
const CONFIRMED = TAP + 5;

export const PasoConfirma: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("PasoConfirma");

  const cardIn = springAt(frame, fps, 4, { damping: 18, stiffness: 120 });
  const total = interpolate(frame, [LINE_AT + 6, LINE_AT + 44], [0, TOTAL], {
    ...CLAMP,
    easing: EASE_OUT,
  });
  const cursor = springAt(frame, fps, TAP - 16, {
    damping: 20,
    stiffness: 140,
  });
  const press = frame >= TAP && frame < TAP + 5 ? 0.95 : 1;
  const ripple = progress(frame, TAP, TAP + 16);
  const done = springAt(frame, fps, CONFIRMED, SNAPPY);
  const mascot = springAt(frame, fps, CONFIRMED + 4, {
    damping: 11,
    stiffness: 130,
  });
  const confirmed = frame >= CONFIRMED;

  return (
    <SceneShell background={COLORS.crema} durationInFrames={duration}>
      <StepTag step={3} label="Confirmá" />
      <Headline
        delay={3}
        size={100}
        top={290}
        lines={[
          "CONFIRMÁ",
          { text: "TU CARRITO", box: COLORS.arcilla, ink: COLORS.espresso },
        ]}
      />

      <Card
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 640,
          translate: `0 ${(1 - cardIn) * 700}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "34px 40px",
            borderBottom: `2px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{ fontSize: 48, fontWeight: 900, letterSpacing: "-0.02em" }}
          >
            Tu carrito
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.muted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Súper C · 5 productos
          </div>
        </div>

        <div style={{ padding: "18px 0" }}>
          {LINES.map((line, i) => {
            const s = springAt(frame, fps, LINE_AT + i * 5, SNAPPY);
            return (
              <div
                key={line.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr auto",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "14px 40px",
                  fontSize: 38,
                  fontWeight: 600,
                  opacity: Math.min(1, s * 1.4),
                  translate: `${(1 - s) * 120}px 0`,
                }}
              >
                <span
                  style={{
                    color: COLORS.muted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {line.qty}
                </span>
                <span>{line.name}</span>
                <span
                  style={{
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatARS(line.amount)}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: "26px 40px 40px",
            borderTop: `2px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontSize: 42, fontWeight: 700 }}>Total</span>
            <span
              style={{
                fontSize: 64,
                fontWeight: 900,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatARS(Math.round(total / 10) * 10)}
            </span>
          </div>

          <div
            style={{
              position: "relative",
              marginTop: 28,
              height: 116,
              borderRadius: 999,
              background: confirmed ? COLORS.espresso : COLORS.sunflower,
              color: confirmed ? COLORS.offWhite : COLORS.espresso,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              fontSize: 44,
              fontWeight: 800,
              scale: String(press),
              overflow: "hidden",
            }}
          >
            {/* tap ripple */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 1000,
                height: 1000,
                marginLeft: -500,
                marginTop: -500,
                borderRadius: 1000,
                background: "rgba(42,26,20,0.25)",
                scale: String(ripple),
                opacity: frame >= TAP ? 1 - ripple : 0,
              }}
            />
            {confirmed ? (
              <>
                <div style={{ scale: String(done) }}>
                  <CheckIcon size={60} draw={done} />
                </div>
                Carrito confirmado
              </>
            ) : (
              "Confirmar carrito"
            )}
          </div>
        </div>
      </Card>

      {/* Finger / cursor */}
      <div
        style={{
          position: "absolute",
          left: 600,
          top: 1545,
          width: 74,
          height: 74,
          borderRadius: 74,
          background: "rgba(42,26,20,0.28)",
          border: `5px solid ${COLORS.offWhite}`,
          translate: `${(1 - cursor) * 260}px ${(1 - cursor) * 320}px`,
          opacity:
            frame < TAP + 14
              ? cursor
              : interpolate(frame, [TAP + 14, TAP + 22], [1, 0], CLAMP),
          scale: String(press),
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 40,
          top: 1490,
          translate: `0 ${(1 - mascot) * 500}px`,
          rotate: `${(1 - mascot) * -12}deg`,
        }}
      >
        <Mascot pose="lleno" height={380} bob={5} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 330,
          top: 1600,
          padding: "18px 30px",
          borderRadius: "30px 30px 30px 8px",
          background: COLORS.espresso,
          color: COLORS.offWhite,
          fontSize: 40,
          fontWeight: 800,
          scale: String(springAt(frame, fps, CONFIRMED + 12, SNAPPY)),
          transformOrigin: "0% 100%",
        }}
      >
        ¡Todo adentro!
      </div>

      <Sfx name="whoosh" at={4} volume={0.35} />
      {LINES.map((l, i) => (
        <Sfx key={l.name} name="tick" at={LINE_AT + i * 5} volume={0.35} />
      ))}
      <Sfx name="tap" at={TAP} volume={0.7} />
      <Sfx name="ding" at={CONFIRMED} volume={0.55} />
      <Sfx name="pop" at={CONFIRMED + 12} volume={0.45} />
    </SceneShell>
  );
};
