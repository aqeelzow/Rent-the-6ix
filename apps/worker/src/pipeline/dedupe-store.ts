// Dedupe in TigerData: run findDuplicates over every listing not removed and store duplicate_of.
// Recomputed in full each time (≈ 13 s for 9,000 listings), so a pair that stops matching is cleared.
import type { Sql } from "postgres";
import type { SourceId } from "../sources/types.ts";
import { findDuplicates, type DedupeListing } from "./dedupe.ts";

export interface DedupeResult {
  listings: number;
  duplicates: number;
  /** Rows whose duplicate_of changed. */
  changed: number;
}

export async function dedupeStored(sql: Sql): Promise<DedupeResult> {
  const rows = await sql<
    {
      id: string;
      source: SourceId;
      lng: number;
      lat: number;
      bedrooms: number | null;
      monthly_rent_cad: number;
      title: string;
      excerpt: string;
      address_text: string | null;
      first_seen_at: Date;
    }[]
  >`
    SELECT id, source, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat, bedrooms,
      monthly_rent_cad, title, coalesce(excerpt, '') AS excerpt, address_text, first_seen_at
    FROM listings WHERE status <> 'removed'`;
  const listings: DedupeListing[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    location: { lng: r.lng, lat: r.lat },
    bedrooms: r.bedrooms,
    monthlyRentCad: r.monthly_rent_cad,
    title: r.title,
    excerpt: r.excerpt,
    addressText: r.address_text,
    firstSeenAt: r.first_seen_at.toISOString(),
  }));
  const duplicateOf = findDuplicates(listings);
  const ids = [...duplicateOf.keys()];
  const canonical = ids.map((id) => duplicateOf.get(id)!);
  const changed = await sql.begin(async (tx) => {
    const set = await tx`
      UPDATE listings l SET duplicate_of = v.canonical, updated_at = now()
      FROM (SELECT unnest(${ids}::uuid[]) AS id, unnest(${canonical}::uuid[]) AS canonical) v
      WHERE l.id = v.id AND l.duplicate_of IS DISTINCT FROM v.canonical`;
    const cleared = await tx`
      UPDATE listings SET duplicate_of = NULL, updated_at = now()
      WHERE duplicate_of IS NOT NULL AND NOT (id = ANY(${ids}::uuid[]))`;
    return set.count + cleared.count;
  });
  return { listings: listings.length, duplicates: ids.length, changed };
}
