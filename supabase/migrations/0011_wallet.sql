-- One row per wallet that signs in, and any wallet registered before that.
--
-- The first successful login inserts the row with both flags false and does
-- not overwrite a row that is already here, so a ban or a faucet grant made
-- ahead of the first visit survives it. `profile` stays the encrypted Día
-- envelope: most wallets never have one, and a login has to be able to read
-- these flags without PROFILE_ENC_KEY.
--
-- `faucet_allowed` is read only when `config.faucet_open_to_all` is false.
-- `banned` refuses the login cookie and the faucet. Same guard as the other
-- tables: RLS on, no policies.

create table wallet (
  network        network_id      not null,
  address        stellar_address not null,
  faucet_allowed boolean         not null default false,
  banned         boolean         not null default false,
  created_at     timestamptz     not null default now(),
  updated_at     timestamptz     not null default now(),
  primary key (network, address)
);

create trigger wallet_touch before update on wallet
  for each row execute function touch_updated_at();

alter table wallet enable row level security;

insert into config (key, value) values ('faucet_open_to_all', 'false'::jsonb)
  on conflict (key) do nothing;
