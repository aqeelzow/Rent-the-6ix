// Worker entry point. Listing sources and pipeline: C (src/sources, src/pipeline, src/schedule.ts).
// Civic data loaders and travel-time precompute: D (src/civic, src/pipeline/travel-times.ts).
import { ingestOptionsFromEnv, runIngest } from "./pipeline/run-ingest.ts";
import { every } from "./schedule.ts";

const ingestHours = Number(process.env.INGEST_INTERVAL_HOURS ?? 6);
// INGEST_ON_START=false waits one interval before the first ingest, so a deploy or restart doesn't
// scrape straight away.
const startNow = process.env.INGEST_ON_START !== "false";
const schedules = [
  every(
    ingestHours * 3_600_000,
    "ingest",
    async () => {
      const { runs } = await runIngest(ingestOptionsFromEnv());
      for (const r of runs) console.log(`ingest: ${r.source} ${r.status}, ${r.listings} listings`);
    },
    console.log,
    { startNow },
  ),
];

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    for (const s of schedules) s.stop();
    process.exit(0);
  });
