#!/usr/bin/env bash
#
# Deploys the contracts to a Stellar network and records their ids.
#
#   scripts/deploy.sh                    # testnet, deploy anything missing
#   scripts/deploy.sh --force            # testnet, fresh ids, overwriting
#   scripts/deploy.sh mainnet            # mainnet — reads the checklist below
#
# Idempotent by default: a contract already recorded in deployments.json is left
# alone, so re-running after a failure halfway through resumes rather than
# stranding the first contract. Testnet is wiped periodically; when that happens
# the recorded ids stop resolving and --force is the fix.
#
# What changes on mainnet, and why this is one script rather than two:
#
#   * There is no friendbot. The identities must already hold XLM, and the
#     script refuses rather than deploying with an account that cannot pay.
#   * contracts/mock_usdc is NOT deployed. It is admin-mintable play money and
#     has no business on a public network. You pass the real USDC SAC id in
#     $USDC_ID instead — derive it, never paste it from memory:
#         stellar contract id asset --asset USDC:<issuer> --network mainnet
#   * The escrow is token-agnostic (contracts/escrow: __constructor takes the
#     token address), so mainnet is a redeploy with different constructor
#     arguments, not a different contract.
#   * The treasury needs a USDC trustline before the first settle, or the
#     transfer fails. A classic asset cannot reach an account that has not
#     opted into it. That is a one-time manual step; see DEPLOY.md.
#
# Nothing secret is written here. The identities live in the stellar CLI's own
# config (~/.config/stellar/identity), and only their G-addresses reach
# deployments.json. `stellar keys show` is how the backend secret gets into
# .env.local — see DEPLOY.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deployments.json"

NETWORK=testnet
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    testnet|mainnet) NETWORK="$arg" ;;
    *) echo "unknown argument: $arg (expected testnet, mainnet, or --force)" >&2; exit 2 ;;
  esac
done

# Separate identities per network, on purpose. The testnet resolver secret has
# been through a deploy script and a shell history; mainnet money must not
# depend on that.
if [[ "$NETWORK" == testnet ]]; then
  RESOLVER=changuito-resolver
  TREASURY=changuito-treasury
else
  RESOLVER="changuito-resolver-$NETWORK"
  TREASURY="changuito-treasury-$NETWORK"
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [[ "$NETWORK" != testnet ]]; then
  say "Deploying to $NETWORK — this spends real XLM"
  echo "  resolver identity: $RESOLVER"
  echo "  treasury identity: $TREASURY"
  echo "  USDC contract:     ${USDC_ID:-<unset>}"
  if [[ -z "${USDC_ID:-}" ]]; then
    cat >&2 <<'MSG'

  USDC_ID is not set. On a public network the token is real USDC, not
  contracts/mock_usdc, so this script will not invent one. Derive it:

      stellar contract id asset --asset USDC:<issuer> --network mainnet

  then re-run with:  USDC_ID=C... scripts/deploy.sh mainnet
MSG
    exit 2
  fi
  read -r -p "  Type the network name to continue: " confirm
  [[ "$confirm" == "$NETWORK" ]] || { echo "  aborted"; exit 1; }
fi

# ---------------------------------------------------------------- identities

ensure_key() {
  if stellar keys address "$1" >/dev/null 2>&1; then
    echo "  $1 exists: $(stellar keys address "$1")"
  elif [[ "$NETWORK" == testnet ]]; then
    say "Generating $1 and funding it with friendbot"
    stellar keys generate "$1" --network "$NETWORK" --fund
    echo "  $1: $(stellar keys address "$1")"
  else
    echo "  $1 does not exist. On $NETWORK, generate and fund it yourself:" >&2
    echo "      stellar keys generate $1 --network $NETWORK" >&2
    echo "  then send it XLM before re-running." >&2
    exit 1
  fi
}

say "Identities"
ensure_key "$RESOLVER"
ensure_key "$TREASURY"

RESOLVER_ADDR="$(stellar keys address "$RESOLVER")"
TREASURY_ADDR="$(stellar keys address "$TREASURY")"

if [[ "$NETWORK" == testnet ]]; then
  # A key that exists locally but has no account on a reset testnet fails at
  # deploy with an opaque error, so top it up first. Friendbot is idempotent-ish:
  # it 400s on an already-funded account, which is fine.
  curl -s "https://friendbot.stellar.org/?addr=$RESOLVER_ADDR" >/dev/null || true
  curl -s "https://friendbot.stellar.org/?addr=$TREASURY_ADDR" >/dev/null || true
fi

# ---------------------------------------------------------------------- build

say "Building contracts for wasm32v1-none"
stellar contract build --manifest-path "$ROOT/contracts/Cargo.toml"
WASM_DIR="$ROOT/contracts/target/wasm32v1-none/release"

# ------------------------------------------------------------------- existing

prev() {
  [[ $FORCE -eq 0 && -f "$OUT" ]] || return 1
  node -e "
    const d = require('$OUT');
    const id = d.networks?.['$NETWORK']?.contracts?.['$1']?.id;
    if (!id) process.exit(1);
    process.stdout.write(id);
  " 2>/dev/null
}

# --------------------------------------------------------------------- deploy

if [[ "$NETWORK" == testnet ]]; then
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
else
  say "Using real USDC: $USDC_ID (mock_usdc is never deployed here)"
fi

if ESCROW_ID="$(prev escrow)"; then
  say "Escrow already deployed: $ESCROW_ID"
else
  say "Deploying escrow (resolver = $RESOLVER, treasury = $TREASURY, token = $USDC_ID)"
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
NETWORK="$NETWORK" RESOLVER_ADDR="$RESOLVER_ADDR" TREASURY_ADDR="$TREASURY_ADDR" \
USDC_ID="$USDC_ID" ESCROW_ID="$ESCROW_ID" OUT="$OUT" node -e "
  const fs = require('node:fs');
  const { NETWORK, RESOLVER_ADDR, TREASURY_ADDR, USDC_ID, ESCROW_ID, OUT } = process.env;
  const d = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const n = d.networks[NETWORK];
  if (!n) throw new Error(\`deployments.json has no '\${NETWORK}' entry — add its chain constants first\`);
  // Keep the original timestamp when nothing was redeployed, so a re-run to
  // regenerate bindings does not show up as a diff.
  if (n.contracts.escrow.id !== ESCROW_ID || n.contracts.usdc.id !== USDC_ID) {
    n.deployedAt = new Date().toISOString();
  }
  n.accounts = { resolver: RESOLVER_ADDR, treasury: TREASURY_ADDR };
  n.contracts = { usdc: { ...n.contracts.usdc, id: USDC_ID }, escrow: { id: ESCROW_ID } };
  fs.writeFileSync(OUT, JSON.stringify(d, null, 2) + '\n');
"
cat "$OUT"

# The same facts as a TS module, because the browser cannot read a JSON file at
# the repo root and `import … with { type: 'json' }` is not something Turbopack
# and `node --experimental-strip-types` agree about today. Contract ids are
# public; nothing secret crosses this line.
node "$ROOT/scripts/write-deployments-module.mjs"

# -------------------------------------------------------------------- bindings

# Only from testnet. The bindings are used as pure ABI — argument encoding and
# error codes, which are identical on every network — and lib/deployments.ts
# supplies the ids. Regenerating them from mainnet would rewrite the baked
# contractId and break the provenance check in lib/test/stellar.test.ts for no
# gain. The escrow wasm is the same binary either way.
if [[ "$NETWORK" == testnet ]]; then
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
fi

# ---------------------------------------------------------------------- verify

say "Verifying against the deployed contracts"
echo -n "  escrow.config  -> "
stellar contract invoke --id "$ESCROW_ID" --source-account "$RESOLVER" --network "$NETWORK" -- config
echo -n "  usdc.symbol    -> "
stellar contract invoke --id "$USDC_ID" --source-account "$RESOLVER" --network "$NETWORK" -- symbol
echo -n "  usdc.decimals  -> "
stellar contract invoke --id "$USDC_ID" --source-account "$RESOLVER" --network "$NETWORK" -- decimals

EXPLORER=$([[ "$NETWORK" == mainnet ]] && echo public || echo "$NETWORK")
say "Done. Explorer:"
echo "  https://stellar.expert/explorer/$EXPLORER/contract/$ESCROW_ID"
echo "  https://stellar.expert/explorer/$EXPLORER/contract/$USDC_ID"

if [[ "$NETWORK" != testnet ]]; then
  cat <<MSG

Still to do by hand on $NETWORK:
  1. Add a USDC trustline to the treasury ($TREASURY_ADDR), or the first
     settle will fail — a classic asset cannot reach an account that has not
     opted into it.
  2. Put the resolver secret in STELLAR_RESOLVER_SECRET_MAINNET:
         stellar keys show $RESOLVER
  3. Add the RPC host in deployments.json to the CSP in
     apps/web/lib/security-headers.ts, or the browser blocks every call.
MSG
fi
