-- Views run as their owner unless told otherwise, so `leaderboard` and
-- `match_history` were reading straight past RLS. Recreate them as
-- security_invoker: each caller sees exactly what its own policies allow.
-- (Postgres 15+; PGlite ships 16, Supabase 17.)

create or replace view leaderboard with (security_invoker = true) as
  select r.mode, p.nickname, p.avatar, r.rating, r.rd, r.games, r.user_id
  from ratings r
  join profiles p using (user_id)
  where r.games > 0
  order by r.mode, r.rating desc;

create or replace view match_history with (security_invoker = true) as
  select gp.user_id, g.id as game_id, g.mode, g.status, gp.seat, gp.result,
         gp.final_vp, gp.rating_before, gp.rating_after, g.finished_at
  from game_players gp
  join games g on g.id = gp.game_id
  where g.status in ('finished', 'aborted');
