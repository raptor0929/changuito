#!/usr/bin/env bash
#
# Deploys the two contracts to Stellar testnet and records their ids.
#
#   scripts/deploy-testnet.sh            # deploy anything missing, keep the rest
#   scripts/deploy-testnet.sh --force    # deploy fresh ids, overwriting the file
#
# Idempotent by default: a contract already recorded in deployments.json is left
# alone, so re-running after a failure halfway through resumes rather than
# stranding the first contract. Testnet is wiped periodically; when that happens
# the recorded ids stop resolving and --force is the fix.
#
# Nothing secret is written here. The two identities live in the stellar CLI's
# own config (~/.config/stellar/identity), and only their G-addresses reach
# deployments.json. `stellar keys show` is how the backend secret gets into
# .env.local — see DEPLOY.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deployments.json"
NETWORK=testnet

# The one hot key: mints demo USDC (it is the token admin) and signs
# escrow.settle / escrow.refund (it is the escrow resolver). One key, because a
# demo with two hot keys is two keys to leak.
RESOLVER=changuito-resolver
# Where settled USDC lands. The app never signs for it — an address only.
TREASURY=changuito-treasury

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- identities

ensure_key() {
  if stellar keys address "$1" >/dev/null 2>&1; then
    echo "  $1 exists: $(stellar keys address "$1")"
  else
    say "Generating $1 and funding it with friendbot"
    stellar keys generate "$1" --network "$NETWORK" --fund
    echo "  $1: $(stellar keys address "$1")"
  fi
}

say "Identities"
ensure_key "$RESOLVER"
ensure_key "$TREASURY"

RESOLVER_ADDR="$(stellar keys address "$RESOLVER")"
TREASURY_ADDR="$(stellar keys address "$TREASURY")"

# A key that exists locally but has no account on a reset testnet fails at
# deploy with an opaque error, so top it up first. Friendbot is idempotent-ish:
# it 400s on an already-funded account, which is fine.
curl -s "https://friendbot.stellar.org/?addr=$RESOLVER_ADDR" >/dev/null || true
curl -s "https://friendbot.stellar.org/?addr=$TREASURY_ADDR" >/dev/null || true

# ---------------------------------------------------------------------- build

say "Building contracts for wasm32v1-none"
stellar contract build --manifest-path "$ROOT/contracts/Cargo.toml"
WASM_DIR="$ROOT/contracts/target/wasm32v1-none/release"

# ------------------------------------------------------------------- existing

prev() {
  [[ $FORCE -eq 0 && -f "$OUT" ]] || return 1
  node -e "
    const d = require('$OUT');
    const id = d.contracts?.['$1']?.id;
    if (!id) process.exit(1);
    process.stdout.write(id);
  " 2>/dev/null
}

# --------------------------------------------------------------------- deploy

if USDC_ID="$(prev usdc)"; then
  say "Demo USDC already deployed: $USDC_ID"
else
  say "Deploying demo USDC (admin = $RESOLVER)"
  USDC_ID="$(stellar contract deploy \
    --wasm "$WASM_DIR/mock_usdc.wasm" \
    --source-account "$RESOLVER" \
    --network "$NETWORK" \
    -- --admin "$RESOLVER_ADDR")"
  echo "  $USDC_ID"
fi

if ESCROW_ID="$(prev escrow)"; then
  say "Escrow already deployed: $ESCROW_ID"
else
  say "Deploying escrow (resolver = $RESOLVER, treasury = $TREASURY, token = demo USDC)"
  ESCROW_ID="$(stellar contract deploy \
    --wasm "$WASM_DIR/escrow.wasm" \
    --source-account "$RESOLVER" \
    --network "$NETWORK" \
    -- \
    --resolver "$RESOLVER_ADDR" \
    --treasury "$TREASURY_ADDR" \
    --token "$USDC_ID")"
  echo "  $ESCROW_ID"
fi

# ---------------------------------------------------------------------- record

say "Writing deployments.json"
node -e "
  const fs = require('node:fs');
  // Keep the original timestamp when nothing was redeployed, so a re-run to
  // regenerate bindings does not show up as a diff.
  let at = new Date().toISOString();
  try {
    const old = JSON.parse(fs.readFileSync('$OUT', 'utf8'));
    if (old.contracts.escrow.id === '$ESCROW_ID' && old.contracts.usdc.id === '$USDC_ID') {
      at = old.deployedAt;
    }
  } catch {}
  fs.writeFileSync('$OUT', JSON.stringify({
    network: 'testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    deployedAt: at,
    accounts: {
      resolver: '$RESOLVER_ADDR',
      treasury: '$TREASURY_ADDR',
    },
    contracts: {
      usdc: { id: '$USDC_ID', decimals: 7, symbol: 'USDC' },
      escrow: { id: '$ESCROW_ID' },
    },
  }, null, 2) + '\n');
"
cat "$OUT"

# The same facts as a TS module, because the browser cannot read a JSON file at
# the repo root and `import … with { type: 'json' }` is not something Turbopack
# and `node --experimental-strip-types` agree about today. Contract ids are
# public; nothing secret crosses this line.
node "$ROOT/scripts/write-deployments-module.mjs"

# -------------------------------------------------------------------- bindings

say "Generating TypeScript bindings"
for pair in "escrow:$ESCROW_ID" "usdc:$USDC_ID"; do
  name="${pair%%:*}"; id="${pair##*:}"
  dir="$ROOT/packages/$name-bindings"
  stellar contract bindings typescript \
    --contract-id "$id" \
    --network "$NETWORK" \
    --output-dir "$dir" \
    --overwrite
  node "$ROOT/scripts/fixup-bindings.mjs" "$dir" "@changuito/$name-bindings"
done

# ---------------------------------------------------------------------- verify

say "Verifying against the deployed contracts"
echo -n "  escrow.config  -> "
stellar contract invoke --id "$ESCROW_ID" --source-account "$RESOLVER" --network "$NETWORK" -- config
echo -n "  usdc.symbol    -> "
stellar contract invoke --id "$USDC_ID" --source-account "$RESOLVER" --network "$NETWORK" -- symbol
echo -n "  usdc.decimals  -> "
stellar contract invoke --id "$USDC_ID" --source-account "$RESOLVER" --network "$NETWORK" -- decimals

say "Done. Explorer:"
echo "  https://stellar.expert/explorer/testnet/contract/$ESCROW_ID"
echo "  https://stellar.expert/explorer/testnet/contract/$USDC_ID"
