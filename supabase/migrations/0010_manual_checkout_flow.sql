-- How a member sees manual checkout. Missing or unknown values read as viewer.
insert into config (key, value) values ('manual_checkout_flow', '"viewer"'::jsonb)
  on conflict (key) do nothing;
