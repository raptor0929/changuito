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
#     has no business on a public network. You pass the real USDC *issuer* in
#     $USDC_ISSUER and the script derives the SAC id itself — the id is never
#     pasted, because a wrong one is a contract that exists, answers, and holds
#     somebody else's token.
#   * The issuer is also recorded, because the app needs the classic asset
#     (code + issuer) to open a trustline for the buyer. The SAC id alone
#     cannot be turned back into one.
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

# The asset code this network quotes, read from deployments.json so that the
# SAC derived below and the asset the app asks a shopper for are provably the
# same string. Defined here rather than beside prev() because the mainnet
# preflight needs it before any contract has been looked at.
asset_code() {
  node -e "
    const d = require('$OUT');
    process.stdout.write(d.networks?.['$NETWORK']?.contracts?.usdc?.symbol || 'USDC');
  "
}

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
  echo "  USDC issuer:       ${USDC_ISSUER:-<unset>}"
  if [[ -z "${USDC_ISSUER:-}" ]]; then
    cat >&2 <<MSG

  USDC_ISSUER is not set. On a public network the token is real USDC, not
  contracts/mock_usdc, so this script will not invent one. Look up the
  issuing account for USDC on $NETWORK, then re-run with:

      USDC_ISSUER=G... scripts/deploy.sh $NETWORK
MSG
    exit 2
  fi
  # The code comes from deployments.json, not from a literal here. It is
  # "USDC" today on every network, and it was a literal in this line until the
  # asset was nearly swapped — at which point this would have derived the SAC
  # of a different asset than the app quotes, silently, because both halves
  # would still have been well-formed.
  USDC_CODE="$(asset_code)"
  echo "  USDC code:         $USDC_CODE (from deployments.json)"
  # Derived, not pasted. `stellar contract id asset` is pure arithmetic over
  # the asset and the passphrase — it reaches no network and cannot be wrong
  # about an issuer that is right.
  USDC_ID="$(stellar contract id asset --asset "$USDC_CODE:$USDC_ISSUER" --network "$NETWORK")"
  echo "  USDC contract:     $USDC_ID (derived)"
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
USDC_ID="$USDC_ID" ESCROW_ID="$ESCROW_ID" USDC_ISSUER="${USDC_ISSUER:-}" OUT="$OUT" node -e "
  const fs = require('node:fs');
  const { NETWORK, RESOLVER_ADDR, TREASURY_ADDR, USDC_ID, ESCROW_ID, USDC_ISSUER, OUT } = process.env;
  const d = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const n = d.networks[NETWORK];
  if (!n) throw new Error(\`deployments.json has no '\${NETWORK}' entry — add its chain constants first\`);
  // Keep the original timestamp when nothing was redeployed, so a re-run to
  // regenerate bindings does not show up as a diff.
  if (n.contracts.escrow.id !== ESCROW_ID || n.contracts.usdc.id !== USDC_ID) {
    n.deployedAt = new Date().toISOString();
  }
  n.accounts = { resolver: RESOLVER_ADDR, treasury: TREASURY_ADDR };
  // null, not '', on a network whose token has no issuer: the app reads that
  // as 'there is no trustline to open here', and '' would read as 'unknown'.
  const issuer = USDC_ISSUER || null;
  n.contracts = { usdc: { ...n.contracts.usdc, id: USDC_ID, issuer }, escrow: { id: ESCROW_ID } };
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
  1. Add a $USDC_CODE trustline to DEPOSIT_ADDRESS_$(echo "$NETWORK" | tr '[:lower:]' '[:upper:]').
     That is the account shoppers actually pay on the live rail, and a classic
     asset cannot reach an account that has not opted into it — without this
     the payment fails at submit, after they pressed send. It also needs about
     1.6 XLM of its own (1 base reserve, 0.5 for the trustline, rest fees).
         stellar tx new change-trust --source-account <deposit-account> \\
           --line $USDC_CODE:$USDC_ISSUER --network $NETWORK
     Verify it took, reading the issuer and not just the code — a trustline on
     the wrong issuer looks identical in a dashboard and fails identically:
         node scripts/check-deposit-account.mjs $NETWORK
  2. Add a $USDC_CODE trustline to the treasury ($TREASURY_ADDR) — only if you
     are reviving the escrow. Nothing on the deposit rail touches it.
         stellar tx new change-trust --source-account $TREASURY \\
           --line $USDC_CODE:$USDC_ISSUER --network $NETWORK
  3. Put the resolver secret in STELLAR_RESOLVER_SECRET_MAINNET:
         stellar keys show $RESOLVER
  4. Add the RPC host in deployments.json to the CSP in
     apps/web/lib/security-headers.ts, or the browser blocks every call.
MSG
fi
