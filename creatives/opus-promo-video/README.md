# Changuito — vertical promo video (Remotion)

A 36-second, 1080×1920 / 30 fps product promo for Changuito, built with
[Remotion](https://www.remotion.dev). Everything on screen and every sound is
generated from this folder: no stock footage, no samples.

This project is **isolated from the monorepo**. It lives outside the
`apps/*` / `packages/*` workspaces, has its own `package.json` and lockfile,
and nothing in `apps/web` or `apps/landing` imports it.

## Render

```console
cd creatives/opus-promo-video
npm install
npx remotion render ChanguitoPromo out/changuito-promo.mp4
```

`npm run render` runs the same command. Codec, pixel format and quality come
from `remotion.config.ts` (H.264, yuv420p, CRF 18), so the output plays
anywhere a phone plays video. The first render downloads Chrome Headless Shell
(~100 MB); after that a full render takes well under a minute on 4 cores.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Remotion Studio. The main composition plus every scene on its own under **Escenas** |
| `npm run render:preview` | Half-resolution render, for quick checks |
| `npm run still` | One PNG frame (`--frame=420` is the mascot reveal) |
| `npm run audio` | Re-synthesize the music bed and sound effects |
| `npm run contrast` | WCAG contrast check of every text/background pair used |
| `npm run lint` | ESLint + `tsc` |

`out/` is git-ignored. The rendered MP4 is attached to the PR instead of
committed.

## Storyboard

Scene lengths live in `src/timeline.json`; both the composition and the
audio generator read it.

| # | Scene | Length | Beat |
|---|---|---|---|
| 1 | `Hook` | 4 s | "¿Otra vez la lista eterna del súper?" — a paper list that scrolls faster and faster |
| 2 | `Problema` | 4 s | "¿Y comparar precios a mano?" — price tabs piling up, minutes ticking |
| 3 | `Promesa` | 3 s | **Armá el súper sin pensar.** Slammed on the music drop |
| 4 | `Presentacion` | 4 s | Mascot rolls in, wordmark reveal, "Tu asistente de IA para hacer el súper." |
| 5 | `PasoPedile` | 4 s | Step 1 — chat: typing in the composer, reply with product chips |
| 6 | `PasoCompara` | 4 s | Step 2 — same product across three stores, best price picked |
| 7 | `PasoConfirma` | 4 s | Step 3 — cart card, total counts up, "Confirmar carrito" tapped |
| 8 | `PasoPaga` | 4 s | Step 4 — card or USDC, pay, "¡Listo! Changuito ya empujó." |
| 9 | `Cta` | 5 s | Wordmark, mascot, "Probar Changuito", www.changuito.me, "Sumate a la beta" |

Cuts between blocks are covered by full-bleed swipe panels
(`src/components/Swipe.tsx`) rendered as `TransitionSeries` overlays, so the
timeline is exactly the sum of the scene lengths. The one into the CTA uses
the canonical mate + pan pattern.

## Brand rules this project follows

- Colours are the locked tokens only: espresso `#2A1A14`, sunflower `#F4B942`,
  arcilla `#E07A5F`, off-white `#FAFAF7`, plus a warm cream and the product
  UI's muted/border values (`src/theme.ts`).
- "Changuito" always appears as the canonical wordmark PNG
  (`public/brand/wordmark@2x.png`), never typeset.
- Mascot poses are the brand-pack PNGs (`idle`, `lleno`, `comparando`,
  `corriendo`). The Sol de Mayo and the mate + pan pattern come from
  `apps/branding`.
- Type is Inter, bundled locally in `public/fonts` (SIL OFL, see
  `OFL-Inter.txt`), so renders do not depend on the network.
- Copy is rioplatense Spanish with voseo. Stores are "Súper A/B/C/D"; no
  real retailer or competitor is named. The USDC tile uses a generic coin,
  not the issuer's logo.
- The fake chat and cart borrow the product's own styling (espresso user
  bubble, white cards, sunflower primary button) from `apps/web`.

## Audio

`scripts/make-audio.mjs` synthesizes a 120 BPM music bed (mallet hook,
plucked off-beat stabs, bass, four-on-the-floor drums, a riser into the drop
on the cut to `Promesa`) and seven one-shot effects (`pop`, `tick`, `tap`,
`whoosh`, `impact`, `ding`, `success`). It is deterministic, so re-running it
produces the same files. The bed is encoded to MP3 with the ffmpeg binary that
ships with Remotion — no system ffmpeg needed. Integrated loudness is about
−14 LUFS.

If you change scene lengths in `src/timeline.json`, run `npm run audio` so
the drop and outro still land on their cuts.

## Accessibility

A video cannot be scanned by axe-core, so `npm run contrast` checks every
text/background pair against WCAG 2.1 SC 1.4.3 instead; all pairs pass AA.
Other checks: there is no speech (music and effects only), so all information
is carried by on-screen text; no element flashes more than three times per
second (SC 2.3.1); key copy stays inside an 80 px side / 200 px top safe area
so platform UI does not cover it.

## Licensing

Remotion is free for individuals and companies of up to three people; larger
teams need a [company license](https://www.remotion.pro/license).
