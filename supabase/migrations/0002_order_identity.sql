-- An order is identified by its memo, not by the chat that produced it.
--
-- 0001 made chat_id the primary key so that "exactly one order per chat" was a
-- schema fact. It is still a schema fact — `unique (chat_id)` says it exactly
-- as well — but the primary key was wrong about when an order comes into
-- existence. It is born in POST /api/deposit, at `mintMemo()`, and that route
-- has no chat id to offer: the session id lives in a useRef in use-chat.ts and
-- has never crossed the wire. A NOT NULL primary key there would have forced
-- either a fake uuid or an order row that cannot be written until the chat is,
-- and the second one loses the depositor record that the card gate reads.
--
-- (network, memo) is what the money is actually keyed on. `mintMemo` draws from
-- the CSPRNG, Horizon matches payments on it, and claimDeposit's once-only
-- update already predicates on it. Making it the primary key means the row the
-- card path looks up is the row the deposit path created, with no join.
--
-- chat_id becomes nullable and unique. Several orders may have no chat — in
-- Postgres a unique constraint permits many NULLs, which is the right reading:
-- each unlinked order is its own, and no chat has two.
--
-- address becomes nullable for the same reason. In realModeMode() === 'open'
-- nothing is proven, so the deposit route deliberately does not record an
-- address; writing the claimed one down would be recording a guess and then
-- trusting it. NULL means "nobody was checked", which is what depositorOf()
-- returning undefined already means to its caller.
--
-- The chat FK stops cascading. An order is a financial record and a chat is a
-- conversation; deleting the conversation must not delete the evidence that
-- money moved. This matters directly for the retention policy in DEPLOY.md —
-- expiring transcripts should orphan orders, never erase them.

alter table orders drop constraint orders_pkey;
alter table orders alter column chat_id drop not null;
alter table orders alter column address drop not null;

alter table orders add constraint orders_pkey primary key (network, memo);
alter table orders add constraint orders_one_per_chat unique (chat_id);
alter table orders drop constraint orders_network_memo_key;

alter table orders drop constraint orders_chat_id_fkey;
alter table orders add constraint orders_chat_id_fkey
  foreign key (chat_id) references chat (id) on delete set null;

-- orders_by_owner in 0001 leads with address, which is now nullable; the index
-- is still correct for /mis-compras (NULLs simply never match a G-address) and
-- is left alone.
