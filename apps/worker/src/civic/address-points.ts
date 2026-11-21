// #16 — City of Waterloo address points (~56k), used for offline geocoding (geocode.ts), place
// resolution and building matching. Paged from the City's `Addresses` hosted feature layer.
//
// The key is the civic address itself ("WAT:213 PASTERN TRAIL"): about 40k of the 56k points
// have no ADDRESS_ID, and OBJECTIDs change when the City republishes the layer. The address is
// unique except for ~90 repeats (one address, several points); the first point by OBJECTID is
// kept. Writes are batched upserts on that key, so an interrupted run can simply be repeated. The source's WARD column is ignored (no wards, #1); `neighbourhood_id` is filled
// point-in-polygon afterwards from the neighbourhoods `areas` loaded.
//
// Spelling: the City writes "213 PASTERN TRAIL", "12 KING ST N", "15 ABC CRT", "8 XYZ CIR".
// `normalizeAddress` and geocode.ts's listing-side normaliser must agree on every street type
// that appears here (TRAIL → TRL, LANE → LN, CIR stays CIR, CRT stays CRT).
import type { Sql } from "postgres";
import {
  itemPageUrl,
  layerUrl,
  queryAll,
  WATERLOO_LICENCE,
  type GeoJsonFeature,
} from "./lib/arcgis.ts";
import { normalizeAddress } from "./lib/address.ts";
import { upsertSource } from "./sources.ts";

const SERVICE = "Addresses";
const ITEM_ID = "fb1ce9625c634b2dbe1d2be36d419711";
const SOURCE_ID = "waterloo-address-points";
const WRITE_BATCH = 2000;
/** The layer held 55,838 points on 2026-11-20; far fewer means a broken or filtered response. */
const MIN_EXPECTED = 50_000;

interface AddressProps {
  CIVIC_ADDR?: string | null;
}

interface AddressRow {
  id: string;
  address_full: string;
  address_norm: string;
  location: string;
  ward_id: null;
  source_id: string;
}

export interface AddressPointLoad {
  total: number;
  written: number;
  withNeighbourhood: number;
  withWard: number;
}

/** "213  Pastern Trail " → "WAT:213 PASTERN TRAIL". */
export function addressId(civic: string): string {
  return `WAT:${civic.trim().toUpperCase().replace(/\s+/g, " ")}`;
}

/** EWKT is accepted by the geography input function, so a bulk insert can carry the point. */
export function toRow(feature: GeoJsonFeature<AddressProps>): AddressRow | null {
  const full = feature.properties.CIVIC_ADDR?.trim();
  const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  if (!full || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates as number[];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return {
    id: addressId(full),
    address_full: full,
    address_norm: normalizeAddress(full),
    location: `SRID=4326;POINT(${lng} ${lat})`,
    ward_id: null,
    source_id: SOURCE_ID,
  };
}

export async function loadAddressPoints(sql: Sql): Promise<AddressPointLoad> {
  const url = layerUrl(SERVICE);
  await upsertSource(sql, {
    id: SOURCE_ID,
    title: "City of Waterloo Address Points",
    url: itemPageUrl(ITEM_ID),
    licence: WATERLOO_LICENCE,
    note: url,
  });

  const features = await queryAll<AddressProps>(url, {
    orderBy: "OBJECTID_1",
    outFields: ["OBJECTID_1", "CIVIC_ADDR"],
    onPage: (n) => {
      if (n % 10_000 === 0) console.log(`  addresses: ${n.toLocaleString("en-CA")} fetched`);
    },
  });
  if (features.length < MIN_EXPECTED) {
    throw new Error(`${SERVICE}: only ${features.length} points (expected ${MIN_EXPECTED}+)`);
  }
  const parsed = features.map(toRow).filter((row): row is AddressRow => row !== null);
  const skipped = features.length - parsed.length;
  if (skipped > 0) console.warn(`  addresses: ${skipped} points skipped (no address or point)`);
  // Features arrive ordered by OBJECTID, so the first copy of a repeated address is kept.
  const byId = new Map<string, AddressRow>();
  for (const row of parsed) if (!byId.has(row.id)) byId.set(row.id, row);
  const rows = [...byId.values()];
  if (parsed.length > rows.length) {
    console.log(`  addresses: ${parsed.length - rows.length} repeated addresses kept once`);
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    await sql`
      insert into address_points ${sql(batch, "id", "address_full", "address_norm", "location", "ward_id", "source_id")}
      on conflict (id) do update set
        address_full = excluded.address_full,
        address_norm = excluded.address_norm,
        location = excluded.location,
        ward_id = null,
        neighbourhood_id = null,
        source_id = excluded.source_id
    `;
    written += batch.length;
  }
  console.log(`  addresses: ${written.toLocaleString("en-CA")} upserted`);

  // Point-in-polygon assignment; only rows that have none yet, so re-runs stay cheap.
  console.log("  addresses: assigning neighbourhoods by point-in-polygon");
  await sql`
    update address_points a set neighbourhood_id = n.id
      from neighbourhoods n
     where a.neighbourhood_id is null
       and a.source_id = ${SOURCE_ID}
       and st_covers(n.geometry, a.location::geometry)
  `;

  const [row] = await sql<{ total: number; with_hood: number; with_ward: number }[]>`
    select count(*)::int as total,
           count(*) filter (where neighbourhood_id is not null)::int as with_hood,
           count(*) filter (where ward_id is not null)::int as with_ward
      from address_points where source_id = ${SOURCE_ID}`;
  return {
    total: row.total,
    written,
    withNeighbourhood: row.with_hood,
    withWard: row.with_ward,
  };
}
