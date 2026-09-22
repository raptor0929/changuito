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
| Environment variables | ninguna obligatoria para el sitio. `/whitelist` necesita un destino durable. `/reportarbug` funciona sin variables (ver abajo). |

Dominio de producción: `www.changuito.me`. `app.changuito.me` sigue en el proyecto de `apps/web`.

La lista de espera vive en `/whitelist`. No hace falta login de Vercel para mergear el código: el próximo deploy toma la ruta. Sin un destino configurado, producción responde que no pudo anotar a la persona (no finge el alta). En `next dev` / `next start` local, si no hay variables, el alta se agrega a `apps/landing/.data/waitlist.jsonl` (gitignored).

Elegí **uno** de estos destinos. Si están los dos, Redis es el registro y el webhook recibe una copia.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `WAITLIST_WEBHOOK_URL` | una de las dos vías | `POST` JSON `{ name, email, source, otherDetail, createdAt }` a un HTTPS (Notion, Sheets, Slack, Make). `http` solo en `localhost`. |
| `WAITLIST_WEBHOOK_SECRET` | no | Si está, va como `Authorization: Bearer …`. |
| `KV_REST_API_URL` o `UPSTASH_REDIS_REST_URL` | la otra vía | El mismo Redis REST que ya usa el shopper. La landing es otro proyecto de Vercel: hay que conectar la integración ahí, no se hereda sola. |
| `KV_REST_API_TOKEN` o `UPSTASH_REDIS_REST_TOKEN` | junto con la URL | Token REST. Nunca commitearlo. |

La clave de Redis es `changuito:landing:waitlist` (hash por email, `HSETNX`), para no pisar las sesiones del shopper si comparten base.

## Reportar un bug

`/reportarbug` es la página pública para contar un fallo (la app enlaza `https://www.changuito.me/reportarbug`). El pie del home también apunta ahí.

Si `BUG_REPORT_WEBHOOK_URL` está configurada, el servidor hace `POST` JSON. Si no está, el reporte se acepta igual y queda en el log del proceso con el prefijo `[bug-report]`, para que la página sirva antes de tener un destino. Un webhook que responde mal sí es un error: la persona puede reintentar.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `BUG_REPORT_WEBHOOK_URL` | no | `POST` JSON `{ name, email, description, context, severity, createdAt }` a un HTTPS. `http` solo en `localhost`. `context` y `severity` van `null` si no los completó. |
| `BUG_REPORT_WEBHOOK_SECRET` | no | Si está, va como `Authorization: Bearer …`. |

La mascota de esa página es `public/brand/mascot-error.png` (el carrito idle con ojos en X y gesto hacia abajo). No se usa en el hero ni en los GIF de búsqueda.

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
| `public/brand/animacion-busqueda.gif` | `apps/branding/motion/animacion-busqueda.gif` (hero y pagos, ida y vuelta) |
| `public/brand/mascot-idle.png` | `apps/branding/mascot/mascota-idle.png` (movimiento reducido, y marca del header, pie y cierre) |
| `public/brand/mascota-corriendo.png` | `apps/branding/mascot/mascota-corriendo.png` (CTA, en el lugar de la flecha) |
| `public/brand/wordmark.png` | sin uso en la UI. El lettering con Sol de Mayo no es el logo. |
| `public/og.png` | pose idle ancha del zip de landing (1280×720), solo Open Graph |
| `public/brand/isotipo-mascota.png` | `apps/branding/logo/isotipo-mascota.png` (solo la mascota, header de `/whitelist` y de `/reportarbug`) |
| `public/brand/mascot-error.png` | carrito idle con ojos en X y gesto hacia abajo. Solo `/reportarbug`. |
| `app/whitelist/icon.png` | el mismo isotipo, ícono de la ruta `/whitelist` |
| `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` | cara de la bolsa recortada de `apps/branding/mascot/mascota-idle.png` (16/32/48, 32 y 180). Los mismos archivos están en `apps/web/app`. |

El header, el pie y el cierre del home muestran la mascota idle y la palabra «Changuito» en Inter. `/whitelist` usa el isotipo y la misma palabra en texto. Ninguno usa el lettering. El fondo es `#FAFAF7` plano: el patrón mate-pan no se tilea.
