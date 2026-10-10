-- Nicknames must be unique to a human eye, not just to `=`: "Admin" and "admin"
-- are the same claim. The plain unique constraint on `nickname` stays as-is.
create unique index if not exists profiles_nickname_lower_idx on profiles (lower(nickname));
