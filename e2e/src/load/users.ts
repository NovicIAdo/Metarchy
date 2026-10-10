// Deterministic load-test user ids. profiles.user_id references auth.users, so
// minted JWT subjects must exist there; the ids are a pure function of a slot
// number so the SQL seeding step and every generator worker agree without any
// coordination. Seeding (run once, as postgres, against the sacrificial DB):
//
//   with ids as (
//     select n, (overlay(overlay(md5('metarchy-load-' || n) placing '4' from 13 for 1)
//                        placing '8' from 17 for 1))::uuid as uid
//     from generate_series(0, 1999) n)
//   insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
//                           created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
//   select '00000000-0000-0000-0000-000000000000'::uuid, uid, 'authenticated',
//          'authenticated', 'load-' || n || '@load.metarchy.local', now(), now(), now(),
//          '{"provider":"loadtest","providers":["loadtest"]}'::jsonb, '{}'::jsonb
//   from ids on conflict (id) do nothing;

import { createHash } from 'node:crypto'

/** Mirrors the SQL: md5 of the slot tag with UUID version/variant nibbles set. */
export function loadUserId(n: number): string {
  const h = createHash('md5').update(`metarchy-load-${n}`).digest('hex')
  const s = h.slice(0, 12) + '4' + h.slice(13, 16) + '8' + h.slice(17, 32)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
