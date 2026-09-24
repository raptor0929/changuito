import React from "react";
import {
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CLAMP, progress, shake, SLAM, springAt } from "../anim";
import { SceneShell, Sfx } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

// Starts a few frames in so the first slam lands after the incoming swipe clears.
const WORDS = [
  { text: "ARMÁ", size: 230, at: 3 },
  { text: "EL SÚPER", size: 158, at: 11 },
] as const;
const BOX_AT = 20;

export const Promesa: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Promesa");

  const offsetX =
    shake(frame, WORDS[0].at, 18, 1) +
    shake(frame, WORDS[1].at, 12, 2) +
    shake(frame, BOX_AT, 16, 3);
  const offsetY =
    shake(frame, WORDS[0].at, 10, 4) + shake(frame, BOX_AT, 10, 5);

  const box = springAt(frame, fps, BOX_AT, SLAM);
  const sub = progress(frame, 40, 54);

  return (
    <SceneShell
      background={COLORS.sunflower}
      durationInFrames={duration}
      push={0.06}
    >
      {/* Sol de Mayo from the logo, turning slowly behind the type */}
      <Img
        src={staticFile("brand/sol-de-mayo.png")}
        style={{
          position: "absolute",
          width: 1700,
          left: (1080 - 1700) / 2,
          top: 960 - 850 - 60,
          opacity: 0.13,
          rotate: `${interpolate(frame, [0, duration], [0, 40])}deg`,
          scale: String(interpolate(frame, [0, 12], [0.7, 1], CLAMP)),
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingBottom: 140,
          translate: `${offsetX}px ${offsetY}px`,
          fontWeight: 900,
          color: COLORS.espresso,
          letterSpacing: "-0.035em",
          lineHeight: 1,
        }}
      >
        {WORDS.map((w) => {
          const s = springAt(frame, fps, w.at, SLAM);
          return (
            <div
              key={w.text}
              style={{
                fontSize: w.size,
                scale: String(interpolate(s, [0, 1], [2.4, 1])),
                opacity: interpolate(frame - w.at, [0, 3], [0, 1], CLAMP),
              }}
            >
              {w.text}
            </div>
          );
        })}
        <div
          style={{
            marginTop: 26,
            padding: "14px 40px 22px",
            borderRadius: 26,
            background: COLORS.espresso,
            color: COLORS.sunflower,
            fontSize: 124,
            rotate: "-2deg",
            scale: String(interpolate(box, [0, 1], [2.2, 1])),
            opacity: interpolate(frame - BOX_AT, [0, 3], [0, 1], CLAMP),
            boxShadow: "0 30px 60px rgba(42,26,20,0.3)",
          }}
        >
          SIN PENSAR.
        </div>
        <div
          style={{
            marginTop: 70,
            fontSize: 50,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            opacity: sub,
            translate: `0 ${(1 - sub) * 30}px`,
          }}
        >
          Vos pedís. Changuito arma el carrito.
        </div>
      </div>

      <Sfx name="impact" at={WORDS[0].at} volume={0.9} />
      <Sfx name="impact" at={WORDS[1].at} volume={0.55} />
      <Sfx name="impact" at={BOX_AT} volume={0.8} />
    </SceneShell>
  );
};
