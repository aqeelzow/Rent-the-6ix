// #16 — City of Waterloo address points (~56k), used for offline geocoding (geocode.ts), place
// resolution and building matching. Paged from the City's `Addresses` hosted feature layer.
//
// The City stores one point per unit ("155 CAROLINE ST S 1804"): 23.5k of the 56k points are
// units of ~930 buildings. Listings name the building, not the unit, and the same-building rules
// want one id per building, so units are merged into one point per civic address, placed at the
// average of its unit points (a townhouse block's units spread up to ~50 m). The unit is whatever
// follows `<number> <STREET_NM>` in CIVIC_ADDR.
//
// The key is that civic address ("WAT:155 CAROLINE ST S"): most points have no ADDRESS_ID, and
// OBJECTIDs change when the City republishes the layer. Writes are batched upserts on that key,
// and Waterloo points the City no longer publishes are deleted, so a run can simply be repeated.
// The source's WARD column is ignored (Waterloo has no ward pages); `neighbourhood_id` is filled
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
/** An address outside every neighbourhood takes the nearest one within this distance. */
const NEAREST_AREA_M = 1_000;
/** The layer held 55,838 points on 2026-11-20; far fewer means a broken or filtered response. */
const MIN_EXPECTED = 50_000;

interface AddressProps {
  CIVIC_ADDR?: string | null;
  STREET_NM?: string | null;
}

interface AddressRow {
  id: string;
  address_full: string;
  address_norm: string;
  location: string;
  source_id: string;
}

export interface AddressPointLoad {
  total: number;
  written: number;
  withNeighbourhood: number;
}

const clean = (text: string) => text.trim().toUpperCase().replace(/\s+/g, " ");

/** "213  Pastern Trail " → "WAT:213 PASTERN TRAIL". */
export function addressId(civic: string): string {
  return `WAT:${clean(civic)}`;
}

/**
 * The building's civic address and the unit, from CIVIC_ADDR and STREET_NM:
 * ("155 CAROLINE ST S 1804", "CAROLINE ST S") → { building: "155 CAROLINE ST S", unit: "1804" }.
 * When the street name isn't where it should be, the whole address is the building.
 */
export function splitUnit(
  civic: string,
  street: string | null | undefined,
): {
  building: string;
  unit: string | null;
} {
  const full = clean(civic);
  const name = street ? clean(street) : "";
  const m = name ? full.match(/^(\S+) (.*)$/) : null;
  if (!m || !(m[2] === name || m[2].startsWith(`${name} `))) return { building: full, unit: null };
  const unit = m[2].slice(name.length).trim();
  return { building: `${m[1]} ${name}`, unit: unit || null };
}

/**
 * One row per building: unit points merged, placed at their average. EWKT is accepted by the
 * geography input function, so a bulk insert can carry the point.
 */
export function toBuildingRows(features: GeoJsonFeature<AddressProps>[]): {
  rows: AddressRow[];
  skipped: number;
  units: number;
} {
  const sums = new Map<string, { lng: number; lat: number; n: number }>();
  let skipped = 0;
  let units = 0;
  for (const feature of features) {
    const civic = feature.properties.CIVIC_ADDR;
    const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    const [lng, lat] = Array.isArray(coordinates) ? (coordinates as number[]) : [];
    if (!civic?.trim() || typeof lng !== "number" || typeof lat !== "number") {
      skipped++;
      continue;
    }
    const { building, unit } = splitUnit(civic, feature.properties.STREET_NM);
    if (unit) units++;
    const sum = sums.get(building) ?? { lng: 0, lat: 0, n: 0 };
    sum.lng += lng;
    sum.lat += lat;
    sum.n++;
    sums.set(building, sum);
  }
  const rows = [...sums].map(([building, { lng, lat, n }]) => ({
    id: addressId(building),
    address_full: building,
    address_norm: normalizeAddress(building),
    location: `SRID=4326;POINT(${(lng / n).toFixed(7)} ${(lat / n).toFixed(7)})`,
    source_id: SOURCE_ID,
  }));
  return { rows, skipped, units };
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
    outFields: ["OBJECTID_1", "CIVIC_ADDR", "STREET_NM"],
    onPage: (n) => {
      if (n % 10_000 === 0) console.log(`  addresses: ${n.toLocaleString("en-CA")} fetched`);
    },
  });
  if (features.length < MIN_EXPECTED) {
    throw new Error(`${SERVICE}: only ${features.length} points (expected ${MIN_EXPECTED}+)`);
  }
  const { rows, skipped, units } = toBuildingRows(features);
  if (skipped > 0) console.warn(`  addresses: ${skipped} points skipped (no address or point)`);
  console.log(
    `  addresses: ${features.length.toLocaleString("en-CA")} points (${units.toLocaleString("en-CA")} units) → ${rows.length.toLocaleString("en-CA")} civic addresses`,
  );

  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    await sql`
      insert into address_points ${sql(batch, "id", "address_full", "address_norm", "location", "source_id")}
      on conflict (id) do update set
        address_full = excluded.address_full,
        address_norm = excluded.address_norm,
        location = excluded.location,
        neighbourhood_id = null,
        source_id = excluded.source_id
    `;
    written += batch.length;
  }
  console.log(`  addresses: ${written.toLocaleString("en-CA")} upserted`);
  // Addresses the City no longer publishes (and unit-level rows from before units were merged).
  const removed = await sql`
    delete from address_points
     where source_id = ${SOURCE_ID} and id <> all(${rows.map((r) => r.id)})`;
  if (removed.count) console.log(`  addresses: ${removed.count} old rows removed`);

  // Point-in-polygon assignment; only rows that have none yet, so re-runs stay cheap.
  console.log("  addresses: assigning neighbourhoods by point-in-polygon");
  await sql`
    update address_points a set neighbourhood_id = n.id
      from neighbourhoods n
     where a.neighbourhood_id is null
       and a.source_id = ${SOURCE_ID}
       and st_covers(n.geometry, a.location::geometry)
  `;
  // ~60 City addresses sit just past the boundary drawing (up to ~400 m); they're still Waterloo,
  // so they take the nearest neighbourhood.
  await sql`
    update address_points a set neighbourhood_id = (
      select n.id from neighbourhoods n
       where st_dwithin(n.geometry::geography, a.location, ${NEAREST_AREA_M})
       order by st_distance(n.geometry::geography, a.location) limit 1)
     where a.neighbourhood_id is null and a.source_id = ${SOURCE_ID}
  `;

  const [row] = await sql<{ total: number; with_hood: number }[]>`
    select count(*)::int as total,
           count(*) filter (where neighbourhood_id is not null)::int as with_hood
      from address_points where source_id = ${SOURCE_ID}`;
  return {
    total: row.total,
    written,
    withNeighbourhood: row.with_hood,
  };
}
