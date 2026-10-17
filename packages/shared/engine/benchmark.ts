import type { Benchmark, UnitType } from "./valuation";

// The benchmark line under the rent check (SPEC 7.2), owner C. Context only: the estimate never
// uses it. Rows come from D's `benchmarks` table (db/seed/benchmarks.json, StatCan 46-10-0092-01).
// Only asking rents are used: paid rent is what sitting tenants pay, so it sits below any listing.

/** A `benchmarks` row with kind 'rent'. */
export interface BenchmarkRow {
  id: string;
  key: {
    geo?: string;
    dwelling?: string;
    bedrooms?: number;
    /** The row covers this many bedrooms or more ("3+"). */
    bedroomsPlus?: boolean;
    basis?: string;
  };
  valueCad: number;
  period: string;
  sourceId: string;
}

/** StatCan publishes house rows only for 2 and 3+ bedrooms; smaller houses use apartments. */
function dwellingFor(unitType: UnitType | null): "Apartment" | "House" | "Room" {
  if (unitType === "room") return "Room";
  if (unitType === "house" || unitType === "townhouse") return "House";
  return "Apartment";
}

function sizeLabel(row: BenchmarkRow): string {
  const { dwelling, bedrooms, bedroomsPlus } = row.key;
  if (dwelling === "Room") return "rooms";
  const kind = dwelling === "House" ? "houses" : "apartments";
  if (bedrooms === 0) return `studio ${kind}`;
  return `${bedrooms}${bedroomsPlus ? "+" : ""}-bedroom ${kind}`;
}

/** The latest quarter; periods are "YYYY Qn", so they sort as text. */
const latest = (rows: BenchmarkRow[]) =>
  [...rows].sort((a, b) => b.period.localeCompare(a.period))[0];

/**
 * The StatCan asking rent for the listing's dwelling and bedroom count, latest quarter, or null
 * when the listing's size is unknown or no row matches. 3+ bedrooms use the "3+" row.
 */
export function benchmarkFor(
  listing: { unitType: UnitType | null; bedrooms: number | null },
  rows: BenchmarkRow[],
): Benchmark | null {
  const asking = rows.filter((row) => row.key.basis === "asking");
  const dwelling = dwellingFor(listing.unitType);
  const matches = (want: string, bedrooms: number | null) =>
    asking.filter(
      (row) =>
        row.key.dwelling === want &&
        (want === "Room" ||
          (bedrooms !== null &&
            row.key.bedrooms !== undefined &&
            (row.key.bedrooms === bedrooms ||
              (row.key.bedroomsPlus === true && bedrooms >= row.key.bedrooms)))),
    );
  if (dwelling !== "Room" && listing.bedrooms === null) return null;
  let found = matches(dwelling, listing.bedrooms);
  if (found.length === 0 && dwelling === "House") found = matches("Apartment", listing.bedrooms);
  const row = found.length ? latest(found) : undefined;
  if (!row) return null;
  return {
    label: `Toronto-area average asking rent, ${sizeLabel(row)}`,
    valueCad: row.valueCad,
    period: row.period,
    sourceId: row.sourceId,
  };
}
