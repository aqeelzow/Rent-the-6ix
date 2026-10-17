// P2.14 (census half) — 2021 Census figures per neighbourhood from the City's Neighbourhood Profiles
// (158 model), published only as XLSX: one sheet, one row per census characteristic, one column per
// neighbourhood. Three indicators (SPEC 5, 9.1):
//
//   renter_households_pct       "Renter" ÷ "Total - Private households by tenure" (25% sample)
//   renters_shelter_cost_30pct  "% of tenant households spending 30% or more of its income on
//                                shelter costs" (as published)
//   median_household_income     "Median total income of household in 2020 ($)"
//
// Rows are found by their label, not their position, so a re-published file with an extra row
// still loads; a missing label fails loudly instead of loading the wrong row. Labels repeat across
// tables ("Renter" appears more than once), so "Renter" is the one right after its tenure total.
// Wards have no census feed (the Ward Profiles are HTML only), so these are neighbourhoods only.
import type { Sql } from "postgres";
import { CITY_LICENCE, cityResourceUrl } from "./lib/ckan.ts";
import { fetchBuffer } from "./lib/http.ts";
import { readFirstSheet } from "./lib/xlsx.ts";
import { upsertSource } from "./sources.ts";

const SLUG = "neighbourhood-profiles";
const RESOURCE = "neighbourhood-profiles-2021-158-model";
const SOURCE_ID = "neighbourhood-profiles";
export const CENSUS_PERIOD = "2021 Census";

const LABELS = {
  ids: "Neighbourhood Number",
  tenureTotal: "Total - Private households by tenure - 25% sample data",
  renter: "Renter",
  tenant30: "% of tenant households spending 30% or more of its income on shelter costs",
  income: "Median total income of household in 2020 ($)",
} as const;

export interface CensusIndicator {
  area_id: string;
  area_kind: "neighbourhood";
  indicator_id: string;
  value: number | null;
  unit: string;
  period: string;
  source_id: string;
  sample_size: number | null;
  note: string | null;
}

const number = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === "") return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};
const round1 = (value: number) => Math.round(value * 10) / 10;

/** The three census indicators for every neighbourhood column in the profile sheet. */
export function censusIndicators(rows: string[][]): CensusIndicator[] {
  const label = (row: string[]) => (row[0] ?? "").trim();
  const find = (wanted: string, from = 0, within = rows.length) => {
    for (let i = from; i < Math.min(rows.length, from + within); i++) {
      if (label(rows[i]) === wanted) return i;
    }
    throw new Error(`the profile sheet has no row "${wanted}" — has the City changed the file?`);
  };
  const ids = rows[find(LABELS.ids)];
  const tenureAt = find(LABELS.tenureTotal);
  const tenure = rows[tenureAt];
  const renter = rows[find(LABELS.renter, tenureAt + 1, 5)];
  const tenant30 = rows[find(LABELS.tenant30)];
  const income = rows[find(LABELS.income)];

  const out: CensusIndicator[] = [];
  const base = { area_kind: "neighbourhood" as const, period: CENSUS_PERIOD, source_id: SOURCE_ID };
  for (let column = 1; column < ids.length; column++) {
    const code = number(ids[column]);
    if (code === null || !Number.isInteger(code)) continue;
    const area_id = String(code).padStart(3, "0");
    const households = number(tenure[column]);
    const renters = number(renter[column]);
    const burden = number(tenant30[column]);
    const median = number(income[column]);
    out.push(
      {
        ...base,
        area_id,
        indicator_id: "renter_households_pct",
        value: households && renters !== null ? round1((100 * renters) / households) : null,
        unit: "% of households",
        sample_size: households,
        note: "25% sample data",
      },
      {
        ...base,
        area_id,
        indicator_id: "renters_shelter_cost_30pct",
        value: burden === null ? null : round1(burden),
        unit: "% of tenant households",
        sample_size: null,
        note: "spending 30% or more of income on shelter costs; 25% sample data",
      },
      {
        ...base,
        area_id,
        indicator_id: "median_household_income",
        value: median,
        unit: "CAD",
        sample_size: null,
        note: "2020 income, reported in the 2021 Census",
      },
    );
  }
  if (out.length === 0) throw new Error("no neighbourhood columns in the profile sheet");
  return out;
}

export interface CensusLoad {
  indicators: number;
  neighbourhoods: number;
}

export async function loadCensus(sql: Sql): Promise<CensusLoad> {
  const url = await cityResourceUrl(SLUG, RESOURCE);
  const rows = readFirstSheet(await fetchBuffer(url));
  const values = censusIndicators(rows);

  await upsertSource(sql, {
    id: SOURCE_ID,
    title: "Neighbourhood Profiles (2021 Census, 158 neighbourhoods)",
    url: `https://open.toronto.ca/dataset/${SLUG}/`,
    licence: CITY_LICENCE,
    period: CENSUS_PERIOD,
    note: `${url} — Statistics Canada 2021 Census, tabulated by the City; 25% sample data`,
  });

  const known = new Set(
    (await sql<{ id: string }[]>`select id from neighbourhoods`).map((r) => r.id),
  );
  const kept = values.filter((row) => known.has(row.area_id));
  if (kept.length < values.length) {
    throw new Error(`${values.length - kept.length} census rows match no neighbourhood boundary`);
  }
  for (let i = 0; i < kept.length; i += 500) {
    await sql`
      insert into area_indicators ${sql(
        kept.slice(i, i + 500),
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
        note = excluded.note`;
  }
  return { indicators: kept.length, neighbourhoods: new Set(kept.map((r) => r.area_id)).size };
}
