#!/usr/bin/env bash
# Weekly rebuild with GRT's latest schedules (#24), from cron on the server:
#   30 4 * * 0  /srv/rentkdubs/otp/refresh.sh >> /srv/rentkdubs/otp/refresh.log 2>&1
#
# GRT's bus feed only runs about four weeks ahead. The router is stopped during the build, since
# the server can't hold both in memory; trips fall back to estimates for those few minutes.
# A failed build leaves the previous graph.obj, which is served again either way.
set -uo pipefail
cd "$(dirname "$0")"
echo "== refresh $(date -Is)"
docker rm -f "${OTP_CONTAINER:-rentkdubs-otp}" >/dev/null 2>&1 || true
cp data/graph.obj data/graph.obj.previous 2>/dev/null || true
if ! ./build.sh; then
  echo "build failed; serving the previous graph"
  [ -s data/graph.obj ] || cp data/graph.obj.previous data/graph.obj
fi
./serve.sh
