FROM node:22-bookworm-slim AS viewer
WORKDIR /viewer
COPY viewer/package.json viewer/package-lock.json ./
RUN npm ci
COPY viewer/viewer.js ./
RUN npm run build

# Playwright's image already carries Chromium's system dependencies.
FROM mcr.microsoft.com/playwright/python:v1.63.0-noble

RUN apt-get update && apt-get install -y --no-install-recommends x11vnc xvfb procps && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --user-group browser

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev && uv run playwright install chromium
COPY agent.py attempt_video.py checkout.py sandbox.py server.py manual.py manual_store.py start.sh browser.sh ./
RUN chmod 755 /app/browser.sh
COPY viewer/index.html ./viewer/index.html
COPY --from=viewer /viewer/dist ./viewer/dist

ENV PORT=8080
ENV MANUAL_CHROMIUM_WRAPPER=/app/browser.sh
CMD ["sh", "start.sh"]
