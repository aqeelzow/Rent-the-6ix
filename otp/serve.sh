#!/usr/bin/env bash
# Serve the graph otp/build.sh built (#24):  ./otp/serve.sh
#
# A standalone container, restarted with the machine, listening on 127.0.0.1:8080 only: OTP has
# no authentication, so nothing outside the server reaches it. The web app points OTP_URL there
# (or, in development, at an SSH tunnel: ssh -L 18080:127.0.0.1:8080 <server>).
set -euo pipefail
cd "$(dirname "$0")"
DATA="$PWD/data"
OTP_IMAGE="${OTP_IMAGE:-opentripplanner/opentripplanner:2.7.0}"
NAME="${OTP_CONTAINER:-rentkdubs-otp}"
PORT="${OTP_PORT:-8080}"

test -s "$DATA/graph.obj" || { echo "no graph at $DATA/graph.obj; run ./otp/build.sh first" >&2; exit 1; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  -p "127.0.0.1:$PORT:8080" \
  -v "$DATA:/var/opentripplanner" \
  -e JAVA_TOOL_OPTIONS=-Xmx1500m --memory 2g \
  "$OTP_IMAGE" --load --serve >/dev/null

echo "waiting for OTP to load the graph"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/otp/" >/dev/null 2>&1; then
    echo "OTP is answering on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 5
done
echo "OTP did not answer within 5 minutes; check: docker logs $NAME" >&2
exit 1
