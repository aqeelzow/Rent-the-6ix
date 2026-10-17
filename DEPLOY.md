# DEPLOY.md

How RentThe6ix runs in production: one Vultr instance running Docker Compose (Caddy,
`web`, `worker`, and `otp` behind a profile) talking to a TigerData service. Owner: **D**.

Status: everything in this file is built and tested locally (Windows, Docker 29.2.1) except
the parts that need the instance itself — they are marked **[needs instance]**. Record real
values in `PERSON_D.md` → Environment.

```
Caddyfile              TLS + reverse proxy, everything to web:3000
docker-compose.yml     caddy, web, worker, otp (profile "otp")
Dockerfile             two targets: `web` (Next standalone) and `worker` (runs TS directly)
.dockerignore          keeps secrets, node_modules, OTP data and scraped snapshots out
deploy.sh              one-command deploy over SSH
```

The app is one image family built from the repo root, because pnpm workspaces need the whole
tree to resolve `@rentthe6ix/shared`. Next is built with `output: "standalone"`, so the `web`
image ships only the server bundle; the entry point is `apps/web/server.js` and
`outputFileTracingRoot` is the repo root.

## 1. TigerData (done — P0.8)

1. Service `ha5vgeeas8` (Tiger Cloud, region `x2mp9efr75`), database `tsdb`, user `tsdbadmin`.
   TLS required.
2. Connection string → `DATABASE_URL` in `.env.local` (dev) and `.env` (instance). It is
   git-ignored; share it with the team privately, never in the repo or a public channel.
   `tiger db uri --with-password` prints it without a copy step — note it emits
   `postgresql://`, not `postgres://`.
3. Migrations applied and verified: `postgis 3.6.4`, `timescaledb 2.30.2`, `pg_trgm 1.6`;
   14 tables plus `schema_migrations`; `listing_observations` is a hypertable with 7-day
   chunks; 10 GiST/trigram indexes.
4. Re-apply after a pull: `pnpm db:migrate`. Files are applied once each, in order, one
   transaction per file; `schema_migrations` records a checksum and the runner **refuses** to
   run a file whose contents changed. Every schema change is a new `00N_*.sql`.

No local `psql`? Use the Tiger CLI: `tiger db query --command "select 1"` or
`tiger db query --file path.sql` for a multi-statement file.

## 2. Vultr instance **[needs instance]**

1. Cloud Compute, **Ubuntu 24.04 LTS, 4 vCPU / 8 GB, 80 GB SSD**, region in North America
   East (same side as TigerData). Add your SSH key. 8 GB is not padding: OTP wants 4–6 GB.
2. Firewall (Vultr console): SSH (22) from your IP only, 80 and 443 from anywhere.
3. SSH in and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER" && newgrp docker
   sudo mkdir -p /srv && sudo chown "$USER" /srv
   git clone <team-repo-url> /srv/rentthe6ix && cd /srv/rentthe6ix
   ```
4. Create `/srv/rentthe6ix/.env` from `.env.example` and fill it in. `SITE_HOST` is the one
   extra key the deploy needs:
   ```
   SITE_HOST=203-0-113-7.sslip.io     # the instance IP with dots → dashes
   DATABASE_URL=postgresql://…?sslmode=require
   AI_PROVIDER=gemini
   GEMINI_API_KEY=…
   ```
   `chmod 600 .env`. `.env` must exist before any `docker compose` command: Compose fails
   loudly without it, which is deliberate.
5. `SITE_HOST` may be a real domain (A record → instance IP) once one exists; nothing else
   changes. `sslip.io` resolves to the IP embedded in the name, so Caddy can complete an ACME
   challenge for a real certificate with no domain.

## 3. First deploy **[needs instance]**

```bash
cd /srv/rentthe6ix
docker compose up -d --build     # web + worker + caddy; otp stays out (profile)
docker compose ps
curl -I https://"$SITE_HOST"
```

Expected: `web` reports `(healthy)`, `caddy` serves the landing page over TLS, and
`http://` redirects with 308. `worker` currently exits 0 ("no jobs registered yet"), so it
shows as `exited` — that is why its restart policy is `on-failure`, not `unless-stopped`.
It comes back automatically once C's scheduler loop keeps it running.

`web` has no published host port; only Caddy is reachable from outside. Caddy's health check
hits `/status` inside the network.

## 4. OpenTripPlanner graph **[needs instance, S2]**

Built once, kept on disk, never rebuilt on deploy.

1. Inputs into `otp/data/`: TTC GTFS ("TTC Routes and Schedules") and Geofabrik
   `ontario-latest.osm.pbf`.
2. Clip OSM so the graph fits comfortably in 6 GB:
   ```bash
   sudo apt-get install -y osmium-tool
   osmium extract -b -79.77,43.49,-78.99,43.95 otp/data/ontario-latest.osm.pbf \
     -o otp/data/toronto.osm.pbf
   rm otp/data/ontario-latest.osm.pbf
   ```
3. Build with `--build --save` into `otp/graphs/` (Java heap ~6 GB), then start the service:
   ```bash
   docker compose --profile otp up -d otp
   docker compose logs -f otp        # wait for "Grizzly server running"
   ```
   Pin the image with `OTP_IMAGE` in `.env` if `2.7.0` is not the tag you built against.
4. Smoke-test one route per mode between Union Station and UofT St. George; record the times
   in `PERSON_D.md` → Handoff notes. Until `otp` is up, travel times fall back to labelled
   straight-line distance and the app must still work.

## 5. Data loads **[needs instance]**

```bash
docker compose exec worker node apps/worker/src/civic/<loader>.ts   # as loaders land
docker compose exec worker node apps/worker/src/index.ts            # or the scheduled run
```

## 6. Deploying updates

From your machine, with the instance reachable:

```bash
DEPLOY_HOST=root@203.0.113.7 SITE_HOST=203-0-113-7.sslip.io ./deploy.sh
```

It SSHes in, `git fetch` + `git reset --hard origin/main` (the box mirrors `main`; never
edit files there), rebuilds `web worker` with the cache, recreates the containers with
`--remove-orphans`, then polls `https://$SITE_HOST/` until it answers. `NO_HEALTHCHECK=1`
skips the poll; `SERVICES` and `DEPLOY_PATH` override the defaults. Never rebuilds `otp`.

`DEPLOY_HOST` must be exported in the environment or written into your shell profile; the
script fails fast with a message if it is missing.

## 7. Before the demo

- [ ] Final ingest done and marked as snapshot (C, P5.1)
- [ ] Travel precompute at ~100% OTP on `/status` (D, P5.2)
- [ ] 25 ward briefings and the demo prompts cached (B, P3.3–P3.4)
- [ ] Demo runs on the deployed URL on a phone and a laptop (P5.7)
- [ ] `GEMINI_API_KEY` and `DATABASE_URL` only in `/srv/rentthe6ix/.env`, never in git

## 8. Troubleshooting

| Symptom | Where to look |
| --- | --- |
| 502 from Caddy | `docker compose logs --tail=50 web` — usually a boot crash or a bad `DATABASE_URL` |
| `web` stuck `starting` | `docker compose logs web`; the health check fetches `/status` on `$PORT` |
| Certificate not issued | `docker compose logs caddy`; `SITE_HOST` must resolve to this box, and 80/443 must be open |
| Compose aborts immediately | `.env` missing next to `docker-compose.yml`, or `SITE_HOST` unset |
| Worker restarts in a loop | It is crashing (exit ≠ 0); `docker compose logs worker` |
| `pnpm install` fails in the build | A new workspace package needs its `package.json` added to the `deps` stage in the Dockerfile |

## Environment variables

See `.env.example` and `SPEC.md` section 20. On the instance they live in `.env` next to
`docker-compose.yml`. `NEXT_PUBLIC_*` values are inlined at build time — pass them as build
args (Compose already does for `NEXT_PUBLIC_MAPTILER_KEY`), not just as runtime env.
