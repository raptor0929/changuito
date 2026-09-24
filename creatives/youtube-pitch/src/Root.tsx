import "./fonts";
import React from "react";
import { Composition, Folder } from "remotion";
import { Cta } from "./scenes/Cta";
import { Demo } from "./scenes/Demo";
import { Insight } from "./scenes/Insight";
import { Pago } from "./scenes/Pago";
import { Promesa } from "./scenes/Promesa";
import { Title } from "./scenes/Title";
import { sceneDuration, timeline, TOTAL_FRAMES } from "./theme";
import { YouTubePitch } from "./YouTubePitch";

const { fps, width, height } = timeline;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="YouTubePitch"
        component={YouTubePitch}
        durationInFrames={TOTAL_FRAMES}
        fps={fps}
        width={width}
        height={height}
      />
      <Folder name="Escenas">
        <Composition
          id="Title"
          component={Title}
          durationInFrames={sceneDuration("Title")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="Insight"
          component={Insight}
          durationInFrames={sceneDuration("Insight")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="Promesa"
          component={Promesa}
          durationInFrames={sceneDuration("Promesa")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="Demo"
          component={Demo}
          durationInFrames={sceneDuration("Demo")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="Pago"
          component={Pago}
          durationInFrames={sceneDuration("Pago")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="Cta"
          component={Cta}
          durationInFrames={sceneDuration("Cta")}
          fps={fps}
          width={width}
          height={height}
        />
      </Folder>
    </>
  );
};
