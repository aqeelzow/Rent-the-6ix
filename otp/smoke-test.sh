#!/usr/bin/env bash
# One route per mode against the running OTP (P1.15):  ./otp/smoke-test.sh
#
# The compose service publishes no host port on purpose (OTP has no authentication), so this
# runs the client inside a throwaway Node container attached to the same compose network and
# reaches the router as http://otp:8080.
set -euo pipefail

# Git Bash rewrites Unix-looking arguments; the container paths below must survive intact.
export MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL="*"; export MSYS2_ARG_CONV_EXCL

cd "$(dirname "$0")/.."
NODE_IMAGE="${NODE_IMAGE:-node:24-alpine}"
READY_TIMEOUT="${READY_TIMEOUT:-300}"

docker compose --profile otp up -d otp
CONTAINER=$(docker compose --profile otp ps -q otp)
[ -n "$CONTAINER" ] || { echo "the otp service is not running" >&2; exit 1; }
NETWORK=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CONTAINER" | awk '{print $1}')
[ -n "$NETWORK" ] || { echo "cannot determine the compose network" >&2; exit 1; }

echo "waiting for OTP to finish loading the graph (up to ${READY_TIMEOUT}s)"
deadline=$((SECONDS + READY_TIMEOUT))
until docker run --rm --network "$NETWORK" "$NODE_IMAGE" -e "
    fetch('http://otp:8080/otp/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));
  " >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "OTP did not answer within ${READY_TIMEOUT}s; check: docker compose logs otp" >&2
    exit 1
  fi
  sleep 5
done
echo "OTP is answering"

docker run --rm --network "$NETWORK" -v "$PWD/otp:/otp:ro" \
  -e FROM_LAT -e FROM_LON -e TO_LAT -e TO_LON -e DATE -e TIME \
  "$NODE_IMAGE" node /otp/smoke-test.mjs http://otp:8080
