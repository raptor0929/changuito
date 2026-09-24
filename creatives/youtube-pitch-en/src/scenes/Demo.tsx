import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CLAMP,
  EASE_IN_OUT,
  formatARS,
  progress,
  SNAPPY,
  springAt,
} from "../anim";
import {
  Appear,
  BrandAccent,
  Card,
  Isotipo,
  Mascot,
  MascotPose,
  SceneShell,
  Sfx,
  Wordmark,
} from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const MESSAGE = "Milk, bread, yerba, and fruit for the week.";
const TYPE_FROM = 18;
const TYPE_TO = 78;
const SEND = 86;
const REPLY = 118;

const CHIPS = ["Milk x2", "French bread", "Yerba 1 kg", "Fruit", "Coffee"];

const STORES = [
  { name: "Market A", price: 4980 },
  { name: "Market B", price: 4210, best: true },
  { name: "Market C", price: 4650 },
];

const CART = [
  { name: "Whole milk x2", price: 3780 },
  { name: "French bread", price: 2450 },
  { name: "Yerba 1 kg", price: 4210 },
  { name: "Seasonal fruit", price: 6130 },
  { name: "Coffee", price: 3900 },
  { name: "Eggs x12", price: 4280 },
  { name: "Soft cheese", price: 5960 },
  { name: "Oil", price: 3640 },
  { name: "Pasta", price: 1890 },
  { name: "Dish soap", price: 2150 },
];

const CART_TOTAL = CART.reduce((sum, line) => sum + line.price, 0);

const CHAT_OUT = 280;
const COMPARE_IN = 260;
const COMPARE_OUT = 560;
const CART_IN = 540;

const Caption: React.FC<{
  kicker: string;
  title: string;
  body: string;
  pose: MascotPose;
  at: number;
}> = ({ kicker, title, body, pose, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = springAt(frame, fps, at, SNAPPY);
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        bottom: 28,
        display: "flex",
        alignItems: "flex-end",
        gap: 20,
        opacity: Math.min(1, s * 1.3),
        translate: `0 ${(1 - s) * 16}px`,
      }}
    >
      <Mascot pose={pose} height={150} bob={3} />
      <div>
        <div
          style={{
            display: "inline-block",
            padding: "6px 14px",
            borderRadius: 999,
            background: COLORS.espresso,
            color: COLORS.sunflower,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "0.14em",
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 48,
            fontWeight: 900,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: COLORS.espresso,
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 26,
            fontWeight: 700,
            color: COLORS.muted,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
};

const Chrome: React.FC = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "22px 28px",
      borderBottom: `2px solid ${COLORS.border}`,
      background: COLORS.offWhite,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["#E07A5F", "#F4B942", "#2A1A14"].map((c) => (
          <div
            key={c}
            style={{
              width: 14,
              height: 14,
              borderRadius: 14,
              background: c,
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      <Wordmark width={168} />
    </div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 20,
        fontWeight: 700,
        color: COLORS.muted,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 12,
          background: COLORS.ok,
        }}
      />
      online
    </div>
  </div>
);

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Demo");

  const chat = 1 - progress(frame, CHAT_OUT, CHAT_OUT + 16, EASE_IN_OUT);
  const compare =
    progress(frame, COMPARE_IN, COMPARE_IN + 16, EASE_IN_OUT) *
    (1 - progress(frame, COMPARE_OUT, COMPARE_OUT + 16, EASE_IN_OUT));
  const cart = progress(frame, CART_IN, CART_IN + 16, EASE_IN_OUT);

  const typed = Math.round(
    interpolate(frame, [TYPE_FROM, TYPE_TO], [0, MESSAGE.length], CLAMP),
  );
  const caretOn = Math.floor(frame / 8) % 2 === 0;
  const sendPress = frame >= SEND - 2 && frame < SEND + 5 ? 0.92 : 1;
  const total = Math.round(
    interpolate(frame, [CART_IN + 36, CART_IN + 110], [0, CART_TOTAL], {
      ...CLAMP,
      easing: EASE_IN_OUT,
    }),
  );
  const press = frame >= 760 && frame < 770 ? 0.94 : 1;

  const caption =
    frame < COMPARE_IN + 8
      ? {
          kicker: "IN MOTION",
          title: "Plain language.",
          body: "Talk to it the way you talk at home.",
          pose: "idle" as const,
          at: 6,
        }
      : frame < CART_IN + 8
        ? {
            kicker: "IN MOTION",
            title: "Real prices.",
            body: "The same product. Three stores.",
            pose: "comparando" as const,
            at: COMPARE_IN,
          }
        : {
            kicker: "IN MOTION",
            title: "Before you pay.",
            body: "The cart is ready to confirm.",
            pose: "lleno" as const,
            at: CART_IN,
          };

  return (
    <SceneShell background={COLORS.offWhite} durationInFrames={duration}>
      <BrandAccent
        icon="blob-arcilla"
        size={340}
        style={{ right: -200, top: -160, opacity: 0.45, rotate: "20deg" }}
      />
      <BrandAccent
        icon="pan"
        size={170}
        style={{ left: -60, top: -36, opacity: 0.4, rotate: "-8deg" }}
      />
      <Caption {...caption} />

      <Card
        style={{
          position: "absolute",
          left: 140,
          top: 36,
          width: 1640,
          height: 800,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Chrome />
        <div style={{ position: "relative", flex: 1 }}>
          {/* Chat */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: "28px 32px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
              opacity: chat,
              translate: `${(1 - chat) * -40}px 0`,
              pointerEvents: "none",
            }}
          >
            <Appear
              at={8}
              from="left"
              style={{ display: "flex", gap: 16, alignItems: "flex-start" }}
            >
              <Isotipo size={64} />
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  paddingTop: 12,
                }}
              >
                Hi! What do you need from the store?
              </div>
            </Appear>

            {frame >= SEND ? (
              <Appear
                at={SEND}
                from="right"
                style={{ alignSelf: "flex-end", maxWidth: 640 }}
              >
                <div
                  style={{
                    background: COLORS.espresso,
                    color: COLORS.offWhite,
                    padding: "18px 24px",
                    borderRadius: "28px 28px 8px 28px",
                    fontSize: 30,
                    fontWeight: 600,
                    lineHeight: 1.3,
                  }}
                >
                  {MESSAGE}
                </div>
              </Appear>
            ) : null}

            {frame >= REPLY ? (
              <Appear
                at={REPLY}
                from="left"
                style={{ display: "flex", gap: 16, alignItems: "flex-start" }}
              >
                <Isotipo size={64} />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      marginBottom: 14,
                      paddingTop: 8,
                    }}
                  >
                    On it. Here's what I found:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {CHIPS.map((chip, i) => (
                      <Appear key={chip} at={REPLY + 8 + i * 6}>
                        <div
                          style={{
                            padding: "12px 18px",
                            borderRadius: 999,
                            background: COLORS.crema,
                            border: `2px solid ${COLORS.border}`,
                            fontSize: 24,
                            fontWeight: 800,
                          }}
                        >
                          {chip}
                        </div>
                      </Appear>
                    ))}
                  </div>
                </div>
              </Appear>
            ) : null}

            <div style={{ flex: 1 }} />
            {frame < SEND ? (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "14px 16px 14px 22px",
                  borderRadius: 999,
                  border: `2px solid ${COLORS.border}`,
                  background: COLORS.offWhite,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    fontSize: 28,
                    fontWeight: 600,
                    color: COLORS.espresso,
                    minHeight: 36,
                  }}
                >
                  {MESSAGE.slice(0, typed)}
                  <span style={{ opacity: caretOn ? 1 : 0 }}>|</span>
                </div>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 64,
                    background: COLORS.sunflower,
                    display: "grid",
                    placeItems: "center",
                    scale: String(sendPress),
                    fontSize: 28,
                    fontWeight: 900,
                  }}
                >
                  ↑
                </div>
              </div>
            ) : null}
          </div>

          {/* Compare */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: "36px 32px",
              opacity: compare,
              translate: `${(1 - compare) * 50}px 0`,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.muted }}>
              YERBA MATE 1 KG
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 40,
                fontWeight: 900,
                letterSpacing: "-0.03em",
              }}
            >
              The same product.
            </div>
            <div
              style={{
                marginTop: 28,
                display: "flex",
                gap: 18,
              }}
            >
              {STORES.map((store, i) => {
                const s = springAt(frame, fps, COMPARE_IN + 10 + i * 6, SNAPPY);
                const best = Boolean(store.best);
                return (
                  <div
                    key={store.name}
                    style={{
                      flex: 1,
                      padding: "26px 22px 28px",
                      borderRadius: 28,
                      background: best ? COLORS.sunflower : COLORS.offWhite,
                      border: best
                        ? `3px solid ${COLORS.espresso}`
                        : `2px solid ${COLORS.border}`,
                      scale: String((0.86 + 0.14 * s) * (best ? 1.04 : 1)),
                      opacity: Math.min(1, s * 1.4),
                      translate: best ? "0 -12px" : "0 0",
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 800 }}>
                      {store.name}
                    </div>
                    <div
                      style={{
                        marginTop: 18,
                        fontSize: 52,
                        fontWeight: 900,
                        letterSpacing: "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatARS(store.price)}
                    </div>
                    <div
                      style={{
                        marginTop: 16,
                        fontSize: 20,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        opacity: best ? 1 : 0,
                      }}
                    >
                      BEST PRICE
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cart */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: "28px 32px 24px",
              display: "flex",
              flexDirection: "column",
              opacity: cart,
              translate: `${(1 - cart) * 50}px 0`,
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
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                }}
              >
                Your cart
              </div>
              <div
                style={{
                  fontSize: 42,
                  fontWeight: 900,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.03em",
                }}
              >
                {formatARS(total)}
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
              {CART.map((line, i) => {
                const s = springAt(frame, fps, CART_IN + 8 + i * 3, SNAPPY);
                return (
                  <div
                    key={line.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: `1px solid ${COLORS.border}`,
                      fontSize: 22,
                      fontWeight: 700,
                      opacity: Math.min(1, s * 1.4),
                      translate: `${(1 - s) * 24}px 0`,
                    }}
                  >
                    <span>{line.name}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatARS(line.price)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                marginTop: 16,
                height: 72,
                borderRadius: 999,
                background: COLORS.sunflower,
                color: COLORS.espresso,
                display: "grid",
                placeItems: "center",
                fontSize: 30,
                fontWeight: 900,
                scale: String(press),
                letterSpacing: "-0.02em",
              }}
            >
              Confirm cart
            </div>
          </div>
        </div>
      </Card>

      <Sfx name="tap" at={SEND} volume={0.45} />
      <Sfx name="pop" at={REPLY} volume={0.35} />
      <Sfx name="whoosh" at={COMPARE_IN} volume={0.35} />
      <Sfx name="ding" at={COMPARE_IN + 28} volume={0.4} />
      <Sfx name="whoosh" at={CART_IN} volume={0.35} />
      <Sfx name="tap" at={760} volume={0.5} />
    </SceneShell>
  );
};
