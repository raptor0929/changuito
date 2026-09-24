import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import React from "react";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { CLAMP } from "./anim";
import { Swipe } from "./components/Swipe";
import { Sfx } from "./components/ui";
import { Cta } from "./scenes/Cta";
import { Hook } from "./scenes/Hook";
import { PasoCompara } from "./scenes/PasoCompara";
import { PasoConfirma } from "./scenes/PasoConfirma";
import { PasoPaga } from "./scenes/PasoPaga";
import { PasoPedile } from "./scenes/PasoPedile";
import { Presentacion } from "./scenes/Presentacion";
import { Problema } from "./scenes/Problema";
import { Promesa } from "./scenes/Promesa";
import { COLORS, SceneId, sceneDuration, TOTAL_FRAMES } from "./theme";

const SCENES: Record<SceneId, React.FC> = {
  Hook,
  Problema,
  Promesa,
  Presentacion,
  PasoPedile,
  PasoCompara,
  PasoConfirma,
  PasoPaga,
  Cta,
};

const ORDER: SceneId[] = [
  "Hook",
  "Problema",
  "Promesa",
  "Presentacion",
  "PasoPedile",
  "PasoCompara",
  "PasoConfirma",
  "PasoPaga",
  "Cta",
];

type SwipeSpec = {
  color: string;
  pattern?: boolean;
  direction?: "up" | "left";
  frames?: number;
};

/** Swipe overlays keyed by the scene they lead *into*. Overlays don't shorten the timeline. */
const SWIPES: Partial<Record<SceneId, SwipeSpec>> = {
  // Shorter, so the panel is gone by the time the first slam lands on the drop.
  Promesa: { color: COLORS.sunflower, frames: 14 },
  Presentacion: { color: COLORS.offWhite },
  PasoCompara: { color: COLORS.espresso, direction: "left" },
  PasoConfirma: { color: COLORS.crema, direction: "left" },
  PasoPaga: { color: COLORS.sunflower, direction: "left" },
  Cta: { color: COLORS.crema, pattern: true },
};

const DEFAULT_SWIPE_FRAMES = 18;

export const ChanguitoPromo: React.FC = () => {
  let cursor = 0;
  const swipeSfx: number[] = [];

  return (
    <AbsoluteFill style={{ background: COLORS.espresso }}>
      <TransitionSeries>
        {ORDER.flatMap((id) => {
          const Scene = SCENES[id];
          const swipe = SWIPES[id];
          const nodes: React.ReactNode[] = [];
          if (swipe) {
            const { frames = DEFAULT_SWIPE_FRAMES, ...look } = swipe;
            swipeSfx.push(cursor - Math.round(frames / 2));
            nodes.push(
              <TransitionSeries.Overlay
                key={`swipe-${id}`}
                durationInFrames={frames}
              >
                <Swipe durationInFrames={frames} {...look} />
              </TransitionSeries.Overlay>,
            );
          }
          nodes.push(
            <TransitionSeries.Sequence
              key={id}
              name={id}
              durationInFrames={sceneDuration(id)}
            >
              <Scene />
            </TransitionSeries.Sequence>,
          );
          cursor += sceneDuration(id);
          return nodes;
        })}
      </TransitionSeries>

      <Audio
        src={staticFile("audio/music.mp3")}
        volume={(f) =>
          interpolate(
            f,
            [0, 6, TOTAL_FRAMES - 20, TOTAL_FRAMES],
            [0, 0.72, 0.72, 0],
            CLAMP,
          )
        }
      />
      {swipeSfx.map((at) => (
        <Sfx key={at} name="whoosh" at={Math.max(0, at)} volume={0.4} />
      ))}
    </AbsoluteFill>
  );
};
