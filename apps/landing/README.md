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
| Environment variables | ninguna obligatoria para el sitio. `/whitelist` necesita un destino durable — ver abajo |

Dominio de producción: `www.changuito.me`. `app.changuito.me` sigue en el proyecto de `apps/web`.

La lista de espera vive en `/whitelist`. No hace falta login de Vercel para mergear el código: el próximo deploy toma la ruta. Sin un destino configurado, producción responde que no pudo anotar a la persona (no finge el alta). En `next dev` / `next start` local, si no hay variables, el alta se agrega a `apps/landing/.data/waitlist.jsonl` (gitignored).

Elegí **uno** de estos destinos. Si están los dos, Redis es el registro y el webhook recibe una copia.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `WAITLIST_WEBHOOK_URL` | una de las dos vías | `POST` JSON `{ name, email, source, otherDetail, contactForFeedback, whatsapp, createdAt }` a un HTTPS (Notion, Sheets, Slack, Make). `http` solo en `localhost`. |
| `WAITLIST_WEBHOOK_SECRET` | no | Si está, va como `Authorization: Bearer …`. |
| `KV_REST_API_URL` o `UPSTASH_REDIS_REST_URL` | la otra vía | El mismo Redis REST que ya usa el shopper. La landing es otro proyecto de Vercel: hay que conectar la integración ahí, no se hereda sola. |
| `KV_REST_API_TOKEN` o `UPSTASH_REDIS_REST_TOKEN` | junto con la URL | Token REST. Nunca commitearlo. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | en producción | Site key pública de Cloudflare Turnstile (widget en el formulario). |
| `TURNSTILE_SECRET_KEY` | en producción | Secret key de Turnstile (solo servidor; verifica el token antes de guardar). Nunca commitearla. |

### Cloudflare Turnstile

El formulario de `/whitelist` manda un token de Turnstile con el alta. El servidor lo verifica contra `siteverify` antes de persistir. El honeypot (`company`) y el rate-limit siguen activos; el CAPTCHA es adicional.

- **Producción:** si faltan `NEXT_PUBLIC_TURNSTILE_SITE_KEY` o `TURNSTILE_SECRET_KEY`, el alta se rechaza (mismo espíritu que un sink sin configurar).
- **Local / no-production:** si las keys no están, el submit se acepta sin widget (se loguea un aviso una vez) para que `next dev` siga funcionando.

Creá un widget en el [dashboard de Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) y pegá las dos keys en el proyecto de Vercel de la landing.

La clave de Redis es `changuito:landing:waitlist` (hash por email, `HSETNX`), para no pisar las sesiones del shopper si comparten base.

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
| `public/brand/isotipo-mascota.png` | `apps/branding/logo/isotipo-mascota.png` (solo la mascota, header de `/whitelist`) |
| `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` | mascota idle completa (`mascota-idle.png`) encajada en un cuadrado con margen transparente (16/32/48, 32 y 180). Sin recorte de cara. Los mismos archivos están en `apps/web/app`. `/whitelist` hereda estos íconos (no hay `app/whitelist/icon.png`). |

El header, el pie y el cierre del home muestran la mascota idle y la palabra «Changuito» en Inter. `/whitelist` usa el isotipo y la misma palabra en texto. Ninguno usa el lettering. El fondo es `#FAFAF7` plano: el patrón mate-pan no se tilea.
