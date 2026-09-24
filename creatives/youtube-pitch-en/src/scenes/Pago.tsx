import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CLAMP,
  EASE_IN_OUT,
  formatARS,
  formatUSDC,
  progress,
  SNAPPY,
  springAt,
} from "../anim";
import { BrandAccent, SceneShell, Sfx } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const OPEN_END = 78;
const FUND_AT = 210;
const CARD_AT = 330;
const CONFIRM_AT = 470;
const SHRED_AT = 520;
const OWN_AT = 585;
const WHY_AT = 660;

const ADDRESS = "GB7X ···· M9KQ";
const ARS = 38390;
const USDC = 24.8;

const Pill: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({
  children,
  dark = false,
}) => (
  <div
    style={{
      padding: "8px 16px",
      borderRadius: 999,
      background: dark ? COLORS.espresso : COLORS.sunflower,
      color: dark ? COLORS.sunflower : COLORS.espresso,
      fontSize: 22,
      fontWeight: 800,
      letterSpacing: "0.08em",
    }}
  >
    {children}
  </div>
);

const TempCard: React.FC<{ shred: number }> = ({ shred }) => {
  const half = (side: "left" | "right") => {
    const dir = side === "left" ? -1 : 1;
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: side === "left" ? "inset(0 50% 0 0)" : "inset(0 0 0 50%)",
          translate: `${dir * shred * 70}px ${shred * 10}px`,
          rotate: `${dir * shred * 7}deg`,
          opacity: 1 - shred * 0.85,
        }}
      >
        <CardFace />
      </div>
    );
  };
  return (
    <div style={{ position: "relative", width: 560, height: 340 }}>
      {half("left")}
      {half("right")}
    </div>
  );
};

const CardFace: React.FC<{ own?: boolean }> = ({ own = false }) => (
  <div
    style={{
      width: 560,
      height: 340,
      borderRadius: 28,
      background: own ? COLORS.offWhite : COLORS.espresso,
      color: own ? COLORS.espresso : COLORS.offWhite,
      padding: "28px 32px",
      boxShadow: "0 30px 70px rgba(0,0,0,0.28)",
      border: own ? `3px solid ${COLORS.espresso}` : "none",
      display: "flex",
      flexDirection: "column",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.16em" }}>
        {own ? "DEBIT" : "DISPOSABLE"}
      </div>
      <div
        style={{
          width: 54,
          height: 40,
          borderRadius: 8,
          background: own ? COLORS.sunflower : COLORS.sunflower,
        }}
      />
    </div>
    <div style={{ flex: 1 }} />
    <div
      style={{
        fontSize: 36,
        fontWeight: 800,
        letterSpacing: "0.12em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {own ? "•••• •••• •••• 4412" : "•••• •••• •••• 4821"}
    </div>
    <div
      style={{
        marginTop: 16,
        display: "flex",
        justifyContent: "space-between",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: "0.08em",
      }}
    >
      <span>{own ? "THE CARD YOU HAVE" : "ONE CHARGE"}</span>
      <span>{own ? "NO USDC" : "THEN GONE"}</span>
    </div>
  </div>
);

export const Pago: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Pago");

  const open = 1 - progress(frame, OPEN_END - 12, OPEN_END + 8, EASE_IN_OUT);
  const stage = progress(frame, OPEN_END - 10, OPEN_END + 10, EASE_IN_OUT);
  const why = progress(frame, WHY_AT, WHY_AT + 16, EASE_IN_OUT);

  const funded = progress(frame, FUND_AT, FUND_AT + 46, EASE_IN_OUT);
  const balance = interpolate(funded, [0, 1], [0, 50]);
  const charged = progress(frame, CONFIRM_AT + 8, CONFIRM_AT + 36, EASE_IN_OUT);
  const shownBalance = interpolate(charged, [0, 1], [balance, 50 - USDC]);
  const shred = progress(frame, SHRED_AT, SHRED_AT + 22, EASE_IN_OUT);
  const cardIn = springAt(frame, fps, CARD_AT, SNAPPY);
  const ownIn = springAt(frame, fps, OWN_AT, SNAPPY);
  const typed = Math.round(
    interpolate(frame, [OPEN_END + 8, OPEN_END + 46], [0, ADDRESS.length], CLAMP),
  );
  const pressFund = frame >= FUND_AT - 4 && frame < FUND_AT + 6 ? 0.94 : 1;
  const pressPay = frame >= CONFIRM_AT && frame < CONFIRM_AT + 6 ? 0.94 : 1;

  const walletOn = frame < CARD_AT + 20;
  const cardOn = frame >= CARD_AT - 4 && frame < OWN_AT + 10;
  const ownOn = frame >= OWN_AT - 4 && frame < WHY_AT + 8;

  const caption =
    frame < FUND_AT
      ? { title: "We set up the wallet.", sub: "Pollar · Stellar · USDC" }
      : frame < CARD_AT
        ? { title: "You fund it.", sub: "Whenever you want. In USDC." }
        : frame < CONFIRM_AT
          ? { title: "A disposable card.", sub: "The exact amount, locked." }
          : frame < OWN_AT
            ? { title: "You confirm.", sub: "USDC is charged. The card is discarded." }
            : { title: "Or the card you already have.", sub: "No crypto. Same cart." };

  return (
    <SceneShell background={COLORS.espresso} durationInFrames={duration} push={0.02}>
      <BrandAccent
        icon="blob-arcilla"
        size={640}
        style={{ right: -180, bottom: -180, opacity: 0.35, rotate: "24deg" }}
      />
      <BrandAccent
        icon="blob-arcilla"
        size={280}
        style={{ left: -60, top: -40, opacity: 0.28, rotate: "-16deg" }}
      />
      {/* Cold open */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "0 120px",
          opacity: open * (1 - why),
          color: COLORS.offWhite,
          fontWeight: 900,
          letterSpacing: "-0.045em",
          lineHeight: 0.95,
        }}
      >
        <div
          style={{
            display: "inline-block",
            maxWidth: 1500,
            padding: "8px 28px 16px",
            borderRadius: 18,
            background: COLORS.sunflower,
            color: COLORS.espresso,
            fontSize: 72,
            lineHeight: 1.05,
            rotate: "-1.2deg",
          }}
        >
          Pay with USDC on Stellar.
        </div>
        <div
          style={{
            marginTop: 28,
            maxWidth: 1560,
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            color: COLORS.offWhite,
          }}
        >
          We take care of making the supermarket accept it.
        </div>
      </div>

      {/* Mechanism */}
      <div style={{ position: "absolute", inset: 0, opacity: stage * (1 - why) }}>
        <div
          style={{
            position: "absolute",
            left: 100,
            top: 64,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.18em",
            color: COLORS.sunflower,
          }}
        >
          {walletOn ? "POLLAR WALLET" : cardOn && !ownOn ? "CHECKOUT" : "ALSO"}
        </div>

        <div
          style={{
            position: "absolute",
            left: 100,
            top: 130,
            width: 1720,
            height: 620,
            display: "flex",
            gap: 36,
            alignItems: "center",
          }}
        >
          {/* Wallet */}
          <div
            style={{
              width: walletOn ? 860 : 520,
              height: 520,
              borderRadius: 36,
              background: COLORS.offWhite,
              color: COLORS.espresso,
              padding: "36px 40px",
              boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
              opacity: frame >= CARD_AT ? 1 : springAt(frame, fps, OPEN_END, SNAPPY),
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              <Pill>POLLAR</Pill>
              <Pill dark>STELLAR</Pill>
              <Pill dark>USDC</Pill>
            </div>
            <div style={{ marginTop: 28, fontSize: 22, fontWeight: 700, color: COLORS.muted }}>
              Your wallet
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: "0.04em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {ADDRESS.slice(0, typed)}
              <span style={{ opacity: frame < FUND_AT && Math.floor(frame / 8) % 2 === 0 ? 1 : 0 }}>
                |
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.muted }}>BALANCE</div>
            <div
              style={{
                fontSize: 84,
                fontWeight: 900,
                letterSpacing: "-0.04em",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {formatUSDC(frame >= CONFIRM_AT ? shownBalance : balance)}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>USDC</div>
            {frame < CARD_AT ? (
              <div
                style={{
                  marginTop: 18,
                  height: 64,
                  borderRadius: 999,
                  background: COLORS.sunflower,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 26,
                  fontWeight: 900,
                  scale: String(pressFund),
                }}
              >
                {funded > 0.95 ? "Done" : "Add USDC"}
              </div>
            ) : null}
          </div>

          {/* Disposable card */}
          {cardOn ? (
            <div
              style={{
                opacity: Math.min(1, cardIn * 1.3) * (ownOn ? 1 - ownIn : 1),
                translate: `${(1 - cardIn) * 80}px 0`,
              }}
            >
              <TempCard shred={shred} />
              <div
                style={{
                  marginTop: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  borderRadius: 16,
                  background: COLORS.sunflower,
                  color: COLORS.espresso,
                  fontWeight: 900,
                }}
              >
                <span style={{ fontSize: 22, letterSpacing: "0.06em" }}>LOCKED</span>
                <span style={{ fontSize: 32, fontVariantNumeric: "tabular-nums" }}>
                  {formatUSDC(USDC)} USDC
                </span>
                <span style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>
                  {formatARS(ARS)}
                </span>
              </div>
            </div>
          ) : null}

          {ownOn ? (
            <div
              style={{
                opacity: Math.min(1, ownIn * 1.2),
                translate: `${(1 - ownIn) * 60}px 0`,
              }}
            >
              <CardFace own />
            </div>
          ) : null}
        </div>

        <div
          style={{
            position: "absolute",
            left: 100,
            right: 100,
            bottom: 64,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            color: COLORS.offWhite,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 900,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {caption.title}
            </div>
            <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700, color: COLORS.sunflower }}>
              {caption.sub}
            </div>
          </div>
          {frame >= CARD_AT && frame < OWN_AT ? (
            <div
              style={{
                height: 72,
                padding: "0 28px",
                borderRadius: 999,
                background: COLORS.sunflower,
                color: COLORS.espresso,
                display: "grid",
                placeItems: "center",
                fontSize: 26,
                fontWeight: 900,
                scale: String(pressPay),
              }}
            >
              {frame >= CONFIRM_AT + 6 ? "Charged" : "Confirm"}
            </div>
          ) : null}
        </div>
      </div>

      {/* Why */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: "0 120px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          opacity: why,
          color: COLORS.offWhite,
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "0.16em",
            color: COLORS.sunflower,
          }}
        >
          WHY
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: "-0.04em",
            lineHeight: 1.02,
            maxWidth: 1600,
          }}
        >
          The store requires a card.
          <br />
          Stellar does not replace the POS.
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 32,
            fontWeight: 700,
            maxWidth: 1280,
            lineHeight: 1.3,
          }}
        >
          Changuito turns USDC into a temp card the store accepts. Then it is discarded.
        </div>
      </div>

      <Sfx name="whoosh" at={OPEN_END} volume={0.3} />
      <Sfx name="tap" at={FUND_AT} volume={0.4} />
      <Sfx name="ding" at={FUND_AT + 40} volume={0.35} />
      <Sfx name="whoosh" at={CARD_AT} volume={0.3} />
      <Sfx name="tap" at={CONFIRM_AT} volume={0.45} />
      <Sfx name="impact" at={SHRED_AT} volume={0.4} />
      <Sfx name="success" at={SHRED_AT + 8} volume={0.35} />
    </SceneShell>
  );
};
