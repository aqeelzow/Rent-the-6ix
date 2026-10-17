import { SAFETY } from "@rentthe6ix/shared/engine/config";
import {
  cityRates,
  safetyFor,
  safetyScore,
  yearsFromPeriod,
  type CityRates,
  type CrimeRates,
  type MajorCrimeType,
} from "@rentthe6ix/shared/engine/safety";
import type { Safety } from "@rentthe6ix/shared/schemas";
import { getClient } from "../db";

// Safety lookup (SPEC 7.6). Owner: D. Reads the TPS rates that `pnpm data:civic crime` loads into
// `area_indicators` (`crime:<type>`, one row per neighbourhood × offence, three-year average per
// 100,000) and hands them to the pure engine in packages/shared/engine/safety.ts.

/** Every neighbourhood's major-indicator rates and the city comparison point. */
export type CrimeTable = { byArea: Map<string, CrimeRates>; city: CityRates | null };

type IndicatorRow = { area_id: string; indicator_id: string; value: number | null; period: string };
type PopulationRow = { area_id: string; value: number | null };

const MAJOR_IDS = SAFETY.majorTypes.map((type) => `crime:${type}`);
/** Neighbourhood residents, if D loads them; lets the city rate be population-weighted. */
const POPULATION_ID = "population";

/** Builds the table from indicator rows (latest period per neighbourhood and offence). */
export function crimeTableFromRows(
  rows: IndicatorRow[],
  populations: PopulationRow[] = [],
): CrimeTable {
  const population = new Map(populations.map((row) => [row.area_id, row.value]));
  const byArea = new Map<string, CrimeRates>();
  for (const row of rows) {
    const type = row.indicator_id.replace(/^crime:/, "") as MajorCrimeType;
    if (!(SAFETY.majorTypes as readonly string[]).includes(type)) continue;
    const entry =
      byArea.get(row.area_id) ??
      ({
        areaId: row.area_id,
        years: [],
        byType: {},
        population: population.get(row.area_id) ?? null,
      } satisfies CrimeRates);
    entry.byType[type] = row.value;
    entry.years = [...new Set([...entry.years, ...yearsFromPeriod(row.period)])].sort(
      (a, b) => a - b,
    );
    byArea.set(row.area_id, entry);
  }
  return { byArea, city: cityRates([...byArea.values()]) };
}

/** Reads the table from TigerData. */
export async function loadCrimeTable(
  sql: NonNullable<ReturnType<typeof getClient>>,
): Promise<CrimeTable> {
  const [rows, populations] = await Promise.all([
    sql<IndicatorRow[]>`
      SELECT DISTINCT ON (area_id, indicator_id) area_id, indicator_id, value, period
      FROM area_indicators
      WHERE area_kind = 'neighbourhood' AND indicator_id IN ${sql(MAJOR_IDS)}
      ORDER BY area_id, indicator_id, period DESC`,
    sql<PopulationRow[]>`
      SELECT DISTINCT ON (area_id) area_id, value
      FROM area_indicators
      WHERE area_kind = 'neighbourhood' AND indicator_id = ${POPULATION_ID}
      ORDER BY area_id, period DESC`,
  ]);
  return crimeTableFromRows(rows, populations);
}

/**
 * The crime table, loaded once and kept for `ttlMs`; it only changes when D reloads crime data.
 * Resolves null without a database; a failed read is retried on the next call.
 */
export function crimeTableSource(
  client: typeof getClient = getClient,
  ttlMs = 6 * 60 * 60 * 1000,
): () => Promise<CrimeTable | null> {
  let cached: { at: number; table: Promise<CrimeTable> } | null = null;
  return async () => {
    const sql = client();
    if (!sql) return null;
    if (!cached || Date.now() - cached.at > ttlMs) {
      const table = loadCrimeTable(sql);
      cached = { at: Date.now(), table };
      table.catch(() => {
        if (cached?.table === table) cached = null;
      });
    }
    return cached.table;
  };
}

/** One listing's safety figure and its 0–100 score; both null without data (unknown, not "no"). */
export function safetyForListing(
  table: CrimeTable | null,
  neighbourhoodId: string | null,
): { safety: Safety | null; safetyScore: number | null } {
  if (!table || !neighbourhoodId) return { safety: null, safetyScore: null };
  const safety = safetyFor(table.byArea.get(neighbourhoodId) ?? null, table.city);
  return {
    safety,
    safetyScore: safety?.relativeRate != null ? safetyScore(safety.relativeRate) : null,
  };
}
