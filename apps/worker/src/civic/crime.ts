// P2.13 (data half) — Toronto Police Service neighbourhood crime rates into `area_indicators`.
//
// The published file is wide: one row per neighbourhood × one column per offence per year
// (`ASSAULT_RATE_2014` … `THEFTOVER_RATE_2025`, 158 rows × 222 columns). `area_indicators` is
// long — one transparent indicator at a time (SPEC 9.2) — so each offence becomes a three-year
// average re-based onto the indicator table, keyed by the City's neighbourhood code.
//
// Two data traps: the file starts with a UTF-8 BOM, and HOOD_158 is unpadded ("83") while the
// boundary table uses the City's zero-padded code ("083"). Matching without padding silently
// drops every neighbourhood below 100.
import type { Sql } from "postgres";
import { csvTable, toFloat, type Row } from "./lib/csv.ts";
import { fetchText } from "./lib/http.ts";
import { upsertSource } from "./sources.ts";

const DOWNLOAD =
  "https://data.tps.ca/api/download/v1/items/ea0cfecdb1de416884e6b0bf08a9e195/csv?layers=0";
const PAGE = "https://data.tps.ca/datasets/TorontoPS::neighbourhood-crime-rates-open-data";
const SOURCE_ID = "neighbourhood-crime-rates";

/** The five major crime indicators the engine's safety preference uses. */
const MAJOR = ["ASSAULT", "AUTOTHEFT", "BREAKENTER", "ROBBERY", "THEFTOVER"] as const;

interface IndicatorRow {
  area_id: string;
  area_kind: string;
  indicator_id: string;
  value: number;
  unit: string;
  period: string;
  source_id: string;
  sample_size: number | null;
  note: string | null;
}

/** Zero-pad the police neighbourhood code to the City's three-digit form. */
function areaId(hood: string): string | null {
  const digits = hood.replace(/[^\d]/g, "");
  if (digits === "") return null;
  return digits.padStart(3, "0");
}

export interface CrimeLoad {
  indicators: number;
  neighbourhoods: number;
  period: string;
}

export async function loadCrimeRates(sql: Sql): Promise<CrimeLoad> {
  const text = (await fetchText(DOWNLOAD)).replace(/^\uFEFF/, "");
  const { header, rows } = csvTable(text);

  // Which years exist per offence, taken from the header so a new publishing year needs no edit.
  const yearsByType = new Map<string, number[]>();
  for (const column of header) {
    const match = /^([A-Z]+)_RATE_(\d{4})$/.exec(column);
    if (!match) continue;
    const years = yearsByType.get(match[1]) ?? [];
    years.push(Number.parseInt(match[2], 10));
    yearsByType.set(match[1], years);
  }
  if (yearsByType.size === 0) throw new Error("no <TYPE>_RATE_<YEAR> columns in the TPS file");

  const latest = Math.max(...[...yearsByType.values()].flat());
  const windowYears = [latest - 2, latest - 1, latest];
  const period = `${windowYears[0]}–${latest}`;

  const values: IndicatorRow[] = [];
  const seen = new Set<string>();
  let missingCodes = 0;
  for (const row of rows as Generator<Row>) {
    const hood = areaId(row.HOOD_158 ?? "");
    if (!hood) continue;
    seen.add(hood);
    let counted = false;
    for (const [type, years] of yearsByType) {
      const samples: number[] = [];
      for (const year of windowYears) {
        if (!years.includes(year)) continue;
        const value = toFloat(row[`${type}_RATE_${year}`] ?? null);
        if (value !== null) samples.push(value);
      }
      if (samples.length === 0) continue;
      counted = true;
      values.push({
        area_id: hood,
        area_kind: "neighbourhood",
        indicator_id: `crime:${type.toLowerCase()}`,
        value: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)),
        unit: "per 100,000",
        period,
        source_id: SOURCE_ID,
        sample_size: null,
        note: MAJOR.includes(type as (typeof MAJOR)[number])
          ? "major crime indicator"
          : null,
      });
    }
    if (!counted) missingCodes++;
  }
  if (values.length === 0) throw new Error("no crime rates parsed");

  await upsertSource(sql, {
    id: SOURCE_ID,
    title: "Neighbourhood Crime Rates — Toronto Police Service",
    url: PAGE,
    licence: "Toronto Police Service Open Data terms",
    period,
    note: `${DOWNLOAD} — rates per 100,000; ${windowYears.join(",")} averaged`,
  });

  // Only rows whose neighbourhood exists are kept: the indicator table has no FK, and an
  // indicator nothing can join to is worse than a loud exclusion.
  const known = await sql<{ id: string }[]>`select id from neighbourhoods`;
  const knownIds = new Set(known.map((row) => row.id));
  const kept = values.filter((row) => knownIds.has(row.area_id));
  const orphaned = values.length - kept.length;

  for (let i = 0; i < kept.length; i += 500) {
    const chunk = kept.slice(i, i + 500);
    await sql`
      insert into area_indicators ${sql(
        chunk,
        "area_id",
        "area_kind",
        "indicator_id",
        "value",
        "unit",
        "period",
        "source_id",
        "sample_size",
        "note",
      )}
      on conflict (area_id, indicator_id, period) do update set
        value = excluded.value,
        unit = excluded.unit,
        source_id = excluded.source_id,
        sample_size = excluded.sample_size,
        note = excluded.note
    `;
  }

  console.log(
    `  crime: ${kept.length} indicators for ${seen.size} neighbourhoods (${period}); ${orphaned} not matching a boundary row, ${missingCodes} rows with no rates`,
  );
  return { indicators: kept.length, neighbourhoods: seen.size, period };
}
