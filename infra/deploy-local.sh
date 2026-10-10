#!/usr/bin/env bash
# Deploy staging WITHOUT GitHub Actions.
#
# Why this exists: the deploy workflow costs Actions minutes, and a private repo
# on GitHub Free gets 2000 a month shared across the whole account — which this
# project ran out of. Nothing about deploying actually needs GitHub: this is the
# path that shipped the Stage 2 staging deploy by hand (infra/README.md §2026-07-08),
# turned into a script so it is repeatable.
#
# It also sidesteps the reason the workflow existed in the first place: `flyctl
# deploy` hangs at "==> Building image" from this machine (0.4.61 and 0.4.67,
# remote/depot/local/--image alike), while read-only and Machines API commands
# work fine. So: build the image locally, push it to Fly's registry, and move the
# machine onto it through the API.
#
# Usage:
#   infra/deploy-local.sh                 # build only, change nothing (default)
#   infra/deploy-local.sh --push          # build + push the image, machine untouched
#   infra/deploy-local.sh --release       # build + push + point staging at it
#
# Requires: colima running (docker inside it), a Fly API token at
# ~/.config/metarchy/fly_api_token.

set -euo pipefail

APP="metarchy-staging"
REGISTRY="registry.fly.io/${APP}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="${HOME}/.config/metarchy/fly_api_token"

MODE="build"
case "${1:-}" in
  --push) MODE="push" ;;
  --release) MODE="release" ;;
  "") MODE="build" ;;
  *)
    echo "unknown flag: $1 (expected --push or --release)" >&2
    exit 2
    ;;
esac

cd "$REPO_ROOT"
GIT_SHA="$(git rev-parse --short HEAD)"
DIRTY=""
if [[ -n "$(git status --porcelain)" ]]; then DIRTY="-dirty"; fi
TAG="${GIT_SHA}${DIRTY}"
IMAGE="${REGISTRY}:${TAG}"

echo "==> app       ${APP}"
echo "==> image     ${IMAGE}"
echo "==> mode      ${MODE}"

# A dirty tree is fine for a build, but shipping one makes the deployed image
# impossible to trace back to a commit.
if [[ -n "$DIRTY" && "$MODE" != "build" ]]; then
  echo "refusing to ship a dirty tree — commit first (tag would be ${TAG})" >&2
  exit 1
fi

if ! colima status >/dev/null 2>&1; then
  echo "colima is not running: colima start" >&2
  exit 1
fi

# linux/amd64 explicitly: the machine is amd64, this laptop is arm64, and a
# silently-arm image fails at boot rather than at build.
echo "==> building (linux/amd64, this takes a few minutes)"
docker build --platform linux/amd64 \
  -t "$IMAGE" \
  -f infra/Dockerfile \
  --build-arg "GIT_SHA=${GIT_SHA}" \
  .

if [[ "$MODE" == "build" ]]; then
  echo "✓ built ${IMAGE} — nothing was pushed or released (pass --push / --release)"
  exit 0
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "no Fly token at ${TOKEN_FILE}" >&2
  exit 1
fi
FLY_TOKEN="$(cat "$TOKEN_FILE")"

echo "==> pushing to Fly's registry"
printf '%s' "$FLY_TOKEN" | docker login registry.fly.io -u x --password-stdin
docker push "$IMAGE"

if [[ "$MODE" == "push" ]]; then
  echo "✓ pushed ${IMAGE} — staging still runs its previous image (pass --release)"
  exit 0
fi

# One machine on purpose: rooms live in process memory, so staging is never
# scaled out and never scaled to zero (fly.toml auto_stop_machines = off).
echo "==> pointing ${APP} at ${IMAGE}"
# Straight at the Machines REST API, deliberately: `flyctl machine update` hangs
# from this machine exactly like `flyctl deploy` does — it sat at 50% CPU for
# seven minutes on 2026-07-30 without touching the machine, and the same update
# through this endpoint returned instantly. Only flyctl's *read* commands are
# reliable here, so the release path uses none of its writes.
#
# Preserve the machine config and secrets, then apply the image and public
# environment values from fly.toml so local and workflow releases agree.
API="https://api.machines.dev/v1/apps/${APP}/machines"
MACHINE_ID="$(curl -sf -H "Authorization: Bearer ${FLY_TOKEN}" "$API" | python3 -c '
import json, sys
machines = [m for m in json.load(sys.stdin) if m["state"] != "destroyed"]
if len(machines) != 1:
    sys.exit(f"expected exactly one staging machine, found {len(machines)}")
print(machines[0]["id"])
')"
echo "==> machine   ${MACHINE_ID}"

curl -sf -H "Authorization: Bearer ${FLY_TOKEN}" "${API}/${MACHINE_ID}" \
  | IMAGE="$IMAGE" python3 -c '
import json, os, sys
from pathlib import Path
config = json.load(sys.stdin)["config"]
config["image"] = os.environ["IMAGE"]
# fly.toml uses a flat [env] section with JSON-compatible quoted string values.
# Reject unsupported syntax instead of silently omitting a deployment setting.
public_env = {}
in_env = False
for raw in Path("infra/fly.toml").read_text().splitlines():
    line = raw.strip()
    if line.startswith("["):
        in_env = line == "[env]"
        continue
    if not in_env or not line or line.startswith("#"):
        continue
    key, value = line.split("=", 1)
    parsed, end = json.JSONDecoder().raw_decode(value.strip())
    remaining = value.strip()[end:].strip()
    if not isinstance(parsed, str) or (remaining and not remaining.startswith("#")):
        sys.exit("unsupported fly.toml public environment syntax")
    public_env[key.strip()] = parsed
config.setdefault("env", {}).update(public_env)
json.dump({"config": config}, sys.stdout)
' > /tmp/metarchy-machine-update.json

curl -sf -X POST \
  -H "Authorization: Bearer ${FLY_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @/tmp/metarchy-machine-update.json \
  "${API}/${MACHINE_ID}" \
  | python3 -c '
import json, sys
r = json.load(sys.stdin)
# Values pulled out first: a backslash inside an f-string expression is a
# SyntaxError before Python 3.12, and the system python here is 3.9 — it blew
# up AFTER the POST had already been accepted, which reads as a failed release.
error = r.get("error")
if error:
    sys.exit("machine update refused: " + str(error))
state = r.get("state")
image = r["config"]["image"]
print("    accepted — state " + str(state) + ", image " + image)
'

echo "==> waiting for healthz"
for _ in $(seq 1 25); do
  if curl -sf "https://${APP}.fly.dev/healthz" >/dev/null; then
    echo "✓ released ${IMAGE} and healthz is answering"
    exit 0
  fi
  sleep 3
done
echo "released, but healthz never answered — check: flyctl logs --app ${APP}" >&2
exit 1
