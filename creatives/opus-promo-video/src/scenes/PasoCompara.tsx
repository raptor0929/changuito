import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, EASE_OUT, formatARS, SNAPPY, springAt } from "../anim";
import { Headline } from "../components/Headline";
import { Card, Mascot, SceneShell, Sfx, StepTag } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const ROWS = [
  { store: "Súper A", price: 5320 },
  { store: "Súper B", price: 4980 },
  { store: "Súper C", price: 4590 },
];
const MAX = Math.max(...ROWS.map((r) => r.price));
const BEST = ROWS.length - 1;
const ROW_AT = 16;
const PICK = 60;
const SAVINGS = MAX - ROWS[BEST].price;

export const PasoCompara: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("PasoCompara");

  const cardIn = springAt(frame, fps, 4, { damping: 18, stiffness: 120 });
  const pick = springAt(frame, fps, PICK, SNAPPY);
  const saving = springAt(frame, fps, PICK + 12, SNAPPY);
  const more = springAt(frame, fps, PICK + 22, SNAPPY);
  const mascot = springAt(frame, fps, PICK + 8, {
    damping: 12,
    stiffness: 120,
  });

  return (
    <SceneShell background={COLORS.espresso} durationInFrames={duration}>
      <StepTag step={2} label="Compará" dark />
      <Headline
        delay={3}
        size={96}
        top={290}
        color={COLORS.offWhite}
        lines={[
          "COMPARÁ",
          {
            text: "PRECIOS REALES",
            box: COLORS.sunflower,
            ink: COLORS.espresso,
          },
        ]}
      />

      <Card
        onDark
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 640,
          padding: "40px 40px 44px",
          translate: `0 ${(1 - cardIn) * 700}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div
            style={{ fontSize: 50, fontWeight: 900, letterSpacing: "-0.02em" }}
          >
            Yerba mate 1 kg
          </div>
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: COLORS.muted,
            marginTop: 6,
          }}
        >
          Mismo producto, 3 súper cerca tuyo
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            marginTop: 34,
          }}
        >
          {ROWS.map((row, i) => {
            const at = ROW_AT + i * 6;
            const s = springAt(frame, fps, at, SNAPPY);
            const fill = interpolate(
              frame,
              [at + 2, at + 30],
              [0, row.price / MAX],
              { ...CLAMP, easing: EASE_OUT },
            );
            const shown = fill * MAX;
            const isBest = i === BEST;
            // 0.65 keeps the losing rows at ≥4.5:1 on white (scripts/check-contrast.mjs).
            const dim = isBest ? 1 : interpolate(pick, [0, 1], [1, 0.65]);
            return (
              <div
                key={row.store}
                style={{
                  position: "relative",
                  padding: "24px 28px",
                  borderRadius: 28,
                  border: `4px solid ${isBest ? `rgba(244,185,66,${pick})` : "transparent"}`,
                  background: isBest
                    ? `rgba(244,185,66,${0.18 * pick})`
                    : "transparent",
                  opacity: Math.min(1, s * 1.4) * dim,
                  translate: `${(1 - s) * 80}px 0`,
                  scale: isBest ? String(1 + 0.03 * pick) : "1",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      fontSize: 38,
                      fontWeight: 800,
                    }}
                  >
                    {row.store}
                    {isBest ? (
                      <div
                        style={{
                          padding: "8px 18px",
                          borderRadius: 999,
                          background: COLORS.sunflower,
                          fontSize: 26,
                          fontWeight: 900,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          scale: String(pick),
                        }}
                      >
                        Mejor precio
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 50,
                      fontWeight: 900,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {formatARS(Math.round(shown / 10) * 10)}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 16,
                    height: 22,
                    borderRadius: 22,
                    background: "rgba(42,26,20,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${fill * 100}%`,
                      height: "100%",
                      borderRadius: 22,
                      background: isBest ? COLORS.sunflower : COLORS.espresso,
                      opacity: isBest ? 1 : 0.75,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 30,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 38,
            fontWeight: 800,
            opacity: saving,
            translate: `0 ${(1 - saving) * 20}px`,
          }}
        >
          Ahorrás
          <span
            style={{
              background: COLORS.sunflower,
              padding: "4px 16px",
              borderRadius: 12,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatARS(SAVINGS)}
          </span>
          en este producto
        </div>
      </Card>

      <div
        style={{
          position: "absolute",
          left: 80,
          top: 1500,
          padding: "20px 34px",
          borderRadius: 999,
          background: "rgba(250,250,247,0.1)",
          border: "3px solid rgba(250,250,247,0.25)",
          color: COLORS.offWhite,
          fontSize: 38,
          fontWeight: 800,
          opacity: more,
          scale: String(0.8 + 0.2 * more),
          transformOrigin: "0% 50%",
        }}
      >
        + 11 productos comparados
      </div>

      <div
        style={{
          position: "absolute",
          right: 10,
          top: 1500,
          translate: `${(1 - mascot) * 500}px ${(1 - mascot) * 200}px`,
          rotate: `${(1 - mascot) * 25}deg`,
        }}
      >
        <Mascot pose="comparando" height={400} bob={4} />
      </div>

      <Sfx name="whoosh" at={4} volume={0.35} />
      {ROWS.map((r, i) => (
        <Sfx key={r.store} name="pop" at={ROW_AT + i * 6} volume={0.35} />
      ))}
      <Sfx name="ding" at={PICK} volume={0.55} />
      <Sfx name="pop" at={PICK + 12} volume={0.4} />
      <Sfx name="whoosh" at={PICK + 6} volume={0.3} />
      <Sfx name="tick" at={PICK + 22} volume={0.3} />
    </SceneShell>
  );
};
