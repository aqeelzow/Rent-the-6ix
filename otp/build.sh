#!/usr/bin/env bash
# Build the OpenTripPlanner graph for the Region of Waterloo (#24): streets from OpenStreetMap,
# Grand River Transit buses and the ION light rail from GRT's GTFS feeds.
#
#   ./otp/build.sh            download if needed, clip, build the graph
#   ./otp/build.sh --fresh    discard the downloads and the clipped extract, then rebuild
#
# Layout (matches docker-compose.yml and DEPLOY.md §4):
#   otp/downloads/  the 1.03 GB Geofabrik Ontario extract — cached source, never a build input
#   otp/data/       exactly what OTP builds and serves from: waterloo.osm.pbf, the GTFS zips,
#                   router-config.json. Kept free of the Ontario file on purpose: OTP merges
#                   *every* OSM file it finds in its working directory, so a stray province-wide
#                   extract would silently double the build's memory and time.
#   otp/data/graph.obj  the built graph, next to its inputs — the image's entrypoint always
#                   passes /var/opentripplanner as the graph directory, so there is only one
#                   mount and OTP decides where graph.obj goes; `--save` writes it there.
#
# Needs Docker and ~3 GB of free RAM for the build (the region is small; Toronto needed 6).
#
# GRT's bus feed only runs about four weeks ahead, so rebuild at least every couple of weeks or
# transit trips start coming back empty (walking, cycling and driving keep working).
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
# Kitchener, Waterloo and Cambridge (GRT's whole service area) + a margin: west,south,east,north.
# The City of Waterloo itself is -80.626,43.432,-80.467,43.532.
CLIP_BBOX="${CLIP_BBOX:--80.75,43.30,-80.20,43.60}"
# GRT publishes its schedules as numbered static feeds: 1 is the current bus service, 2 the ION
# light rail (0 is an older, expired bus feed).
GRT_FEEDS="https://webapps.regionofwaterloo.ca/api/grt-routes/api/staticfeeds"

FRESH=0
[ "${1:-}" = "--fresh" ] && FRESH=1
if [ "$FRESH" = 1 ]; then
  echo "== --fresh: removing the clipped extract and the built graph (the cached download stays)"
  rm -f "$DATA/waterloo.osm.pbf" "$DATA/graph.obj" "$DATA"/*-gtfs.zip
fi

mkdir -p "$DOWNLOADS" "$DATA"

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "the Docker daemon is not running" >&2; exit 1; }
# Toronto's inputs, if this directory once built that graph: OTP would merge them in.
rm -f "$DATA/toronto.osm.pbf" "$DATA/ttc-gtfs.zip"

# --- 1. GTFS ------------------------------------------------------------------------------
# Always fetched fresh: the bus feed rolls forward every few weeks. OTP reads every zip whose name
# contains "gtfs".
echo "== GRT GTFS"
curl -fL --retry 3 --retry-delay 5 -o "$DATA/grt-bus-gtfs.zip" "$GRT_FEEDS/1"
curl -fL --retry 3 --retry-delay 5 -o "$DATA/grt-ion-gtfs.zip" "$GRT_FEEDS/2"
echo "   bus $(du -h "$DATA/grt-bus-gtfs.zip" | cut -f1), ION $(du -h "$DATA/grt-ion-gtfs.zip" | cut -f1)"

# --- 2. OSM source ------------------------------------------------------------------------
# Geofabrik's smallest file covering Kitchener-Waterloo is the whole province. It's only needed to
# cut the region out, so it's skipped while that cut exists and deleted once it's made: schedule
# refreshes download just the two GTFS zips. --fresh fetches it again, to pick up new streets.
if [ -s "$DATA/waterloo.osm.pbf" ] && [ "$FRESH" = 0 ]; then
  echo "== Waterloo extract present, skipping the Ontario download"
elif [ ! -s "$DOWNLOADS/ontario-latest.osm.pbf" ]; then
  echo "== Geofabrik Ontario (~1.03 GB)"
  curl -fL --retry 3 --retry-delay 10 -C - -o "$DOWNLOADS/ontario-latest.osm.pbf" "$PBF_URL"
  echo "   $(du -h "$DOWNLOADS/ontario-latest.osm.pbf" | cut -f1)"
else
  echo "== Ontario extract already downloaded, skipping"
fi

# --- 3. Clip ------------------------------------------------------------------------------
if [ "$FRESH" = 1 ] || [ ! -s "$DATA/waterloo.osm.pbf" ]; then
  echo "== clipping to $CLIP_BBOX"
  docker run --rm -v "$DOWNLOADS:/in:ro" -v "$DATA:/out" "$OSMIUM_IMAGE" \
    osmium extract -b "$CLIP_BBOX" -o /out/waterloo.osm.pbf /in/ontario-latest.osm.pbf
  echo "   $(du -h "$DATA/waterloo.osm.pbf" | cut -f1)"
  rm -f "$DOWNLOADS/ontario-latest.osm.pbf"
else
  echo "== clipped extract present, skipping"
fi

# --- 4. Router config ---------------------------------------------------------------------
# Served and built from otp/data, so the config has to live there; otp/router-config.json is
# the version-controlled source of truth.
cp "$PWD/router-config.json" "$DATA/router-config.json"

# --- 5. Build -----------------------------------------------------------------------------
echo "== building the graph (a few minutes, needs ~3 GB RAM)"
# No directory argument and no --save path: the image's entrypoint already appends
# /var/opentripplanner, and passing a second path makes OTP abort with
# "You must supply a single directory name".
docker run --rm -v "$DATA:/var/opentripplanner" -e JAVA_TOOL_OPTIONS=-Xmx2500m --memory 3g \
  "$OTP_IMAGE" --build --save

test -s "$DATA/graph.obj" || { echo "the build produced no graph.obj" >&2; exit 1; }
echo "== graph ready: $(du -h "$DATA/graph.obj" | cut -f1) at otp/data/graph.obj"
echo "   serve it with: ./otp/serve.sh"
