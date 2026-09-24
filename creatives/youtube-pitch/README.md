# Changuito — video YouTube 16:9

Film de marca horizontal, 1920×1080, 30 fps, 88 segundos. Hecho con
[Remotion](https://www.remotion.dev). No tiene voz: la narración la graba
Simoneth aparte. La música queda baja a propósito para dejarle aire.

El proyecto vive solo en esta carpeta. No importa nada de `apps/web` ni de
`apps/landing`.

## Render

```console
cd creatives/youtube-pitch
npm install
npx remotion render YouTubePitch out/changuito-youtube-pitch.mp4
```

`npm run render` hace lo mismo. El codec sale de `remotion.config.ts`: H.264,
yuv420p, BT.709, CRF 18. La primera vez Remotion baja Chrome Headless Shell.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Remotion Studio. La composición y cada escena, bajo **Escenas** |
| `npm run frames` | Stills de revisión en `out/frames/` |
| `npm run audio` | Vuelve a sintetizar la cama y los efectos |
| `npm run contrast` | Contraste WCAG de los pares texto/fondo |
| `npm run lint` | ESLint y `tsc` |

`out/` no se commitea. El MP4 y los PNG de `out/frames/` se entregan con el PR.

## Storyboard

Las duraciones están en `src/timeline.json`.

| # | Escena | Duración | Qué se ve |
|---|---|---|---|
| 1 | `Title` | 6 s | Wordmark, mascota idle, «Armá el súper sin pensar.», www.changuito.me |
| 2 | `Insight` | 10 s | El súper como segundo trabajo: lista, precios, minutos |
| 3 | `Promesa` | 8 s | Te arma el súper. No es un exchange ni un comparador |
| 4 | `Demo` | 28 s | El producto en movimiento: chat, precios, carrito. Sin slides de «cómo funciona» |
| 5 | `Pago` | 25 s | Stellar adentro, tarjeta afuera: billetera Pollar, fondeo, tarjeta temporal, cobro, descarte, o la tarjeta que ya tenés, y por qué (el súper exige tarjeta; Stellar no reemplaza el POS) |
| 6 | `Cta` | 11 s | Sumate a la beta · www.changuito.me/whitelist · app.changuito.me |

Los cortes van cubiertos por un panel (`src/components/Swipe.tsx`) como overlay
de `TransitionSeries`, así la duración es la suma de las escenas. El que entra
al CTA usa el patrón mate + pan.

## Marca

- Colores: off-white `#FAFAF7`, espresso `#2A1A14`, sunflower `#F4B942`, arcilla `#E07A5F`.
- «Changuito» solo aparece como el wordmark PNG (`public/brand/wordmark@2x.png`).
- Mascota: poses idle, comparando y lleno del brand pack. No se usa la pose de ojos en X ni la de éxito descartada.
- Inter está en `public/fonts` (SIL OFL). El render no depende de la red para la tipografía.
- Copy en español rioplatense, con voseo. Los súper son «Súper A/B/C/D»: no se nombra a ninguna cadena.

## Audio

`scripts/make-audio.mjs` sintetiza una cama a 120 BPM y siete efectos
(`pop`, `tick`, `tap`, `whoosh`, `impact`, `ding`, `success`). No hay
samples ni voz. El drop cae en el corte a `Promesa`, hay un breakdown corto
al entrar a `Pago`, y el outro arranca con el CTA. En la composición el
volumen de la cama queda en 0.26 para que la VO entre después sin pelear.

Si cambiás duraciones en `src/timeline.json`, corré `npm run audio`.

## Accesibilidad

Un video no se puede escanear con axe-core. `npm run contrast` mide cada par
texto/fondo contra WCAG 2.1 SC 1.4.3 (AA). No hay habla en el archivo: todo
lo necesario está escrito en pantalla. Nada parpadea más de tres veces por
segundo (SC 2.3.1). El tipo importante queda dentro de un margen de 96 px.

## Licencia de Remotion

Remotion es gratis para personas y empresas de hasta tres personas. Equipos
más grandes necesitan una [licencia de empresa](https://www.remotion.pro/license).
