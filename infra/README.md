# Infra

Staging app: `metarchy-staging` (Fly.io, region `fra`, one machine) against the
Supabase project `Metarchy` (`oakrtrjtihuxbjmmpfkg`, eu-central-2).

## Standard deploy

```sh
FLY_API_TOKEN=$(cat ~/.config/metarchy/fly_api_token) \
  flyctl deploy . --config infra/fly.toml --remote-only --yes
```

Secrets (already set): `DATABASE_URL` (Supavisor pooler URL for the dedicated
least-privilege `metarchy_server` role; credentials live only in
`~/.config/metarchy/`), `SUPABASE_URL` (JWKS + issuer derive from it).
Migrations are applied to Supabase via MCP/CLI, not on boot
(`MIGRATE_ON_BOOT=1` exists for dev/PGlite).

Solana login uses the public `SUPABASE_ANON_KEY` for authoritative Auth user
lookups. The staging public key and `SOLANA_AUTH_*` values are in `fly.toml`;
the local release script applies those public values while preserving existing
machine secrets. Apply the private identity migration and enable the Supabase
Solana provider before releasing the new image. The complete setup and Seeker
acceptance flow are in [Solana-Wallet-Login.md](../docs/Solana-Wallet-Login.md).

## 2026-07-08 workaround — flyctl deploy hangs on this network

`flyctl deploy` (0.4.61 and 0.4.67, remote/depot/local/--image alike) hangs at
"==> Building image" from this machine: the builder provisions but never
receives a build; read-only/API commands work fine. Working path used for the
Stage 2 staging deploy:

1. Build in the colima VM (rosetta, amd64):
   `git ls-files -co --exclude-standard | rsync -a --files-from=- . ~/.metarchy-build-ctx/`
   then `colima ssh -- sh -c "cd /Users/<user>/.metarchy-build-ctx && docker build --platform linux/amd64 -t registry.fly.io/metarchy-staging:<tag> -f infra/Dockerfile ."`
2. Push: `docker login registry.fly.io -u x --password-stdin` (Fly API token),
   `docker push` (both via `colima ssh`).
3. Create/update the machine via the Machines REST API
   (`POST https://api.machines.dev/v1/apps/metarchy-staging/machines`) with the
   service/check config mirrored from `fly.toml` — that API works fine.
4. First-time only: allocate public IPs (`flyctl ips allocate-v4 --shared`,
   `flyctl ips allocate-v6`) — normally `flyctl deploy` does this.

### `infra/deploy-local.sh` — the same path, scripted (2026-07-27)

The steps above are now a script, because GitHub Actions minutes ran out (a
private repo on GitHub Free gets 2000 a month for the whole account, and one push
of this repo costs about twelve). Deploying never needed GitHub:

```sh
infra/deploy-local.sh            # build only, changes nothing
infra/deploy-local.sh --push     # build + push the image, machine untouched
infra/deploy-local.sh --release  # build + push + point staging at it
```

It refuses to ship a dirty tree, and it moves the machine through the Machines
REST API directly. **`flyctl machine update` hangs from this machine too** — not
just `flyctl deploy`: on 2026-07-30 it sat at 50% CPU for seven minutes without
touching the machine, while the identical update over the REST endpoint returned
instantly. Treat every flyctl *write* as unavailable here; its read commands are
fine.

Smoke: `e2e/scripts/staging-smoke.ts` (healthz → JWKS rejection → real-token
vs_bots game to completion). CI/another network should retry the standard path.
