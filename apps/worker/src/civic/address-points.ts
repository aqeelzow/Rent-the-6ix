// P1.11 — the City's One Address Repository: ~525k address points used for offline geocoding
// (C), place resolution (B) and building matching (P1.14). The GeoJSON resource is 590 MB, so
// this loader pages through the CKAN datastore instead of downloading and parsing it in memory.
//
// Writes are per-page bulk upserts keyed on ADDRESS_POINT_ID, so an interrupted run can simply
// be repeated. `ward_id` comes from the City's own WARD column (validated against `wards`), and
// `neighbourhood_id` is filled point-in-polygon afterwards — the source has no neighbourhood.
import type { Sql } from "postgres";
import { cityDataset, cityDatastoreId, CITY_LICENCE } from "./lib/ckan.ts";
import { fetchJson } from "./lib/http.ts";
import { normalizeAddress } from "./lib/address.ts";
import { upsertSource } from "./sources.ts";

const SLUG = "address-points-municipal-toronto-one-address-repository";
const RESOURCE = "Address Points";
const SOURCE_ID = "address-points";
const PAGE_SIZE = 5000;
const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search";

interface DatastoreRecord {
  ADDRESS_POINT_ID?: number;
  ADDRESS_FULL?: string;
  WARD?: string | null;
  geometry?: string;
}

interface DatastorePage {
  success: boolean;
  result?: { total: number; records?: DatastoreRecord[] };
}

interface AddressRow {
  id: string;
  address_full: string;
  address_norm: string;
  location: string;
  ward_id: string | null;
  source_id: string;
}

export interface AddressPointLoad {
  total: number;
  written: number;
  withNeighbourhood: number;
  withWard: number;
}

/** EWKT is accepted by the geography input function, so a bulk COPY can carry the point. */
function toRow(record: DatastoreRecord): AddressRow | null {
  const id = record.ADDRESS_POINT_ID;
  const full = record.ADDRESS_FULL?.trim();
  if (id === undefined || !full || !record.geometry) return null;
  let coordinates: unknown;
  try {
    coordinates = (JSON.parse(record.geometry) as { coordinates?: unknown }).coordinates;
  } catch {
    return null;
  }
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates as number[];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return {
    id: String(id),
    address_full: full,
    address_norm: normalizeAddress(full),
    location: `SRID=4326;POINT(${lng} ${lat})`,
    ward_id: record.WARD?.trim() || null,
    source_id: SOURCE_ID,
  };
}

export async function loadAddressPoints(sql: Sql): Promise<AddressPointLoad> {
  const meta = await cityDataset(SLUG);
  const resourceId = await cityDatastoreId(SLUG, RESOURCE);
  const dumpUrl = `https://ckan0.cf.opendata.inter.prod-toronto.ca/datastore/dump/${resourceId}`;
  await upsertSource(sql, {
    id: SOURCE_ID,
    title: meta.title,
    url: meta.pageUrl,
    licence: CITY_LICENCE,
    note: dumpUrl,
  });

  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let written = 0;
  let skipped = 0;
  while (offset < total) {
    const url = `${CKAN}?resource_id=${resourceId}&limit=${PAGE_SIZE}&offset=${offset}&sort=_id`;
    const page = await fetchJson<DatastorePage>(url);
    if (!page.success || !page.result)
      throw new Error(`datastore_search failed at offset ${offset}`);
    total = page.result.total;
    const records = page.result.records ?? [];
    if (records.length === 0) break;

    const rows = records.map(toRow).filter((row): row is AddressRow => row !== null);
    skipped += records.length - rows.length;
    if (rows.length > 0) {
      await sql`
        insert into address_points ${sql(rows, "id", "address_full", "address_norm", "location", "ward_id", "source_id")}
        on conflict (id) do update set
          address_full = excluded.address_full,
          address_norm = excluded.address_norm,
          location = excluded.location,
          ward_id = excluded.ward_id,
          source_id = excluded.source_id
      `;
      written += rows.length;
    }
    offset += records.length;
    if (offset % (PAGE_SIZE * 10) === 0 || offset >= total) {
      console.log(
        `  addresses: ${offset.toLocaleString("en-CA")} / ${total.toLocaleString("en-CA")}`,
      );
    }
  }
  if (skipped > 0)
    console.warn(`  addresses: ${skipped} records skipped (no id, address or point)`);

  // The City's WARD codes are validated against the boundary table rather than trusted blindly.
  await sql`
    update address_points set ward_id = null
     where ward_id is not null
       and ward_id not in (select id from wards)
  `;
  // Point-in-polygon assignment; only rows that have none yet, so re-runs stay cheap.
  console.log("  addresses: assigning neighbourhoods by point-in-polygon");
  await sql`
    update address_points a set neighbourhood_id = n.id
      from neighbourhoods n
     where a.neighbourhood_id is null
       and st_contains(n.geometry, a.location::geometry)
  `;

  const [row] = await sql<
    { total: number; with_hood: number; with_ward: number }[]
  >`select count(*)::int as total,
           count(*) filter (where neighbourhood_id is not null)::int as with_hood,
           count(*) filter (where ward_id is not null)::int as with_ward
      from address_points`;
  return {
    total: row.total,
    written,
    withNeighbourhood: row.with_hood,
    withWard: row.with_ward,
  };
}
