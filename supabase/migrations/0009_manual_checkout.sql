-- Durable preparation-service orders. Legacy checkouts remain in kv.
create table manual_checkout (
  order_id text primary key check (order_id ~ '^[0-9a-f]{64}$'),
  record jsonb not null,
  event_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table manual_checkout enable row level security;
create index manual_checkout_dispatch on manual_checkout(updated_at)
  where record->>'openSig' is not null and record->>'jobId' is null and record->>'outcome' is null;
insert into config (key, value) values ('manual_checkout_enabled', 'false'::jsonb)
  on conflict (key) do nothing;
