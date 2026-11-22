import type { Listing } from "@rentkdubs/shared/schemas";
import { getClient } from "../db";
import { candidateColumns, listingFromRow } from "./candidates-sql";

// One catalogue building for /building/[slug] (issue #30): its addresses, the listings in it now,
// and past asking rents from listing_observations. Every figure carries its sample size.

/** Asking rents seen in the last this-many days count towards a building's past rents. */
export const RENT_HISTORY_DAYS = 365;

export type BuildingKind = "student" | "rental_apartment" | "condo" | "other";

/** "room", or the number of bedrooms (4 means 4 or more). */
export type UnitGroup = "room" | 0 | 1 | 2 | 3 | 4;

export interface RentSummary {
  group: UnitGroup;
  /** Different listings behind the figures. */
  listings: number;
  median: number;
  low: number;
  high: number;
  /** First and last day an asking rent in this group was seen (YYYY-MM-DD). */
  from: string;
  to: string;
}

export interface BuildingPage {
  id: string;
  name: string;
  kind: BuildingKind | null;
  addresses: string[];
  location: { lng: number; lat: number } | null;
  listings: Listing[];
  rents: RentSummary[];
}

const SUFFIX = new Set(["N", "S", "E", "W"]);
/** City address points are upper case ("330 PHILLIP ST N"); show them as people write them. */
export function addressLabel(address: string): string {
  return address
    .split(/\s+/)
    .map((word) =>
      SUFFIX.has(word) || /\d/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

const GROUPS: UnitGroup[] = ["room", 0, 1, 2, 3, 4];

type RentRow = {
  grp: string;
  listings: number;
  median: number;
  low: number;
  high: number;
  first_seen: string;
  last_seen: string;
};

export async function loadBuilding(
  sql: NonNullable<ReturnType<typeof getClient>>,
  slug: string,
): Promise<BuildingPage | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const [building] = await sql<
    {
      id: string;
      name: string;
      kind: BuildingKind | null;
      lng: number | null;
      lat: number | null;
    }[]
  >`
    SELECT id, name, kind, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
    FROM buildings WHERE id = ${slug} AND reviewed`;
  if (!building) return null;

  const [addresses, listingRows, rentRows] = await Promise.all([
    sql<{ address: string }[]>`
      SELECT ap.address_full AS address FROM building_addresses ba
      JOIN address_points ap ON ap.id = ba.address_point_id
      WHERE ba.building_id = ${slug} ORDER BY ap.address_norm`,
    sql.unsafe(
      `SELECT ${candidateColumns} FROM listings
       WHERE building_id = $1 AND status = 'active' AND duplicate_of IS NULL
       ORDER BY monthly_rent_cad, id`,
      [slug],
    ),
    sql<RentRow[]>`
      SELECT CASE WHEN l.rent_is_per_room OR l.unit_type = 'room' THEN 'room'
                  ELSE least(l.bedrooms, 4)::text END AS grp,
             count(DISTINCT l.id)::int AS listings,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o.asking_rent_cad))::int AS median,
             min(o.asking_rent_cad)::int AS low,
             max(o.asking_rent_cad)::int AS high,
             min(o.observed_at)::date::text AS first_seen,
             max(o.observed_at)::date::text AS last_seen
      FROM listing_observations o JOIN listings l ON l.id = o.listing_id
      WHERE l.building_id = ${slug} AND l.duplicate_of IS NULL
        AND o.observed_at >= now() - make_interval(days => ${RENT_HISTORY_DAYS})
        AND (l.rent_is_per_room OR l.unit_type = 'room' OR l.bedrooms IS NOT NULL)
      GROUP BY 1`,
  ]);

  const rents = rentRows
    .map((r) => ({
      group: (r.grp === "room" ? "room" : Number(r.grp)) as UnitGroup,
      listings: r.listings,
      median: r.median,
      low: r.low,
      high: r.high,
      from: r.first_seen,
      to: r.last_seen,
    }))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));

  return {
    id: building.id,
    name: building.name,
    kind: building.kind,
    addresses: addresses.map((a) => addressLabel(a.address)),
    location:
      building.lng === null || building.lat === null
        ? null
        : { lng: building.lng, lat: building.lat },
    listings: (listingRows as unknown[]).map(listingFromRow),
    rents,
  };
}
