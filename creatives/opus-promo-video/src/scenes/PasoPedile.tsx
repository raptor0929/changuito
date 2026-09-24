import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, SNAPPY, springAt } from "../anim";
import { Headline } from "../components/Headline";
import {
  Card,
  Isotipo,
  SceneShell,
  Sfx,
  StepTag,
  Wordmark,
} from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const MESSAGE = "Armame un asado para 6 y sumá yerba para la semana.";
const TYPE_FROM = 12;
const TYPE_TO = 46;
const SEND = 49;
const TYPING_FROM = 56;
const REPLY = 72;
const CHIP_STAGGER = 6;
const CHIPS = [
  "Asado 3 kg",
  "Carbón 4 kg",
  "Pan francés",
  "Chimichurri",
  "Yerba 1 kg",
];

const Appear: React.FC<{
  at: number;
  from?: "left" | "right" | "up";
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, from = "up", children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = springAt(frame, fps, at, SNAPPY);
  const dx = from === "left" ? -60 : from === "right" ? 60 : 0;
  const dy = from === "up" ? 40 : 10;
  return (
    <div
      style={{
        opacity: Math.min(1, s * 1.4),
        translate: `${(1 - s) * dx}px ${(1 - s) * dy}px`,
        scale: String(0.85 + 0.15 * s),
        transformOrigin: from === "right" ? "100% 100%" : "0% 100%",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const PasoPedile: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("PasoPedile");

  const cardIn = springAt(frame, fps, 4, { damping: 18, stiffness: 120 });
  const typed = Math.round(
    interpolate(frame, [TYPE_FROM, TYPE_TO], [0, MESSAGE.length], CLAMP),
  );
  const draft = frame < SEND ? MESSAGE.slice(0, typed) : "";
  const caretOn = Math.floor(frame / 8) % 2 === 0;
  const sendPress = frame >= SEND - 2 && frame < SEND + 4 ? 0.86 : 1;

  return (
    <SceneShell background={COLORS.offWhite} durationInFrames={duration}>
      <StepTag step={1} label="Pedile" />
      <Headline
        delay={3}
        size={100}
        top={290}
        lines={[
          "PEDILE COMO",
          { text: "A UN AMIGO", box: COLORS.sunflower, ink: COLORS.espresso },
        ]}
      />

      <Card
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 620,
          height: 1100,
          translate: `0 ${(1 - cardIn) * 700}px`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "30px 40px",
            borderBottom: `2px solid ${COLORS.border}`,
            background: COLORS.offWhite,
          }}
        >
          <Wordmark width={250} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 28,
              fontWeight: 600,
              color: COLORS.muted,
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 16,
                background: COLORS.ok,
              }}
            />
            en línea
          </div>
        </div>

        {/* Thread */}
        <div
          style={{
            flex: 1,
            padding: "36px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 30,
          }}
        >
          <Appear
            at={10}
            from="left"
            style={{ display: "flex", gap: 20, alignItems: "flex-start" }}
          >
            <Isotipo size={72} />
            <div
              style={{
                fontSize: 40,
                fontWeight: 600,
                lineHeight: 1.35,
                paddingTop: 10,
              }}
            >
              ¡Hola! ¿Qué necesitás del súper?
            </div>
          </Appear>

          {frame >= SEND ? (
            <Appear
              at={SEND}
              from="right"
              style={{ alignSelf: "flex-end", maxWidth: 680 }}
            >
              <div
                style={{
                  background: COLORS.espresso,
                  color: COLORS.offWhite,
                  padding: "24px 32px",
                  borderRadius: "36px 36px 8px 36px",
                  fontSize: 40,
                  fontWeight: 500,
                  lineHeight: 1.35,
                }}
              >
                {MESSAGE}
              </div>
            </Appear>
          ) : null}

          {frame >= TYPING_FROM && frame < REPLY ? (
            <Appear
              at={TYPING_FROM}
              from="left"
              style={{ display: "flex", gap: 20, alignItems: "center" }}
            >
              <Isotipo size={72} />
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "22px 28px",
                  borderRadius: 40,
                  background: COLORS.crema,
                }}
              >
                {[0, 1, 2].map((d) => (
                  <div
                    key={d}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 18,
                      background: COLORS.espresso,
                      translate: `0 ${Math.sin((frame - d * 4) / 3) * 6}px`,
                      opacity:
                        0.4 + 0.6 * Math.abs(Math.sin((frame - d * 4) / 5)),
                    }}
                  />
                ))}
              </div>
            </Appear>
          ) : null}

          {frame >= REPLY ? (
            <Appear
              at={REPLY}
              from="left"
              style={{ display: "flex", gap: 20, alignItems: "flex-start" }}
            >
              <Isotipo size={72} />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 40,
                    fontWeight: 600,
                    lineHeight: 1.35,
                    paddingTop: 10,
                  }}
                >
                  ¡De una! Te armo todo con los mejores precios de tu zona:
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 14,
                    marginTop: 22,
                  }}
                >
                  {CHIPS.map((chip, i) => {
                    const s = springAt(
                      frame,
                      fps,
                      REPLY + 8 + i * CHIP_STAGGER,
                      SNAPPY,
                    );
                    return (
                      <div
                        key={chip}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "14px 24px",
                          borderRadius: 999,
                          border: `2px solid ${COLORS.border}`,
                          background: COLORS.offWhite,
                          fontSize: 32,
                          fontWeight: 700,
                          scale: String(s),
                        }}
                      >
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 14,
                            background: COLORS.sunflower,
                          }}
                        />
                        {chip}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Appear>
          ) : null}
        </div>

        {/* Composer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "24px 32px 32px",
            borderTop: `2px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 96,
              borderRadius: 48,
              border: `2px solid ${COLORS.border}`,
              padding: "22px 32px",
              fontSize: 34,
              lineHeight: 1.3,
              color: draft ? COLORS.espresso : "rgba(42,26,20,0.45)",
              fontWeight: 500,
              background: COLORS.white,
            }}
          >
            {draft || (frame < TYPE_FROM ? "Escribile a Changuito…" : "")}
            {frame >= TYPE_FROM && frame < SEND && caretOn ? (
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 38,
                  background: COLORS.espresso,
                  marginLeft: 4,
                  verticalAlign: "middle",
                }}
              />
            ) : null}
          </div>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 96,
              background: COLORS.sunflower,
              display: "grid",
              placeItems: "center",
              scale: String(sendPress),
              flexShrink: 0,
            }}
          >
            <svg width={46} height={46} viewBox="0 0 24 24">
              <path
                d="M12 19V5M5 12l7-7 7 7"
                fill="none"
                stroke={COLORS.espresso}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </Card>

      <Sfx name="whoosh" at={4} volume={0.35} />
      {Array.from({ length: 12 }, (_, i) => TYPE_FROM + i * 3).map((at) => (
        <Sfx key={at} name="tick" at={at} volume={0.22} />
      ))}
      <Sfx name="tap" at={SEND - 2} volume={0.6} />
      <Sfx name="pop" at={SEND} volume={0.5} />
      <Sfx name="pop" at={REPLY} volume={0.45} />
      {CHIPS.map((c, i) => (
        <Sfx
          key={c}
          name="tick"
          at={REPLY + 8 + i * CHIP_STAGGER}
          volume={0.3}
        />
      ))}
    </SceneShell>
  );
};
