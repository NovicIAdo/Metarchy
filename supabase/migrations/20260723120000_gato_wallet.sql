-- GATO (GameToken) soft currency: per-user wallet + purchased shop items
-- (entitlements). Server-only data, written over the authenticated socket; the
-- catalog and prices live in protocol shop.ts. The start-balance grant happens
-- lazily in code on first wallet touch (no default here — 0 means "spent out").

create table wallets (
  user_id    uuid primary key references profiles (user_id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table purchases (
  user_id    uuid not null references profiles (user_id) on delete cascade,
  item_id    text not null,
  price      bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table wallets enable row level security;
create policy server_all_wallets on wallets
  for all to metarchy_server using (true) with check (true);
grant select, insert, update on wallets to metarchy_server;

alter table purchases enable row level security;
create policy server_all_purchases on purchases
  for all to metarchy_server using (true) with check (true);
grant select, insert on purchases to metarchy_server;

-- Beta grandfathering: players already wearing AI skins keep them — grant those
-- as zero-price purchases so the new entitlement gate cannot strip anyone.
insert into purchases (user_id, item_id, price)
select p.user_id, 'skin.' || s.key || '.' || (s.value #>> '{}'), 0
from profiles p, jsonb_each(p.wardrobe -> 'skins') as s
where p.wardrobe ? 'skins' and jsonb_typeof(s.value) = 'string'
on conflict do nothing;
