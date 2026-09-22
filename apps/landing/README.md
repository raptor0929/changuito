# @changuito/landing

Landing de marketing para **www.changuito.me**. Es un proyecto Next.js aparte de `apps/web` (el shopper, en app.changuito.me).

No comparte rutas con el shopper. El único enlace de producto es `https://app.changuito.me`.

## Vercel

Crear un **proyecto nuevo**, no reusar el de `apps/web`.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root Directory | `apps/landing` |
| Node.js | **22.x** (el repo pide `>=22.12`) |
| Install command | default — Vercel instala desde la raíz del monorepo (`npm ci`) |
| Build command | default — corre `next build` de este paquete |
| Environment variables | ninguna. No hay secrets ni `NEXT_PUBLIC_*` |

Dominio de producción: `www.changuito.me`. `app.changuito.me` sigue en el proyecto de `apps/web`.

Si el dashboard no detecta el workspace y pide comandos a mano (el working directory es `apps/landing`):

```bash
npm ci --prefix ../..
npm run build -w @changuito/landing --prefix ../..
```

El lockfile está en la raíz. No hace falta `vercel.json`: los headers de seguridad salen de `next.config.ts`.

## Monorepo

Desde la raíz del repo:

```bash
npm ci
npm run dev -w @changuito/landing      # http://localhost:3125
npm run build -w @changuito/landing
npm test -w @changuito/landing
npm run typecheck -w @changuito/landing
```

El paquete entra por el workspace `apps/*` del `package.json` raíz. No depende de `@changuito/mcp` ni de los bindings.

## Assets

El kit completo vive en `apps/branding/` (manuals, logo, mascota, pattern, motion, social, copy, tokens). Esta app solo copia a `public/` lo que la página sirve:

| Público | Origen |
|---|---|
| `public/brand/wordmark.png` | `apps/branding/logo/wordmark.png` |
| `public/brand/animacion-cargando.gif` | `apps/branding/motion/animacion-cargando.gif` (hero) |
| `public/brand/mascot-idle.png` | `apps/branding/mascot/mascota-idle.png` (hero si `prefers-reduced-motion`) |
| `public/brand/mascot-exito.png` | `apps/branding/mascot/mascota-exito.png` |
| `public/brand/mascota-corriendo.png` | `apps/branding/mascot/mascota-corriendo.png` (CTA, en el lugar de la flecha) |
| `public/brand/lockup-stacked.png` | `apps/branding/logo/lockup-stacked-mascota-y-wordmark.png` |
| `public/og.png` | pose idle ancha del zip de landing (1280×720), solo Open Graph |
| `app/icon.svg` | `apps/branding/logo/sol-mayo.svg` |

El header usa solo el wordmark. El fondo es `#FAFAF7` plano: el patrón mate-pan no se tilea.
