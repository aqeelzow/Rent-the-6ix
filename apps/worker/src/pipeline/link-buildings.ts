// Geocode's building step (issue #30). Runs after the Address Point match, both directions:
// 1. Address → building: a listing at an address in `building_addresses` gets its `building_id`.
// 2. Name → address: a listing with no Address Point whose title or excerpt names one catalogue
//    building (building-names.ts) is placed at that building's first address, as exact, with the
//    words that named it kept in `field_evidence`.
import type { Sql } from "postgres";
import { addressesIn, buildingNamed, type CatalogueBuilding } from "./building-names.ts";

export interface BuildingLinks {
  byAddress: number;
  byName: number;
  /** Name matches with the words that made them, for dry runs and the ingest log. */
  named: { id: string; title: string; buildingId: string; evidence: string }[];
}

export async function linkBuildings(
  sql: Sql,
  options: { dryRun?: boolean } = {},
): Promise<BuildingLinks> {
  const catalogue = await sql<
    {
      id: string;
      aliases: string[];
      strict_aliases: string[];
      points: { lng: number; lat: number }[];
      norms: string[];
    }[]
  >`
    SELECT b.id, b.aliases, b.strict_aliases,
      json_agg(json_build_object('lng', ST_X(ap.location::geometry), 'lat', ST_Y(ap.location::geometry))
        ORDER BY ap.id) AS points,
      array_agg(ap.address_norm ORDER BY ap.id) AS norms
    FROM buildings b
    JOIN building_addresses ba ON ba.building_id = b.id
    JOIN address_points ap ON ap.id = ba.address_point_id
    WHERE b.reviewed
    GROUP BY b.id`;
  if (!catalogue.length) return { byAddress: 0, byName: 0, named: [] };
  const buildings: CatalogueBuilding[] = catalogue.map((b) => ({
    id: b.id,
    aliases: b.aliases,
    strictAliases: b.strict_aliases,
    points: b.points,
    addresses: b.norms.flatMap((n) => addressesIn(n)),
  }));

  const unplaced = await sql<
    { id: string; title: string; excerpt: string | null; lng: number; lat: number }[]
  >`
    SELECT id, title, excerpt, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
    FROM listings WHERE address_point_id IS NULL AND status <> 'removed' AND location IS NOT NULL`;
  const named: BuildingLinks["named"] = [];
  for (const l of unplaced) {
    const match = buildingNamed(`${l.title}\n${l.excerpt ?? ""}`, l, buildings);
    if (match) named.push({ id: l.id, title: l.title, ...match });
  }

  if (options.dryRun) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM listings l JOIN building_addresses ba
        ON ba.address_point_id = l.address_point_id
      WHERE l.building_id IS DISTINCT FROM ba.building_id AND l.status <> 'removed'`;
    return { byAddress: n, byName: named.length, named };
  }

  for (const m of named) {
    await sql`
      UPDATE listings l SET
        location = ap.location, location_precision = 'exact', address_point_id = ap.id,
        neighbourhood_id = coalesce(ap.neighbourhood_id, l.neighbourhood_id),
        building_id = ${m.buildingId},
        field_evidence = l.field_evidence || jsonb_build_object('buildingId', 'parsed_from_text'),
        updated_at = now()
      FROM (
        SELECT ap.* FROM building_addresses ba JOIN address_points ap ON ap.id = ba.address_point_id
        WHERE ba.building_id = ${m.buildingId} ORDER BY ap.id LIMIT 1
      ) ap
      WHERE l.id = ${m.id} AND l.address_point_id IS NULL`;
  }
  const byAddress = (
    await sql`
      UPDATE listings l SET building_id = ba.building_id, updated_at = now()
      FROM building_addresses ba
      WHERE ba.address_point_id = l.address_point_id
        AND l.building_id IS DISTINCT FROM ba.building_id AND l.status <> 'removed'`
  ).count;
  return { byAddress, byName: named.length, named };
}
