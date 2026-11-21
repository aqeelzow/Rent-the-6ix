// #15 — City of Waterloo neighbourhoods and city boundary (RENT_K_DUBS_SPEC.md, Geography model).
//
// Neighbourhoods are the City's 26 District Plans (#5: they hold 99.8% of the City's address
// points; neighbourhood associations leave gaps). They don't quite cover the City: the rural
// west edge sits outside every plan. That remainder (city boundary minus every plan) is stored
// as one more area, "Rest of Waterloo", so the neighbourhoods together are exactly the City and
// geocode can treat "outside every neighbourhood" as "outside Waterloo".
//
// Ids are `WPD-<label slug>` (not every plan has a PLANNINGDI code). Wards are not loaded (#1).
import type { Sql, TransactionSql } from "postgres";
import { WATERLOO_ID_PREFIX } from "../pipeline/geocode.ts";
import { itemPageUrl, layerUrl, queryAll, WATERLOO_LICENCE } from "./lib/arcgis.ts";
import { upsertSource } from "./sources.ts";

interface DistrictProps {
  OBJECTID: number;
  PLANNINGDI?: string | null;
  LABEL?: string | null;
  DISTNAME?: string | null;
}

export interface AreaLoad {
  table: "neighbourhoods";
  features: number;
  badSrid: number;
  invalid: number;
  /** Share of the City's area covered by more than one neighbourhood (should be ~0). */
  overlapShare: number;
  /** Share of the City's area outside every neighbourhood (should be ~0). */
  uncoveredShare: number;
}

const DISTRICTS = {
  sourceId: "waterloo-district-plans",
  service: "DistrictPlans",
  itemId: "2fb4cc862830455eb02a8fdd2f03d2b8",
  title: "City of Waterloo District Plans",
  expected: 26,
};
const BOUNDARY = {
  sourceId: "waterloo-city-boundary",
  service: "CityBoundary",
  itemId: "eda133697fd446db92dec930f162a700",
  title: "City of Waterloo Municipal Boundary",
};
export const REST_ID = `${WATERLOO_ID_PREFIX}rest`;
const REST_NAME = "Rest of Waterloo";
/** A remainder smaller than this (m²) is slivers along shared edges, not a real area. */
const MIN_REST_M2 = 10_000;

/** "Beechwood West" → "WPD-beechwood-west"; "UW Research and Technology Park" → "WPD-uw-research-and-technology-park". */
export function neighbourhoodId(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`district plan label "${label}" has no letters or digits`);
  return `${WATERLOO_ID_PREFIX}${slug}`;
}

/** "W17" → 17; blank or missing → null. */
export function districtNumber(code: string | null | undefined): number | null {
  const m = code?.trim().match(/^W?(\d+)$/i);
  return m ? Number(m[1]) : null;
}

const geomSql = (sql: Sql | TransactionSql, geometry: unknown) =>
  sql`st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(${JSON.stringify(geometry)}), 4326)), 3))`;

/** Load/refresh Waterloo's neighbourhoods. Idempotent: keyed by the label slug. */
export async function loadBoundaries(sql: Sql): Promise<AreaLoad[]> {
  const boundaryUrl = layerUrl(BOUNDARY.service);
  const boundary = await queryAll(boundaryUrl, { orderBy: "OBJECTID" });
  if (boundary.length !== 1 || !boundary[0].geometry) {
    throw new Error(`${BOUNDARY.service}: expected 1 boundary polygon, got ${boundary.length}`);
  }

  const districtsUrl = layerUrl(DISTRICTS.service);
  const districts = await queryAll<DistrictProps>(districtsUrl, {
    orderBy: "OBJECTID",
    outFields: ["OBJECTID", "PLANNINGDI", "LABEL", "DISTNAME"],
  });
  console.log(`  ${DISTRICTS.service}: ${districts.length} features from ${districtsUrl}`);
  // A changed count means the City redrew its plans; fail loudly instead of half-loading.
  if (districts.length !== DISTRICTS.expected) {
    throw new Error(
      `${DISTRICTS.service}: expected ${DISTRICTS.expected} features, got ${districts.length} (plans changed?)`,
    );
  }
  const rows = districts.map((f) => {
    const name = (f.properties.LABEL ?? f.properties.DISTNAME)?.trim();
    if (!name || !f.geometry) {
      throw new Error(
        `${DISTRICTS.service}: OBJECTID ${f.properties.OBJECTID} has no label or shape`,
      );
    }
    return {
      id: neighbourhoodId(name),
      name,
      number: districtNumber(f.properties.PLANNINGDI),
      geometry: f.geometry,
    };
  });
  const dupes = rows.map((r) => r.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) throw new Error(`${DISTRICTS.service}: duplicate ids ${dupes.join(", ")}`);

  await upsertSource(sql, {
    id: BOUNDARY.sourceId,
    title: BOUNDARY.title,
    url: itemPageUrl(BOUNDARY.itemId),
    licence: WATERLOO_LICENCE,
    note: `${boundaryUrl} — used to fill "${REST_NAME}", the part of the City outside every district plan`,
  });
  await upsertSource(sql, {
    id: DISTRICTS.sourceId,
    title: DISTRICTS.title,
    url: itemPageUrl(DISTRICTS.itemId),
    licence: WATERLOO_LICENCE,
    note: districtsUrl,
  });

  await sql.begin(async (tx) => {
    for (const row of rows) {
      await tx`
        insert into neighbourhoods (id, name, number, is_nia, geometry, source_id)
        values (${row.id}, ${row.name}, ${row.number}, false, ${geomSql(tx, row.geometry)},
                ${DISTRICTS.sourceId})
        on conflict (id) do update set
          name = excluded.name,
          number = excluded.number,
          is_nia = false,
          geometry = excluded.geometry,
          source_id = excluded.source_id
      `;
    }
    // The City minus every plan. Computed after the plans are in, inside the same transaction.
    const [rest] = await tx<{ geojson: string | null; m2: number }[]>`
      with city as (select ${geomSql(tx, boundary[0].geometry)} as g),
           plans as (select st_union(geometry) as g from neighbourhoods
                      where id = any(${rows.map((r) => r.id)}))
      select st_asgeojson(st_multi(st_collectionextract(st_difference(city.g, plans.g), 3))) as geojson,
             coalesce(st_area(st_difference(city.g, plans.g)::geography), 0)::float8 as m2
        from city, plans
    `;
    if (rest.geojson && rest.m2 >= MIN_REST_M2) {
      await tx`
        insert into neighbourhoods (id, name, number, is_nia, geometry, source_id)
        values (${REST_ID}, ${REST_NAME}, null, false,
                st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(${rest.geojson}), 4326)), 3)),
                ${BOUNDARY.sourceId})
        on conflict (id) do update set name = excluded.name, geometry = excluded.geometry,
          source_id = excluded.source_id
      `;
      console.log(`  ${REST_NAME}: ${(rest.m2 / 1e6).toFixed(2)} km² outside every district plan`);
    } else {
      await tx`delete from neighbourhoods where id = ${REST_ID}`;
    }
    // Waterloo areas the City no longer publishes (renamed or merged plans).
    const keep = [...rows.map((r) => r.id), REST_ID];
    await tx`
      delete from neighbourhoods
       where id like ${WATERLOO_ID_PREFIX + "%"} and id <> all(${keep})
    `;
  });
  console.log(`  neighbourhoods: ${rows.length} district plans upserted`);

  const load = await verify(sql, boundary[0].geometry);
  if (load.badSrid > 0) throw new Error(`neighbourhoods: ${load.badSrid} rows are not SRID 4326`);
  if (load.invalid > 0) throw new Error(`neighbourhoods: ${load.invalid} invalid polygons`);
  // Overlaps would put a listing in two areas; gaps would drop it as outside Waterloo.
  if (load.overlapShare > 0.005)
    throw new Error(
      `neighbourhoods overlap on ${(load.overlapShare * 100).toFixed(2)}% of the City`,
    );
  if (load.uncoveredShare > 0.005)
    throw new Error(
      `neighbourhoods leave ${(load.uncoveredShare * 100).toFixed(2)}% of the City uncovered`,
    );
  return [load];
}

async function verify(sql: Sql, boundaryGeometry: unknown): Promise<AreaLoad> {
  const [row] = await sql<
    { features: number; bad_srid: number; invalid: number; overlap: number; uncovered: number }[]
  >`
    with hoods as (select * from neighbourhoods where id like ${WATERLOO_ID_PREFIX + "%"}),
         city as (select ${geomSql(sql, boundaryGeometry)} as g)
    select (select count(*)::int from hoods) as features,
           (select count(*) filter (where st_srid(geometry) <> 4326)::int from hoods) as bad_srid,
           (select count(*) filter (where not st_isvalid(geometry))::int from hoods) as invalid,
           (select coalesce(sum(st_area(st_intersection(a.geometry, b.geometry)::geography)), 0)
              from hoods a join hoods b on a.id < b.id and st_intersects(a.geometry, b.geometry))
             / (select st_area(g::geography) from city) as overlap,
           (select st_area(st_difference(city.g, (select st_union(geometry) from hoods))::geography)
              from city) / (select st_area(g::geography) from city) as uncovered
  `;
  return {
    table: "neighbourhoods",
    features: row.features,
    badSrid: row.bad_srid,
    invalid: row.invalid,
    overlapShare: Number(row.overlap),
    uncoveredShare: Number(row.uncovered),
  };
}
