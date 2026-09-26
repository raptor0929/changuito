-- changuito: the deposit -> card rail, made durable.
--
-- Three tables, and each one replaces something that used to live in Redis at
-- a TTL. The card a customer keeps has no expiry, so it does not belong in a
-- cache with an eviction policy; the conversation is the shopper's own record
-- of what they bought; and the order is the thing both of those meet at.
--
-- No card data anywhere. `card_id` is a reference to an object Vyrion holds,
-- and it is useless without a fresh SEP-53 signature from the owning wallet.
-- PAN and CVV are read per view and never written down - see
-- packages/mcp/src/pay/types.ts.

-- Stellar public keys, everywhere one is stored. Written once so the three
-- tables cannot drift apart on what an address is.
create domain stellar_address as text
  check (value ~ '^G[A-Z2-7]{55}$');

create domain network_id as text
  check (value in ('testnet', 'mainnet'));

-- ---------------------------------------------------------------- the card --

-- One row per customer per network. The primary key is the whole point: two
-- lambdas racing to issue a first card cannot both win, so "exactly one card
-- per customer" is an invariant the database holds rather than a convention
-- the application remembers.
--
-- Keyed on (network, address) and not address alone, so a testnet card funded
-- with play money can never be the one a mainnet deposit tops up.
create table card_owner (
  network    network_id      not null,
  address    stellar_address not null,
  card_id    text            not null,
  created_at timestamptz     not null default now(),
  primary key (network, address)
);

-- --------------------------------------------------------- the conversation --

-- Durable now, where turn-store.ts keeps it in Redis at a 1h TTL. Redis stays
-- the working store for the hop loop - twelve round trips a turn - and this is
-- written once, after a clean return, for the shopper to come back to.
--
-- `transcript` holds encodeTurn()'s output verbatim. Do not hand-roll that
-- shape: RenderCache.products is a Map and JSON.stringify renders a Map as {}
-- with no error, which is exactly the bug the v:1 codec exists to prevent.
--
-- address is NOT NULL on purpose. A guest has no chg_user cookie, so a guest
-- conversation is never written here at all.
create table chat (
  id         uuid            primary key,
  network    network_id      not null,
  address    stellar_address not null,
  title      text,
  transcript jsonb           not null,
  created_at timestamptz     not null default now(),
  updated_at timestamptz     not null default now()
);

create index chat_by_owner on chat (address, network, updated_at desc);

-- ---------------------------------------------------------------- the order --

-- Exactly one order per chat, said by the schema: chat_id is the primary key.
--
-- This single table replaces two Redis keys. `address` is what
-- rememberDepositor wrote (who the gate let open this memo) and `card_id` is
-- the claim latch that SET NX used to hold. The once-only guarantee becomes:
--
--   update orders set card_id = $1 where network = $2 and memo = $3
--                                   and card_id is null returning card_id;
--
-- Same atomicity, no 24h expiry, and an audit trail afterwards.
create table orders (
  chat_id      uuid            primary key references chat (id) on delete cascade,
  network      network_id      not null,
  memo         text            not null,
  address      stellar_address not null,
  status       text            not null default 'quoted'
                 check (status in ('quoted', 'paid', 'carded', 'done', 'failed')),
  -- What the card is funded with, in USD cents: the basket plus the FX buffer.
  amount_cents integer         not null check (amount_cents > 0),
  -- The pesos the shopper actually saw. Kept because the rate moves and a
  -- receipt that recomputes itself is not a receipt.
  ars_quoted   integer,
  card_id      text,
  tx_hash      text,
  cart_id      text,
  handoff_url  text,
  created_at   timestamptz     not null default now(),
  updated_at   timestamptz     not null default now(),
  -- A memo identifies one order on one network, forever.
  unique (network, memo)
);

create index orders_by_owner on orders (address, network, created_at desc);

-- ------------------------------------------------------------------- guards --

-- The server is the boundary: it connects with service credentials, which
-- bypass RLS. Enabling it with no policies means that if the anon key is ever
-- pointed at this schema - a misconfigured client, a future PostgREST call -
-- it reads nothing rather than everything. Cheap, and the failure it prevents
-- is total.
alter table card_owner enable row level security;
alter table chat       enable row level security;
alter table orders     enable row level security;

-- updated_at that is actually true, rather than true wherever someone
-- remembered to set it.
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger chat_touch   before update on chat
  for each row execute function touch_updated_at();
create trigger orders_touch before update on orders
  for each row execute function touch_updated_at();
