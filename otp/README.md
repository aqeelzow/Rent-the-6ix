# OpenTripPlanner (P1.15)

Every travel time in the product — transit, walk, bike and free-flow driving — comes from here.
The graph is built once and kept on disk; `otp/data/graph.obj` is git-ignored because it is
large and reproducible.

## Build

```bash
./otp/build.sh            # download if needed, clip, build
./otp/build.sh --fresh    # discard the clipped extract + graph and rebuild
docker compose --profile otp up -d otp
./otp/smoke-test.sh       # one route per mode
```

Needs Docker Desktop running (or the Docker daemon on Linux) and ~6 GB of free RAM. The first
run downloads the 1.03 GB Geofabrik Ontario extract and the TTC GTFS zip; the build step itself
is the slow part, tens of minutes.

## What lands where

| Path | Contents | In git |
| --- | --- | --- |
| `otp/router-config.json` | routing defaults (walk/bike/car speeds, 3 itineraries) | yes |
| `otp/downloads/` | the raw 1.03 GB Ontario extract — cached source only | no |
| `otp/data/` | everything OTP builds and serves from: `toronto.osm.pbf`, `ttc-gtfs.zip`, `router-config.json`, and `graph.obj` after a build | no |

`otp/data` deliberately never holds the province-wide extract: OTP merges **every** OSM file in
its working directory, so leaving the Ontario file there would quietly build a province-sized
graph — several times the memory and time for data the demo never uses.

`graph.obj` lands in `otp/data` and not in a `graphs/` directory because the image's entrypoint
always passes `/var/opentripplanner` as the graph directory; `--save` is a flag, not a path, and
handing it a second path makes OTP abort with "You must supply a single directory name".

## Why it is clipped

The clip box is Toronto + ~10 km (`-79.77,43.49,-78.99,43.95`). Transit is limited to the TTC
feed, so travel outside the city is out of scope; clipping keeps the graph inside the 7 GB
container limit with room to spare.

## Driving is free-flow

OTP has no traffic model or parking here, so a drive time is an unconstrained best case. The
engine returns it with `method: 'otp'` and the label **"driving, no traffic"** — the honesty is
in the label, not in the number.

## If the graph is missing or stale

Travel features must never break a deploy: the `otp` service sits behind the `otp` compose
profile, so `docker compose up -d` never starts it, and `deploy.sh` never rebuilds it. Until a
graph exists, callers fall back to labelled straight-line distance (`method: 'straight_line'`).
Rebuild after the City publishes a new GTFS feed, or when the graph object is older than the
next demo — `./otp/build.sh --fresh` then restart the service.

## Deployment

`DEPLOY.md` §4 covers the instance: same script, but the download and the build happen on the
8 GB box. `OTP_IMAGE` in the environment pins the image if `2.7.0` is not the tag the graph was
built against — a graph built by one OTP version is not guaranteed loadable by another.
