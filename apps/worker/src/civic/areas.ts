// P1.10 — official Toronto geographies: 158 social planning neighbourhoods and 25 wards.
// Both are loaded from the City's `-4326` GeoJSON (WGS84, the SRID the tables declare), and the
// feature's `AREA_SHORT_CODE` is the primary key because that is the code the City, TPS crime
// rates and the Neighbourhood Profiles all publish. `listings.neighbourhood_id`/`ward_id` hold
// the same codes, so a join never needs name matching.
import type { Sql } from "postgres";
import { cityDataset, cityResourceUrl, CITY_LICENCE } from "./lib/ckan.ts";
import { fetchJson } from "./lib/http.ts";
import { upsertSource } from "./sources.ts";

interface AreaFeature {
  properties: {
    AREA_SHORT_CODE?: string;
    AREA_NAME?: string;
    CLASSIFICATION?: string;
  };
  geometry: unknown;
}

interface FeatureCollection {
  type: string;
  features?: AreaFeature[];
}

export interface AreaLoad {
  table: "neighbourhoods" | "wards";
  features: number;
  badSrid: number;
  invalid: number;
}

interface DatasetRef {
  sourceId: string;
  slug: string;
  resource: string;
  expected: number;
}

const NEIGHBOURHOODS: DatasetRef = {
  sourceId: "neighbourhoods",
  slug: "neighbourhoods",
  resource: "Neighbourhoods - 4326.geojson",
  expected: 158,
};
const WARDS: DatasetRef = {
  sourceId: "city-wards",
  slug: "city-wards",
  resource: "City Wards Data - 4326.geojson",
  expected: 25,
};

async function fetchFeatures(sql: Sql, dataset: DatasetRef): Promise<AreaFeature[]> {
  const meta = await cityDataset(dataset.slug);
  const url = await cityResourceUrl(dataset.slug, dataset.resource);
  console.log(`  ${dataset.slug}: ${url}`);
  const body = await fetchJson<FeatureCollection>(url);
  if (body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new Error(`${dataset.slug}: expected a GeoJSON FeatureCollection`);
  }
  // A changed count means the City republished the model; fail loudly instead of half-loading.
  if (body.features.length !== dataset.expected) {
    throw new Error(
      `${dataset.slug}: expected ${dataset.expected} features, got ${body.features.length} (model changed?)`,
    );
  }
  await upsertSource(sql, {
    id: dataset.sourceId,
    title: meta.title,
    url: meta.pageUrl,
    licence: CITY_LICENCE,
    note: url,
  });
  return body.features;
}

function codesOf(feature: AreaFeature, dataset: string): { id: string; name: string } {
  const id = feature.properties.AREA_SHORT_CODE?.trim();
  const name = feature.properties.AREA_NAME?.trim();
  if (!id || !name) throw new Error(`${dataset}: feature without AREA_SHORT_CODE or AREA_NAME`);
  return { id, name };
}

async function verify(sql: Sql, table: "neighbourhoods" | "wards"): Promise<AreaLoad> {
  const [row] = await sql<{ features: number; bad_srid: number; invalid: number }[]>`
    select count(*)::int as features,
           count(*) filter (where st_srid(geometry) <> 4326)::int as bad_srid,
           count(*) filter (where not st_isvalid(geometry))::int as invalid
      from ${sql(table)}
  `;
  return { table, features: row.features, badSrid: row.bad_srid, invalid: row.invalid };
}

/** Load/refresh both boundary tables. Idempotent: keyed by AREA_SHORT_CODE. */
export async function loadBoundaries(sql: Sql): Promise<AreaLoad[]> {
  const hoods = await fetchFeatures(sql, NEIGHBOURHOODS);
  await sql.begin(async (tx) => {
    for (const feature of hoods) {
      const { id, name } = codesOf(feature, NEIGHBOURHOODS.slug);
      const nia = feature.properties.CLASSIFICATION === "Neighbourhood Improvement Area";
      await tx`
        insert into neighbourhoods (id, name, number, is_nia, geometry, source_id)
        values (${id}, ${name}, ${Number.parseInt(id, 10) || null}, ${nia},
                st_multi(st_collectionextract(
                  st_makevalid(st_setsrid(st_geomfromgeojson(${JSON.stringify(feature.geometry)}), 4326)), 3)),
                ${NEIGHBOURHOODS.sourceId})
        on conflict (id) do update set
          name = excluded.name,
          number = excluded.number,
          is_nia = excluded.is_nia,
          geometry = excluded.geometry,
          source_id = excluded.source_id
      `;
    }
  });
  console.log(`  neighbourhoods: ${hoods.length} features upserted`);

  const wards = await fetchFeatures(sql, WARDS);
  await sql.begin(async (tx) => {
    for (const feature of wards) {
      const { id, name } = codesOf(feature, WARDS.slug);
      await tx`
        insert into wards (id, name, number, geometry, source_id)
        values (${id}, ${name}, ${Number.parseInt(id, 10) || null},
                st_multi(st_collectionextract(
                  st_makevalid(st_setsrid(st_geomfromgeojson(${JSON.stringify(feature.geometry)}), 4326)), 3)),
                ${WARDS.sourceId})
        on conflict (id) do update set
          name = excluded.name,
          number = excluded.number,
          geometry = excluded.geometry,
          source_id = excluded.source_id
      `;
    }
  });
  console.log(`  wards: ${wards.length} features upserted`);

  const loads = [await verify(sql, "neighbourhoods"), await verify(sql, "wards")];
  for (const load of loads) {
    if (load.badSrid > 0) throw new Error(`${load.table}: ${load.badSrid} rows are not SRID 4326`);
    if (load.invalid > 0) throw new Error(`${load.table}: ${load.invalid} invalid polygons`);
  }
  return loads;
}
