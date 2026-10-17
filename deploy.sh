#!/usr/bin/env bash
# deploy.sh — owner: D (P0.9)
#
# Deploy `main` to the Vultr instance in one command, from this machine:
#
#   DEPLOY_HOST=root@203.0.113.7 SITE_HOST=203-0-113-7.sslip.io ./deploy.sh
#
# Optional: DEPLOY_PATH (default /srv/rentthe6ix), SERVICES (default "web worker"),
# NO_HEALTHCHECK=1 to skip the final HTTP check.
#
# What it does: SSH in, hard-reset the checkout to origin/main (the box is a mirror of
# main, never a place to edit), rebuild the named services, recreate them, then verify
# the site answers over HTTPS. Never rebuilds `otp`: the graph takes minutes and only
# changes when GTFS or OSM do (DEPLOY.md §4).
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST, e.g. root@203.0.113.7}"
DEPLOY_PATH="${DEPLOY_PATH:-/srv/rentthe6ix}"
SERVICES="${SERVICES:-web worker}"
BRANCH="${BRANCH:-main}"

echo "==> $DEPLOY_HOST:$DEPLOY_PATH  ($SERVICES from $BRANCH)"

ssh "$DEPLOY_HOST" "bash -s" <<REMOTE
set -euo pipefail
cd '$DEPLOY_PATH'

echo "--- git ---"
git fetch --prune origin '$BRANCH'
git reset --hard "origin/$BRANCH"
git --no-pager log --oneline -1

echo "--- compose ---"
docker compose build $SERVICES
docker compose up -d --remove-orphans
docker compose ps
REMOTE

if [ "${NO_HEALTHCHECK:-0}" != "1" ]; then
  if [ -z "${SITE_HOST:-}" ]; then
    echo "!! SITE_HOST unset: skipping the HTTPS check (set it to the URL host)"
    exit 0
  fi
  echo "==> checking https://$SITE_HOST"
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if code=$(curl -fsS -o /dev/null -w '%{http_code}' "https://$SITE_HOST/" 2>/dev/null); then
      echo "==> up (HTTP $code) https://$SITE_HOST"
      exit 0
    fi
    echo "    attempt $attempt: not answering yet"
    sleep 6
  done
  echo "!! https://$SITE_HOST did not answer; check: ssh $DEPLOY_HOST 'cd $DEPLOY_PATH && docker compose logs --tail=50 caddy web'"
  exit 1
fi
