#!/usr/bin/env bash
# Build the OpenTripPlanner graph for Toronto (P1.15).
#
#   ./otp/build.sh            download if needed, clip, build the graph
#   ./otp/build.sh --fresh    discard the downloads and the clipped extract, then rebuild
#
# Layout (matches docker-compose.yml and DEPLOY.md §4):
#   otp/downloads/  the 1.03 GB Geofabrik Ontario extract — cached source, never a build input
#   otp/data/       exactly what OTP builds and serves from: toronto.osm.pbf, the GTFS zip,
#                   router-config.json. Kept free of the Ontario file on purpose: OTP merges
#                   *every* OSM file it finds in its working directory, so a stray province-wide
#                   extract would silently double the build's memory and time.
#   otp/data/graph.obj  the built graph, next to its inputs — the image's entrypoint always
#                   passes /var/opentripplanner as the graph directory, so there is only one
#                   mount and OTP decides where graph.obj goes; `--save` writes it there.
#
# Needs Docker (Docker Desktop running) and ~6 GB of free RAM for the build.
set -euo pipefail

# Git Bash rewrites arguments that look like Unix paths, so "-o /out/toronto.osm.pbf" reaches
# Docker as "C:/Program Files/Git/out/toronto.osm.pbf" and osmium fails with a confusing
# "No such file or directory". Both variables are ignored on Linux, so this stays portable.
export MSYS_NO_PATHCONV=1
# shellcheck disable=SC2155
MSYS2_ARG_CONV_EXCL="*"; export MSYS2_ARG_CONV_EXCL

cd "$(dirname "$0")"
DOWNLOADS="$PWD/downloads"
DATA="$PWD/data"
OSMIUM_IMAGE="${OSMIUM_IMAGE:-stefda/osmium-tool:latest}"
OTP_IMAGE="${OTP_IMAGE:-opentripplanner/opentripplanner:2.7.0}"
PBF_URL="https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf"
# Toronto + ~10 km: west,south,east,north. The city itself is -79.64,43.58,-79.12,43.86.
CLIP_BBOX="${CLIP_BBOX:--79.77,43.49,-78.99,43.95}"

FRESH=0
[ "${1:-}" = "--fresh" ] && FRESH=1
if [ "$FRESH" = 1 ]; then
  echo "== --fresh: removing the clipped extract and the built graph (the cached download stays)"
  rm -f "$DATA/toronto.osm.pbf" "$DATA/graph.obj"
fi

mkdir -p "$DOWNLOADS" "$DATA"

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "the Docker daemon is not running (start Docker Desktop)" >&2; exit 1; }

# --- 1. GTFS ------------------------------------------------------------------------------
# The resource URL is resolved through CKAN on every run: the City changes resource UUIDs when
# it republishes a dataset, so a hard-coded link quietly 404s months later.
if [ "$FRESH" = 1 ] || [ ! -s "$DATA/ttc-gtfs.zip" ]; then
  echo "== TTC GTFS"
  GTFS_URL=$(curl -fsSL "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-routes-and-schedules" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const r=j.result.resources.find(x=>x.format==='ZIP');if(!r){console.error('no ZIP resource');process.exit(1)}console.log(r.url)})")
  curl -fL --retry 3 --retry-delay 5 -o "$DATA/ttc-gtfs.zip" "$GTFS_URL"
  echo "   $(du -h "$DATA/ttc-gtfs.zip" | cut -f1)"
else
  echo "== TTC GTFS present, skipping"
fi

# --- 2. OSM source ------------------------------------------------------------------------
if [ "$FRESH" = 1 ] || [ ! -s "$DOWNLOADS/ontario-latest.osm.pbf" ]; then
  echo "== Geofabrik Ontario (~1.03 GB)"
  curl -fL --retry 3 --retry-delay 10 -C - -o "$DOWNLOADS/ontario-latest.osm.pbf" "$PBF_URL"
  echo "   $(du -h "$DOWNLOADS/ontario-latest.osm.pbf" | cut -f1)"
else
  echo "== Ontario extract already downloaded, skipping"
fi

# --- 3. Clip ------------------------------------------------------------------------------
if [ "$FRESH" = 1 ] || [ ! -s "$DATA/toronto.osm.pbf" ]; then
  echo "== clipping to $CLIP_BBOX"
  docker run --rm -v "$DOWNLOADS:/in:ro" -v "$DATA:/out" "$OSMIUM_IMAGE" \
    osmium extract -b "$CLIP_BBOX" -o /out/toronto.osm.pbf /in/ontario-latest.osm.pbf
  echo "   $(du -h "$DATA/toronto.osm.pbf" | cut -f1)"
else
  echo "== clipped extract present, skipping"
fi

# --- 4. Router config ---------------------------------------------------------------------
# Served and built from otp/data, so the config has to live there; otp/router-config.json is
# the version-controlled source of truth.
cp "$PWD/router-config.json" "$DATA/router-config.json"

# --- 5. Build -----------------------------------------------------------------------------
echo "== building the graph (the slow part: tens of minutes, needs ~6 GB RAM)"
# No directory argument and no --save path: the image's entrypoint already appends
# /var/opentripplanner, and passing a second path makes OTP abort with
# "You must supply a single directory name".
docker run --rm -v "$DATA:/var/opentripplanner" -e JAVA_TOOL_OPTIONS=-Xmx6g --memory 7g \
  "$OTP_IMAGE" --build --save

test -s "$DATA/graph.obj" || { echo "the build produced no graph.obj" >&2; exit 1; }
echo "== graph ready: $(du -h "$DATA/graph.obj" | cut -f1) at otp/data/graph.obj"
echo "   start it with: docker compose --profile otp up -d otp"
echo "   then smoke-test: ./otp/smoke-test.sh"
