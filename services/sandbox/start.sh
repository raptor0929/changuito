#!/bin/sh
set -eu
export DISPLAY=:99
Xvfb :99 -screen 0 1366x900x24 -nolisten tcp &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT
# x11vnc waits for Xvfb and exposes only a loopback socket behind the authenticated relay.
uv run python -c 'import time; from pathlib import Path; [time.sleep(.1) for _ in range(50) if not Path("/tmp/.X11-unix/X99").exists()]'
x11vnc -display :99 -localhost -rfbport 5901 -forever -nopw -shared -noclipboard -nosel -quiet &
vnc_pid=$!
trap 'kill "$vnc_pid" "$xvfb_pid" 2>/dev/null || true' EXIT
uv run uvicorn server:app --host 0.0.0.0 --port "${PORT:-8080}" &
api_pid=$!
trap 'kill "$api_pid" "$vnc_pid" "$xvfb_pid" 2>/dev/null || true' EXIT INT TERM
wait "$api_pid"
