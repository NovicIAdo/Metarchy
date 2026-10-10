-- Tutorial mode: a no-timer coached game against a bot. It shares the vs_bots
-- side-effect profile (never rated, never recorded as a replay, never
-- spectatable), so the only schema change is widening the games.mode CHECK to
-- admit it. The ratings table check stays rated-modes-only — a tutorial never
-- writes a rating.
alter table games drop constraint if exists games_mode_check;
alter table games
  add constraint games_mode_check
  check (mode in ('1v1', 'ffa3', '2v2', 'vs_bots', 'tutorial'));
