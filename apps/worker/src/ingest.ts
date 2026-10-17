// One listing collection run: `pnpm ingest:once [--sources kijiji,torontorentals] [--pages 5] [--details 50]`.
// Defaults come from INGEST_SOURCES, INGEST_MAX_PAGES and INGEST_MAX_DETAILS (src/pipeline/run-ingest.ts).
import { parseArgs } from "node:util";
import { ingestOptionsFromEnv, runIngest } from "./pipeline/run-ingest.ts";

const { values } = parseArgs({
  options: { sources: { type: "string" }, pages: { type: "string" }, details: { type: "string" } },
});

const { runs } = await runIngest(ingestOptionsFromEnv(values));
console.table(runs);
if (runs.every((r) => r.status !== "ok")) process.exitCode = 1;
