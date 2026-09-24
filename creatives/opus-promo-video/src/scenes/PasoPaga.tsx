import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, EASE_IN_OUT, formatARS, SNAPPY, springAt } from "../anim";
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

const TOTAL = 38390;
const SELECT_CARD = 24;
const SELECT_USDC = 40;
const PAY = 56;
const SUCCESS = 72;
const RUN = 80;

const CardIcon: React.FC = () => (
  <svg width={120} height={84} viewBox="0 0 120 84">
    <rect x={3} y={3} width={114} height={78} rx={14} fill={COLORS.espresso} />
    <rect x={3} y={20} width={114} height={14} fill={COLORS.sunflower} />
    <rect
      x={16}
      y={52}
      width={40}
      height={10}
      rx={5}
      fill={COLORS.offWhite}
      opacity={0.8}
    />
  </svg>
);

// Generic coin — deliberately not the issuer's logo.
const CoinIcon: React.FC = () => (
  <svg width={84} height={84} viewBox="0 0 84 84">
    <circle cx={42} cy={42} r={39} fill={COLORS.espresso} />
    <circle
      cx={42}
      cy={42}
      r={30}
      fill="none"
      stroke={COLORS.sunflower}
      strokeWidth={4}
    />
    <text
      x={42}
      y={55}
      textAnchor="middle"
      fontSize={38}
      fontWeight={900}
      fill={COLORS.sunflower}
      fontFamily="Inter"
    >
      $
    </text>
  </svg>
);

export const PasoPaga: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("PasoPaga");

  const cardIn = springAt(frame, fps, 4, { damping: 18, stiffness: 120 });
  // Selection ring glides from "Tarjeta" to "USDC": both work.
  const ringIn = springAt(frame, fps, SELECT_CARD, SNAPPY);
  const ringX = interpolate(frame, [SELECT_USDC, SELECT_USDC + 8], [0, 1], {
    ...CLAMP,
    easing: EASE_IN_OUT,
  });
  const paying = frame >= PAY + 3 && frame < SUCCESS;
  const press = frame >= PAY && frame < PAY + 4 ? 0.95 : 1;
  const success = springAt(frame, fps, SUCCESS, SNAPPY);
  const run = interpolate(frame, [RUN, duration + 4], [-760, 1180], CLAMP);

  const options = [
    { label: "Tarjeta", sub: "crédito o débito", icon: <CardIcon /> },
    { label: "USDC", sub: "dólar digital", icon: <CoinIcon /> },
  ];

  return (
    <SceneShell background={COLORS.sunflower} durationInFrames={duration}>
      <StepTag step={4} label="Pagá" />
      <Headline
        delay={3}
        size={96}
        top={290}
        lines={[
          "PAGÁ CON",
          {
            text: "TARJETA O USDC",
            box: COLORS.espresso,
            ink: COLORS.sunflower,
          },
        ]}
      />

      <Card
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 650,
          height: 780,
          padding: "40px 40px",
          translate: `0 ${(1 - cardIn) * 700}px`,
        }}
      >
        {/* Checkout state */}
        <div
          style={{ opacity: 1 - success, scale: String(1 - 0.08 * success) }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <div
              style={{
                fontSize: 46,
                fontWeight: 900,
                letterSpacing: "-0.02em",
              }}
            >
              ¿Cómo querés pagar?
            </div>
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 600,
              color: COLORS.muted,
              marginTop: 8,
            }}
          >
            Total{" "}
            <b
              style={{
                color: COLORS.espresso,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatARS(TOTAL)}
            </b>
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              gap: 24,
              marginTop: 36,
            }}
          >
            {options.map((o) => (
              <div
                key={o.label}
                style={{
                  flex: 1,
                  height: 280,
                  borderRadius: 32,
                  border: `2px solid ${COLORS.border}`,
                  background: COLORS.offWhite,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 18,
                }}
              >
                <div
                  style={{ height: 90, display: "grid", placeItems: "center" }}
                >
                  {o.icon}
                </div>
                <div style={{ fontSize: 44, fontWeight: 900 }}>{o.label}</div>
                <div
                  style={{ fontSize: 28, fontWeight: 600, color: COLORS.muted }}
                >
                  {o.sub}
                </div>
              </div>
            ))}
            <div
              style={{
                position: "absolute",
                top: -8,
                left: -8,
                width: `calc(50% - 12px + 16px)`,
                height: 296,
                borderRadius: 38,
                border: `7px solid ${COLORS.espresso}`,
                translate: `calc(${ringX} * (100% + 8px)) 0`,
                opacity: ringIn,
                scale: String(1.1 - 0.1 * ringIn),
              }}
            />
          </div>

          <div
            style={{
              marginTop: 40,
              height: 116,
              borderRadius: 999,
              background: COLORS.espresso,
              color: COLORS.offWhite,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              fontSize: 44,
              fontWeight: 800,
              scale: String(press),
            }}
          >
            {paying ? (
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 54,
                  border: `7px solid rgba(250,250,247,0.3)`,
                  borderTopColor: COLORS.sunflower,
                  rotate: `${frame * 24}deg`,
                }}
              />
            ) : (
              <>Pagar {formatARS(TOTAL)}</>
            )}
          </div>
          <div
            style={{
              marginTop: 22,
              fontSize: 30,
              fontWeight: 600,
              color: COLORS.muted,
              textAlign: "center",
            }}
          >
            Pago protegido: si no se completa, te devolvemos.
          </div>
        </div>

        {/* Success state */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 22,
            opacity: success,
            scale: String(0.9 + 0.1 * success),
          }}
        >
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 200,
              background: COLORS.ok,
              display: "grid",
              placeItems: "center",
              scale: String(success),
            }}
          >
            <CheckIcon
              size={150}
              draw={interpolate(
                frame,
                [SUCCESS + 2, SUCCESS + 14],
                [0, 1],
                CLAMP,
              )}
              stroke={11}
            />
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 900,
              letterSpacing: "-0.03em",
              marginTop: 10,
            }}
          >
            ¡Listo!
          </div>
          <div style={{ fontSize: 46, fontWeight: 700 }}>
            Changuito ya empujó.
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, color: COLORS.muted }}>
            Tu pedido está en camino.
          </div>
        </div>
      </Card>

      {/* The changuito heads home */}
      <div style={{ position: "absolute", top: 1480, left: run }}>
        <div style={{ position: "relative" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                right: "96%",
                top: 110 + i * 70,
                width: 180 - i * 40,
                height: 14,
                borderRadius: 14,
                background: COLORS.espresso,
                opacity: 0.35,
              }}
            />
          ))}
          <Mascot
            pose="corriendo"
            height={330}
            style={{
              translate: `0 ${Math.abs(Math.sin(frame / 2.2)) * -10}px`,
            }}
          />
        </div>
      </div>

      <Sfx name="whoosh" at={4} volume={0.35} />
      <Sfx name="tick" at={SELECT_CARD} volume={0.4} />
      <Sfx name="tick" at={SELECT_USDC + 4} volume={0.4} />
      <Sfx name="tap" at={PAY} volume={0.7} />
      <Sfx name="success" at={SUCCESS} volume={0.6} />
      <Sfx name="whoosh" at={RUN + 2} volume={0.55} />
    </SceneShell>
  );
};
