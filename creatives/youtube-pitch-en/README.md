# Changuito — YouTube pitch 16:9 (English)

Horizontal brand film, 1920×1080, 30 fps, 88 seconds. Built with
[Remotion](https://www.remotion.dev). There is no voice-over: Simoneth records
the narration separately. Music stays low so the voice has room.

On-screen copy is English. The product name stays **Changuito** (wordmark PNG
only). URLs stay `www.changuito.me` and `app.changuito.me`.

This folder is a translation of `creatives/youtube-pitch/` (Spanish). It does
not import `apps/web` or `apps/landing`, and it does not modify the Spanish
film or the vertical reel.

## Render

```console
cd creatives/youtube-pitch-en
npm install
npx remotion render YouTubePitch out/changuito-youtube-pitch-EN.mp4
```

`npm run render` does the same. The codec comes from `remotion.config.ts`:
H.264, yuv420p, BT.709, CRF 18. The first run downloads Chrome Headless Shell.

| Command | What it does |
|---|---|
| `npm run dev` | Remotion Studio. The film and each scene, under **Scenes** |
| `npm run frames` | Review stills in `out/frames/` |
| `npm run audio` | Rebuild the music bed and sound effects |
| `npm run contrast` | WCAG contrast of the text/background pairs |
| `npm run lint` | ESLint and `tsc` |

`out/` is gitignored. The MP4 and the PNGs in `out/frames/` ship with the PR
as downloadable artifacts. Smaller review stills also live in `preview/`.

## Storyboard

Durations live in `src/timeline.json` (2,640 frames, 88 s).

| # | Scene | Duration | What you see |
|---|---|---|---|
| 1 | `Title` | 6 s | Wordmark, idle mascot, “Build your grocery run without thinking.”, www.changuito.me |
| 2 | `Insight` | 10 s | Grocery shopping as a second job: the list, moving prices, minutes |
| 3 | `Promesa` | 8 s | It builds the grocery run. Not an exchange. Not a price comparator |
| 4 | `Demo` | 28 s | The product in motion: chat, real prices, cart, confirm |
| 5 | `Pago` | 25 s | “Pay with USDC on Stellar. We take care of making the supermarket accept it.” Pollar wallet, funding, disposable card, USDC charge and discard, or the card you already have |
| 6 | `Cta` | 11 s | Join the beta · www.changuito.me/whitelist · app.changuito.me |

Cuts are covered by a panel (`src/components/Swipe.tsx`) as a `TransitionSeries`
overlay, so the duration is the sum of the scenes. The swipe into the CTA uses
the mate + bread pattern. Background accents are the brand icons (mate, bread,
clay blob, espresso blob). There are no cream circles or ovals.

## Brand

- Colors: off-white `#FAFAF7`, espresso `#2A1A14`, sunflower `#F4B942`, clay `#E07A5F`.
- “Changuito” only appears as the wordmark PNG (`public/brand/wordmark@2x.png`).
- Mascot: idle, comparing, and full poses from the brand pack. The X-eyes pose is not used.
- Inter is in `public/fonts` (SIL OFL). The render does not need the network for type.
- Stores are “Market A/B/C/D”. No chain is named. Prices stay in Argentine pesos.

## Audio

`scripts/make-audio.mjs` synthesizes a 120 BPM bed and seven effects
(`pop`, `tick`, `tap`, `whoosh`, `impact`, `ding`, `success`). There are no
samples and no voice. In the composition the bed sits at 0.26 so a voice-over
can be laid on later.

If you change durations in `src/timeline.json`, run `npm run audio`.

## Accessibility

A rendered video cannot be scanned with axe-core, and it has no 390 px or
1440 px layout to scan. `npm run contrast` checks each text/background pair
against WCAG 2.1 SC 1.4.3 (AA). There is no speech in the file: everything
required is written on screen. Nothing flashes more than three times per
second (SC 2.3.1). Important type stays inside a 96 px margin.

## Remotion license

Remotion is free for individuals and companies of up to three people. Larger
teams need a [company license](https://www.remotion.pro/license).
