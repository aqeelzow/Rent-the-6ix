# DEPLOY.md

How RentThe6ix runs in production: one Vultr instance with Docker Compose (web, worker, OpenTripPlanner, Caddy) talking to a TigerData service. Owner: **D**. This is a starter; correct each step as you actually do it (P0.9) and record the real values in `PROGRESS.md` → Environment.

> Check current docs as you go: Tiger Cloud, Vultr, Docker, Caddy, OpenTripPlanner 2. Commands below are the expected shape, not guaranteed verbatim.

## 1. TigerData (Tiger Cloud)

1. Create a service in the Tiger Cloud console (free plan is fine for the hackathon), in the region closest to the Vultr instance (both in North America East).
2. Copy the connection string → `DATABASE_URL` (with `sslmode=require`). Share it privately with the team.
3. Apply migrations from your machine:
   ```bash
   pnpm db:migrate        # runs db/migrations/*.sql in order
   ```
   Migration 001 enables `postgis`, `timescaledb` and `pg_trgm`. If an extension isn't available on the plan, stop and tell the team.

## 2. Vultr instance

1. Create a Cloud Compute instance: Ubuntu LTS, **4 vCPU / 8 GB** (OTP needs ~4–6 GB for Toronto with all four modes), region near the TigerData service. Add your SSH key.
2. SSH in, then:
   ```bash
   curl -fsSL https://get.docker.com | sh          # Docker Engine + Compose plugin
   sudo usermod -aG docker $USER && newgrp docker
   git clone https://github.com/<org>/rentthe6ix.git && cd rentthe6ix
   cp .env.example .env && nano .env              # fill in every value (SPEC 20)
   ```
3. Open ports 80 and 443 in the Vultr firewall (and nothing else except SSH).

## 3. HTTPS

- With a domain: point an A record at the instance IP and put the domain in `Caddyfile`.
- Without one: use `<ip-with-dashes>.sslip.io` (e.g. `203-0-113-7.sslip.io`) in `Caddyfile`; Caddy gets a certificate automatically.

## 4. OpenTripPlanner graph

Build once on the instance and keep it on disk (`otp/graphs/`, git-ignored). Rebuild only when GTFS or OSM changes.

1. Download inputs into `otp/data/`:
   - TTC GTFS from the City's open data portal ("TTC Routes and Schedules").
   - Ontario OSM extract from Geofabrik (`ontario-latest.osm.pbf`).
2. Clip OSM to Toronto + ~10 km so the graph fits in memory:
   ```bash
   sudo apt-get install -y osmium-tool
   osmium extract -b -79.77,43.49,-78.99,43.95 otp/data/ontario-latest.osm.pbf -o otp/data/toronto.osm.pbf
   rm otp/data/ontario-latest.osm.pbf
   ```
3. Build and save the graph (`pnpm otp:build` wraps this): run the official OpenTripPlanner 2 image or jar with `--build --save` on `otp/data`, giving Java ~6 GB of heap. Then the `otp` service in Compose runs with `--load --serve`.
4. Smoke-test one route per mode (transit, walk, bike, car) between Union Station and UofT St. George; record the times in `PROGRESS.md` Handoff notes.

## 5. Start everything

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f web
```

Then from the instance (or your machine with `DATABASE_URL` set):

```bash
pnpm data:civic          # civic data, POIs, RentSafeTO, crime rates, benchmarks
pnpm ingest:once         # first listing run (C)
pnpm travel:precompute   # travel times (long; runs in the worker in the background)
```

Check `https://<host>/status`: database counts, last ingest per source, travel times by OTP, AI status.

## 6. Deploying updates

`main` must always be deployable. To deploy:

```bash
./deploy.sh              # ssh to the instance, git pull, docker compose up -d --build web worker
```

(or the GitHub Action, if D sets one up). Never rebuild `otp` on deploy.

## 7. Before the demo

- [ ] Final ingest done and marked as snapshot (C, P5.1)
- [ ] Travel precompute at ~100% OTP on `/status` (D, P5.2)
- [ ] 25 ward briefings and the demo prompts cached (B, P3.3–P3.4)
- [ ] Demo runs on the deployed URL on a phone and a laptop (P5.7)
- [ ] Gemini key and `DATABASE_URL` only in `.env` on the instance, not in the repo

## Environment variables

See `.env.example` and `SPEC.md` section 20. On the instance they live in `.env` next to `docker-compose.yml`.
