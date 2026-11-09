#!/usr/bin/env bash
#
# Integration tests for contracts/escrow against a local stellar/quickstart
# node (via `stellar container start local`).
#
#   npm run test:integration:escrow
#
# What it covers:
#   open → settle
#   open → refund (resolver)
#   settle with the wrong basket_hash → BasketMismatch (contract error #9)
#
# Expiry / buyer self-refund after deadline is covered by the in-process Rust
# suite (contracts/escrow/src/test.rs). MIN_TIMEOUT is 300s and the local node
# advances with wall clock, so waiting it out is not worth a CI minute.
#
# Keys are generated into a temp --config-dir and deleted on exit. Nothing is
# written under the repo. Requires Docker and the Stellar CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER_NAME="${CHANGUTO_IT_CONTAINER:-changuito-escrow-it}"
HOST_PORT="${CHANGUTO_IT_PORT:-8000}"
CFG="$(mktemp -d "${TMPDIR:-/tmp}/changuito-escrow-it.XXXXXX")"
STARTED_CONTAINER=0
KEEP_NODE="${CHANGUTO_IT_KEEP_NODE:-0}"

cleanup() {
  local ec=$?
  if [[ "$KEEP_NODE" != "1" && "$STARTED_CONTAINER" -eq 1 ]]; then
    stellar container stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  rm -rf "$CFG"
  exit "$ec"
}
trap cleanup EXIT

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 127; }; }

need docker
need stellar
need curl
need python3

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not responding (is the daemon running?)" >&2
  exit 1
fi

# --config-dir must come before a contract `--` slop, or the CLI treats it as a
# contract argument and then cannot find the identity.
cli() { stellar --config-dir "$CFG" "$@"; }

hex32() { python3 -c "print(('${1}' * 32)[:64])"; }

wait_rpc() {
  local i
  for i in $(seq 1 90); do
    if stellar network health --network local --config-dir "$CFG" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "local RPC did not become healthy on :$HOST_PORT" >&2
  stellar container logs "$CONTAINER_NAME" 2>&1 | tail -40 >&2 || true
  exit 1
}

# Friendbot trails the RPC by a few seconds after quickstart boots.
fund() {
  local name="$1" addr i code
  addr="$(cli keys address "$name")"
  for i in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/friendbot?addr=${addr}" || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 2
  done
  echo "friendbot did not fund ${name} (${addr}) on :${HOST_PORT}" >&2
  exit 1
}

# ------------------------------------------------------------------ node

if docker ps --format '{{.Names}}' | grep -qx "stellar-${CONTAINER_NAME}"; then
  say "Reusing running container stellar-${CONTAINER_NAME}"
else
  say "Starting stellar/quickstart (local) as ${CONTAINER_NAME}"
  # `stellar container start` pulls stellar/quickstart and enables RPC + Horizon.
  stellar container start local \
    --name "$CONTAINER_NAME" \
    --ports-mapping "${HOST_PORT}:8000"
  STARTED_CONTAINER=1
fi

# Point this throwaway config at the same local defaults the CLI ships with.
# `network health --network local` already knows Standalone + localhost:8000
# from the global install; identities below live only under $CFG.
wait_rpc

# ----------------------------------------------------------------- keys

say "Generating throwaway identities"
cli keys generate it-resolver --network local --overwrite
cli keys generate it-treasury --network local --overwrite
cli keys generate it-buyer --network local --overwrite
fund it-resolver
fund it-treasury
fund it-buyer

RESOLVER="$(cli keys address it-resolver)"
TREASURY="$(cli keys address it-treasury)"
BUYER="$(cli keys address it-buyer)"

# ------------------------------------------------------------------ build

say "Building contracts"
stellar contract build --manifest-path "$ROOT/contracts/Cargo.toml"
WASM="$ROOT/contracts/target/wasm32v1-none/release"

# ----------------------------------------------------------------- deploy

say "Deploying mock_usdc + escrow"
USDC_ID="$(cli contract deploy \
  --wasm "$WASM/mock_usdc.wasm" \
  --source-account it-resolver \
  --network local \
  -- --admin "$RESOLVER")"
ESCROW_ID="$(cli contract deploy \
  --wasm "$WASM/escrow.wasm" \
  --source-account it-resolver \
  --network local \
  -- --resolver "$RESOLVER" --treasury "$TREASURY" --token "$USDC_ID")"

echo "  usdc   $USDC_ID"
echo "  escrow $ESCROW_ID"

AMOUNT=10000000
BASKET="$(hex32 ba)"
RECEIPT="$(hex32 fe)"
WRONG="$(hex32 bb)"
TIMEOUT=300

cli contract invoke --id "$USDC_ID" --source-account it-resolver --network local -- \
  mint --to "$BUYER" --amount 100000000 >/dev/null

invoke() {
  cli contract invoke --id "$ESCROW_ID" --network local "$@"
}

expect_basket_mismatch() {
  local out ec
  set +e
  out="$(invoke --source-account it-resolver -- \
    settle --order-id "$1" --basket-hash "$WRONG" --receipt-hash "$RECEIPT" 2>&1)"
  ec=$?
  set -e
  if [[ "$ec" -eq 0 ]]; then
    echo "expected BasketMismatch, settle succeeded:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! grep -qE 'Error\(Contract, #9\)|contract error", 9' <<<"$out"; then
    echo "expected contract error #9 (BasketMismatch), got:" >&2
    echo "$out" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------- cases

say "open → settle"
ORDER1="$(hex32 01)"
invoke --source-account it-buyer -- \
  open --buyer "$BUYER" --order-id "$ORDER1" --amount "$AMOUNT" \
  --basket-hash "$BASKET" --timeout-secs "$TIMEOUT" >/dev/null
SETTLED="$(invoke --source-account it-resolver -- \
  settle --order-id "$ORDER1" --basket-hash "$BASKET" --receipt-hash "$RECEIPT")"
grep -q '"status":1' <<<"$SETTLED" || { echo "settle did not return Settled: $SETTLED" >&2; exit 1; }
echo "  ok"

say "open → refund"
ORDER2="$(hex32 02)"
invoke --source-account it-buyer -- \
  open --buyer "$BUYER" --order-id "$ORDER2" --amount "$AMOUNT" \
  --basket-hash "$BASKET" --timeout-secs "$TIMEOUT" >/dev/null
REFUNDED="$(invoke --source-account it-resolver -- \
  refund --caller "$RESOLVER" --order-id "$ORDER2")"
grep -q '"status":2' <<<"$REFUNDED" || { echo "refund did not return Refunded: $REFUNDED" >&2; exit 1; }
echo "  ok"

say "settle with wrong basket_hash → BasketMismatch"
ORDER3="$(hex32 03)"
invoke --source-account it-buyer -- \
  open --buyer "$BUYER" --order-id "$ORDER3" --amount "$AMOUNT" \
  --basket-hash "$BASKET" --timeout-secs "$TIMEOUT" >/dev/null
expect_basket_mismatch "$ORDER3"
STILL_OPEN="$(invoke --source-account it-buyer --send=no -- \
  get_order --order-id "$ORDER3")"
grep -q '"status":0' <<<"$STILL_OPEN" || { echo "order should still be Open: $STILL_OPEN" >&2; exit 1; }
echo "  ok"

say "All escrow integration cases passed against local quickstart"
