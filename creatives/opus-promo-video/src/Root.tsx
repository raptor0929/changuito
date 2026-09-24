import "./fonts";
import React from "react";
import { Composition, Folder } from "remotion";
import { ChanguitoPromo } from "./ChanguitoPromo";
import { Cta } from "./scenes/Cta";
import { Hook } from "./scenes/Hook";
import { PasoCompara } from "./scenes/PasoCompara";
import { PasoConfirma } from "./scenes/PasoConfirma";
import { PasoPaga } from "./scenes/PasoPaga";
import { PasoPedile } from "./scenes/PasoPedile";
import { Presentacion } from "./scenes/Presentacion";
import { Problema } from "./scenes/Problema";
import { Promesa } from "./scenes/Promesa";
import { sceneDuration, timeline, TOTAL_FRAMES } from "./theme";

const { fps, width, height } = timeline;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ChanguitoPromo"
        component={ChanguitoPromo}
        durationInFrames={TOTAL_FRAMES}
        fps={fps}
        width={width}
        height={height}
      />

      {/* Each scene on its own, for tweaking in Studio. */}
      <Folder name="Escenas">
        <Composition
          id="Hook"
          component={Hook}
          durationInFrames={sceneDuration("Hook")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="Problema"
          component={Problema}
          durationInFrames={sceneDuration("Problema")}
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
          id="Presentacion"
          component={Presentacion}
          durationInFrames={sceneDuration("Presentacion")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="PasoPedile"
          component={PasoPedile}
          durationInFrames={sceneDuration("PasoPedile")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="PasoCompara"
          component={PasoCompara}
          durationInFrames={sceneDuration("PasoCompara")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="PasoConfirma"
          component={PasoConfirma}
          durationInFrames={sceneDuration("PasoConfirma")}
          fps={fps}
          width={width}
          height={height}
        />
        <Composition
          id="PasoPaga"
          component={PasoPaga}
          durationInFrames={sceneDuration("PasoPaga")}
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
