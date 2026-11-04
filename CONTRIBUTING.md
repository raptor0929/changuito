# Contributing

## Issues and pull requests

Open an issue in [tote-hq/changuito-tareas](https://github.com/tote-hq/changuito-tareas) before starting work. Every pull request names that issue in the description:

```
Closes tote-hq/changuito-tareas#N
```

Name branches `type/short-description`, for example `fix/cart-link-tool-trail`.

Keep the pull request description basic: what changed, and the closing line above.

## Secrets

Never commit secrets, keys, or `.env` files. `.env.example` lists variable names only.

## Before you push

```bash
npm test
npm run test:integration:escrow   # needs Docker + Stellar CLI
npm run typecheck -w @changuito/web
npm run build
```

Testing levels and CI layout: [docs/testing-strategy.md](docs/testing-strategy.md).
