import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { progress, SMOOTH, SNAPPY, springAt } from "../anim";
import { Mascot, SceneShell, Sfx, Wordmark } from "../components/ui";
import { COLORS, sceneDuration } from "../theme";

const LAND = 16;

export const Presentacion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneDuration("Presentacion");

  // The changuito rolls in from the left on its wheels and lands with a squash.
  const ride = springAt(frame, fps, 0, { damping: 15, stiffness: 90, mass: 1 });
  const x = interpolate(ride, [0, 1], [-1100, 0]);
  const tilt = interpolate(ride, [0, 0.85, 1], [-10, 3, 0]);
  const squashT = frame - LAND;
  const squash =
    squashT >= 0 && squashT < 14
      ? Math.sin((squashT / 14) * Math.PI) * 0.06 * Math.exp(-squashT / 8)
      : 0;

  const halo = springAt(frame, fps, 4, SNAPPY);
  const mark = springAt(frame, fps, 26, SMOOTH);
  const tag = progress(frame, 44, 60);
  const underline = progress(frame, 56, 74);
  const bubble = springAt(frame, fps, 64, SNAPPY);

  return (
    <SceneShell background={COLORS.offWhite} durationInFrames={duration}>
      {/* Wordmark reveal (mask wipe) */}
      <div
        style={{
          position: "absolute",
          top: 250,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            clipPath: `inset(-30% ${(1 - mark) * 100}% -30% 0)`,
            scale: String(interpolate(mark, [0, 1], [0.92, 1])),
          }}
        >
          <Wordmark width={780} />
        </div>
      </div>

      {/* Halo: two soft sunflower discs, the outer one breathing */}
      <div
        style={{
          position: "absolute",
          left: 540 - 470,
          top: 940 - 470,
          width: 940,
          height: 940,
          borderRadius: 940,
          background: "rgba(244,185,66,0.14)",
          scale: String(halo * (1 + Math.sin(frame / 10) * 0.015)),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 540 - 360,
          top: 940 - 360,
          width: 720,
          height: 720,
          borderRadius: 720,
          background: "rgba(244,185,66,0.3)",
          scale: String(halo),
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 560,
          display: "flex",
          justifyContent: "center",
          translate: `${x}px 0`,
          rotate: `${tilt}deg`,
          transformOrigin: "50% 100%",
        }}
      >
        <div
          style={{
            scale: `${1 + squash} ${1 - squash}`,
            transformOrigin: "50% 100%",
          }}
        >
          <Mascot pose="idle" height={760} bob={frame > 30 ? 6 : 0} />
        </div>
      </div>

      {/* "¡Hola!" speech bubble */}
      <div
        style={{
          position: "absolute",
          left: 720,
          top: 470,
          padding: "22px 34px",
          borderRadius: "36px 36px 36px 8px",
          background: COLORS.espresso,
          color: COLORS.offWhite,
          fontSize: 44,
          fontWeight: 800,
          scale: String(bubble),
          transformOrigin: "0% 100%",
          boxShadow: "0 18px 40px rgba(42,26,20,0.25)",
        }}
      >
        ¡Hola!
      </div>

      {/* Tagline */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 1400,
          textAlign: "center",
          color: COLORS.espresso,
          fontSize: 66,
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          opacity: tag,
          translate: `0 ${(1 - tag) * 40}px`,
        }}
      >
        Tu asistente de IA
        <br />
        <span style={{ position: "relative", display: "inline-block" }}>
          <span
            style={{
              position: "absolute",
              left: -10,
              right: -10,
              bottom: 6,
              height: 26,
              borderRadius: 12,
              background: COLORS.sunflower,
              scale: `${underline} 1`,
              transformOrigin: "0% 50%",
            }}
          />
          <span style={{ position: "relative" }}>para hacer el súper.</span>
        </span>
      </div>

      <Sfx name="whoosh" at={0} volume={0.5} />
      <Sfx name="tap" at={LAND} volume={0.6} />
      <Sfx name="ding" at={28} volume={0.45} />
      <Sfx name="pop" at={64} volume={0.45} />
    </SceneShell>
  );
};
