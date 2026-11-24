#!/usr/bin/env bash
# One route per mode against the OTP that otp/serve.sh started:  ./otp/smoke-test.sh
#
# Runs the client in a throwaway Node container on the host network, so the server needs no Node
# of its own. Override the trip with FROM_LAT/FROM_LON/TO_LAT/TO_LON/DATE/TIME.
set -euo pipefail
cd "$(dirname "$0")"
NODE_IMAGE="${NODE_IMAGE:-node:24-alpine}"
PORT="${OTP_PORT:-8080}"

curl -fsS "http://127.0.0.1:$PORT/otp/" >/dev/null || { echo "OTP is not answering on 127.0.0.1:$PORT; run ./otp/serve.sh" >&2; exit 1; }
docker run --rm --network host -v "$PWD:/otp:ro" \
  -e FROM_LAT -e FROM_LON -e TO_LAT -e TO_LON -e DATE -e TIME \
  "$NODE_IMAGE" node /otp/smoke-test.mjs "http://127.0.0.1:$PORT"
