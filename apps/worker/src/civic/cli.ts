// Civic data loaders (P1.10–P1.16): `pnpm data:civic [task]` from the repo root.
//
// Each task is idempotent, writes its `sources` provenance row before its data, and prints a
// summary a human can check. `all` runs them in dependency order. Stop and read the failure
// instead of retrying: these are open City APIs, so a 404 usually means a renamed resource
// (the error lists the available names) and a count mismatch means the City changed its model.
import type { Sql } from "postgres";
import { openDb } from "../lib/db.ts";
import { loadAddressPoints } from "./address-points.ts";
import { loadBoundaries } from "./areas.ts";
import { loadBuildings } from "./buildings.ts";
import { loadCrimeRates } from "./crime.ts";
import { loadPois } from "./pois.ts";
import { loadTransitStops } from "./transit-stops.ts";

type Task = (sql: Sql) => Promise<void>;

async function areas(sql: Sql): Promise<void> {
  const loads = await loadBoundaries(sql);
  for (const load of loads) {
    console.log(
      `  ${load.table}: ${load.features} rows (${load.badSrid} not SRID 4326, ${load.invalid} invalid)`,
    );
  }
}

async function addresses(sql: Sql): Promise<void> {
  const load = await loadAddressPoints(sql);
  const pct = (n: number) => `${((100 * n) / Math.max(load.total, 1)).toFixed(1)}%`;
  console.log(
    `  address_points: ${load.total} rows, ${load.withNeighbourhood} with a neighbourhood (${pct(load.withNeighbourhood)}), ${load.withWard} with a ward`,
  );
  if (load.withNeighbourhood < load.total * 0.95) {
    throw new Error("fewer than 95% of address points landed in a neighbourhood — check the boundaries");
  }
}

async function pois(sql: Sql): Promise<void> {
  const load = await loadPois(sql);
  console.log(`  pois: ${load.written} rows`, load.byCategory);
  // Every category is required: an empty one means a source silently stopped contributing
  // (the City's facility layers are MultiPoint, which is easy to mis-parse into zero rows).
  const missing = ["library", "park", "community_centre", "school", "grocery", "pharmacy", "clinic"]
    .filter((category) => !load.byCategory[category]);
  if (missing.length > 0) throw new Error(`no POIs for: ${missing.join(", ")}`);
}

async function stops(sql: Sql): Promise<void> {
  const load = await loadTransitStops(sql);
  console.log(`  transit_stops: ${load.stops} stops, ${load.rapid} rapid`);
}

async function buildings(sql: Sql): Promise<void> {
  const load = await loadBuildings(sql);
  console.log(
    `  buildings: ${load.buildings} rows (${load.withLocation} with coordinates, ${load.withAddressPoint} matched to an address point, ${load.withScore} with a score)`,
  );
  if (load.withScore === 0) throw new Error("no RentSafeTO scores loaded — check the column names");
}

async function crime(sql: Sql): Promise<void> {
  const load = await loadCrimeRates(sql);
  console.log(`  area_indicators: ${load.indicators} crime rows for ${load.period}`);
}

const TASKS: Record<string, Task> = { areas, addresses, pois, stops, buildings, crime };

async function main(): Promise<void> {
  const requested = process.argv[2] ?? "all";
  const names = requested === "all" ? Object.keys(TASKS) : [requested];
  const unknown = names.filter((name) => !(name in TASKS));
  if (unknown.length > 0) {
    console.error(`unknown task "${unknown[0]}"; available: ${Object.keys(TASKS).join(", ")}, all`);
    process.exit(1);
  }

  const sql = openDb();
  if (!sql) {
    console.error("DATABASE_URL is not set (repo-root .env.local)");
    process.exit(1);
  }
  try {
    for (const name of names) {
      console.log(`${name}:`);
      await TASKS[name](sql);
    }
    console.log("done");
  } finally {
    await sql.end();
  }
}

await main();
