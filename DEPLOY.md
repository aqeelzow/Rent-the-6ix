# DEPLOY.md

How RentThe6ix runs in production: one Vultr instance running Docker Compose (Caddy,
`web`, `worker`, `db`, and `otp` behind a profile). The database is a PostgreSQL container on
the same instance. Owner: **D**.

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

## 1. Database (self-hosted on the instance)

PostgreSQL 17 with PostGIS, TimescaleDB and pg_trgm, from the `timescale/timescaledb-ha:pg17`
image, running as the `db` service next to `web` and `worker`. It has no published port: only
containers on the Compose network reach it, at `db:5432`.

The service is defined in `docker-compose.override.yml` on the instance, which Compose loads
automatically on top of `docker-compose.yml`. That file and the secrets below live only on the
instance (never in git); `deploy.sh` runs `git reset --hard` but not `git clean`, so they
survive deploys.

| On the instance | What it is |
| --- | --- |
| `docker-compose.override.yml` | the `db` service, its `db-data` volume, and `depends_on: db` for `web` and `worker` |
| `.env.db` | `POSTGRES_PASSWORD` (`chmod 600`) |
| `dbcerts/server.crt`, `server.key` | self-signed TLS certificate, so `sslmode=require` works unchanged |
| `rentthe6ix_db-data` volume | the data directory (`/home/postgres/pgdata/data`) |

The `db` service in the override:

```yaml
services:
  db:
    image: timescale/timescaledb-ha:pg17
    restart: unless-stopped
    env_file: .env.db
    environment:
      POSTGRES_USER: rentthe6ix
      POSTGRES_DB: rentthe6ix
    command: ["postgres", "-c", "shared_buffers=512MB", "-c", "ssl=on",
              "-c", "ssl_cert_file=/certs/server.crt", "-c", "ssl_key_file=/certs/server.key"]
    volumes:
      - db-data:/home/postgres/pgdata/data
      - ./dbcerts:/certs:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rentthe6ix -d rentthe6ix"]
```

`DATABASE_URL` in `.env` is
`postgres://rentthe6ix:<password>@db:5432/rentthe6ix?sslmode=require`.

Migrations: `docker compose run --rm --no-deps worker node db/migrate.mjs`. Files are applied
once each, in order, one transaction per file; `schema_migrations` records a checksum and the
runner **refuses** to run a file whose contents changed. Every schema change is a new
`00N_*.sql`.

`psql` on the instance: `docker compose exec db psql -U rentthe6ix -d rentthe6ix`.

Rebuilding from empty (what was done on 2026-11-17): run the migrations, then
`civic/cli.ts all`, `load-benchmarks.ts`, `load-cache.ts` with every file in
`.cache/ingest/` in date order (this restores listings and price history from the saved
scrapes), and `dedupe.ts` (see section 5).

For local development, any PostgreSQL 15+ with the three extensions works (the same image via
`docker run`, for example); point `DATABASE_URL` in `.env.local` at it with `sslmode=require`.

## 2. Vultr instance **[needs instance]**

1. Cloud Compute, **Ubuntu 24.04 LTS, 4 vCPU / 8 GB, 80 GB SSD**, region in North America
   East. Add your SSH key. 8 GB is not padding: OTP wants 4–6 GB.
2. Firewall (Vultr console): SSH (22) from your IP only, 80 and 443 from anywhere.
3. SSH in and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER" && newgrp docker
   sudo mkdir -p /srv && sudo chown "$USER" /srv
   git clone <team-repo-url> /srv/rentthe6ix && cd /srv/rentthe6ix
   ```
4. Create `/srv/rentthe6ix/.env` manually (the team intentionally does not track an
   `.env.example`; see `SPEC.md` section 20) and fill it in. `SITE_HOST` is the extra deploy key:
   ```
   SITE_HOST=203-0-113-7.sslip.io     # the instance IP with dots → dashes
   DATABASE_URL=postgres://rentthe6ix:…@db:5432/rentthe6ix?sslmode=require
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

### Persistent volumes

The stack keeps state outside the images in three named volumes, all re-created by Docker
rather than by `--build`:

| Volume | Mounted at | Holds |
| --- | --- | --- |
| `rentthe6ix_worker-cache` | `/app/apps/worker/.cache` | detail-page cache, Gemini extract cache, ingest snapshots |
| `rentthe6ix_caddy_data` | `/data` | TLS certificates and ACME account |
| `rentthe6ix_caddy_config` | `/config` | Caddy autosaved config |

The worker's mount path follows the code, not the shell: every cache path is built with
`new URL('../../.cache/…', import.meta.url)` from `apps/worker/src/…`, so it lands in
`apps/worker/.cache` relative to the source tree — `/app/apps/worker/.cache` in the image,
where `/app` is the worker stage's `WORKDIR`. Mount the path somewhere else and the worker
simply writes to the image layer and loses it on the next deploy.

`docker compose down -v` deletes all three (certificates included). Use `docker compose down`
without `-v` when replacing containers, and never `down -v` on the instance.

## 4. OpenTripPlanner graph **[needs instance, S2]**

Built once, kept on disk, never rebuilt on deploy.

Do not do this by hand — `otp/build.sh` does all five steps (download via CKAN, clip, copy the
router config, build, verify) and works on the instance exactly as it does locally:

```bash
./otp/build.sh
```

Three things about the image are easy to get wrong by hand:

- It needs Docker (`stefda/osmium-tool` for the clip) and ~6 GB of free RAM for the build.
- The graph object is written to `otp/data/graph.obj`, next to its inputs — the image's
  entrypoint hard-codes `/var/opentripplanner` as the graph directory, so the compose service
  mounts only `otp/data` and there is no separate `otp/graphs/`.
- Never leave the province-wide `ontario-latest.osm.pbf` in `otp/data`: OTP merges every OSM
  file in that directory. `build.sh` keeps it in `otp/downloads/` instead.

Then start it:

```bash
docker compose --profile otp up -d otp
docker compose logs -f otp        # wait for "Grizzly server running"
```

Pin the image with `OTP_IMAGE` in `.env` if `2.7.0` is not the tag you built against — a graph
built by one OTP version is not guaranteed loadable by another.
Then smoke-test one route per mode between Union Station and UofT St. George (`./otp/smoke-test.sh`)
and record the times in `PERSON_D.md` → Handoff notes. Until `otp` is up, travel times fall back
to labelled straight-line distance and the app must still work.

## 5. Data loads **[needs instance]**

```bash
docker compose exec worker node apps/worker/src/civic/cli.ts all   # civic data (P1.10–P1.16)
docker compose exec worker node apps/worker/src/load-benchmarks.ts  # reference rents, transit, utilities
docker compose exec worker node apps/worker/src/ingest.ts           # one listing scrape now
docker compose exec worker node apps/worker/src/load-cache.ts FILE… # reload saved scrapes
docker compose exec worker node apps/worker/src/dedupe.ts           # mark cross-site duplicates
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
| `ECONNREFUSED` / upsert failed in worker logs | `docker compose ps db` — the `db` container must be `(healthy)`; `docker compose logs --tail=50 db` |
| 502 from Caddy | `docker compose logs --tail=50 web` — usually a boot crash or a bad `DATABASE_URL` |
| `web` stuck `starting` | `docker compose logs web`; the health check fetches `/status` on `$PORT` |
| Certificate not issued | `docker compose logs caddy`; `SITE_HOST` must resolve to this box, and 80/443 must be open |
| Compose aborts immediately | `.env` missing next to `docker-compose.yml`, or `SITE_HOST` unset |
| Worker restarts in a loop | It is crashing (exit ≠ 0); `docker compose logs worker` |
| Every scrape re-fetches details / re-asks Gemini | `docker compose exec worker ls /app/apps/worker/.cache` — empty means the `worker-cache` volume is missing or mounted at the wrong path (`docker compose config` shows the resolved mount) |
| `pnpm install` fails in the build | A new workspace package needs its `package.json` added to the `deps` stage in the Dockerfile |

## Environment variables

Use `SPEC.md` section 20 as the canonical list. Create `.env` beside `docker-compose.yml`
with the values needed for this deployment; never commit it. At minimum set `SITE_HOST`,
`DATABASE_URL` (with `sslmode=require`), and `AI_PROVIDER`. If using Gemini, also set
`GEMINI_API_KEY`. `OTP_URL` defaults to `http://otp:8080` in Compose. `NEXT_PUBLIC_*` values
are inlined at build time — pass them as build args (Compose already does for
`NEXT_PUBLIC_MAPTILER_KEY`), not just as runtime env.
