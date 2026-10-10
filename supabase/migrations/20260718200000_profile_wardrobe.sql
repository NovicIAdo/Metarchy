-- Actor wardrobe loadouts (protocol WardrobeSchema JSON). Written only by the
-- game server (clients lost direct profile writes in 20260711180000).
alter table public.profiles
  add column if not exists wardrobe jsonb;
