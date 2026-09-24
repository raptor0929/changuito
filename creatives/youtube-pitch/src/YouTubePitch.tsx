import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import React from "react";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { CLAMP } from "./anim";
import { Swipe } from "./components/Swipe";
import { Sfx } from "./components/ui";
import { Cta } from "./scenes/Cta";
import { Demo } from "./scenes/Demo";
import { Insight } from "./scenes/Insight";
import { Pago } from "./scenes/Pago";
import { Promesa } from "./scenes/Promesa";
import { Title } from "./scenes/Title";
import { COLORS, SceneId, sceneDuration, TOTAL_FRAMES } from "./theme";

const SCENES: Record<SceneId, React.FC> = {
  Title,
  Insight,
  Promesa,
  Demo,
  Pago,
  Cta,
};

const ORDER: SceneId[] = ["Title", "Insight", "Promesa", "Demo", "Pago", "Cta"];

type SwipeSpec = {
  color: string;
  pattern?: boolean;
  direction?: "up" | "left";
  frames?: number;
};

/** Swipe overlays keyed by the scene they lead into. Overlays do not shorten the timeline. */
const SWIPES: Partial<Record<SceneId, SwipeSpec>> = {
  Insight: { color: COLORS.espresso, frames: 16 },
  Promesa: { color: COLORS.sunflower, frames: 16 },
  Demo: { color: COLORS.offWhite, direction: "left" },
  Pago: { color: COLORS.espresso, direction: "left" },
  Cta: { color: COLORS.crema, pattern: true },
};

const DEFAULT_SWIPE_FRAMES = 18;

/**
 * Music stays under the picture on purpose: Simoneth records the voice-over
 * separately, and this file has to leave room for it.
 */
const BED = 0.26;

export const YouTubePitch: React.FC = () => {
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
              <TransitionSeries.Overlay key={`swipe-${id}`} durationInFrames={frames}>
                <Swipe durationInFrames={frames} {...look} />
              </TransitionSeries.Overlay>,
            );
          }
          nodes.push(
            <TransitionSeries.Sequence key={id} name={id} durationInFrames={sceneDuration(id)}>
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
          interpolate(f, [0, 8, TOTAL_FRAMES - 24, TOTAL_FRAMES], [0, BED, BED, 0], CLAMP)
        }
      />
      {swipeSfx.map((at) => (
        <Sfx key={at} name="whoosh" at={Math.max(0, at)} volume={0.28} />
      ))}
    </AbsoluteFill>
  );
};
