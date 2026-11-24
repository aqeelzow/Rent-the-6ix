import type { Sql } from "postgres";
import { layerUrl, queryAll, type GeoJsonFeature } from "./lib/arcgis.ts";
import { upsertSource } from "./sources.ts";

const SOURCE = "waterloo-major-developments";
const URL = layerUrl("Online_Viewer_Major_Developments");
const PERIOD = "Current applications";

interface DevelopmentProperties {
  OBJECTID: number;
  LOCATION: string | null;
  APPSTATUS: string | null;
  Typology: string | null;
  PROPOSED_UNITS: number | null;
}

export function mappedApplications(features: GeoJsonFeature<DevelopmentProperties>[]) {
  return features.flatMap(({ properties: p, geometry }) => {
    if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)) return [];
    const [lng, lat] = geometry.coordinates;
    if (!Number.isInteger(p.OBJECTID) || !Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    return [{
      id: `waterloo:${p.OBJECTID}`,
      address: p.LOCATION,
      location: `SRID=4326;POINT(${lng} ${lat})`,
      application_type: p.Typology,
      status: p.APPSTATUS,
      proposed_units: p.PROPOSED_UNITS !== null && Number.isInteger(p.PROPOSED_UNITS) && p.PROPOSED_UNITS >= 0
        ? p.PROPOSED_UNITS : null,
      source_id: SOURCE,
    }];
  });
}

export async function loadDevApplications(sql: Sql) {
  const features = await queryAll<DevelopmentProperties>(URL, {
    orderBy: "OBJECTID",
    outFields: ["OBJECTID", "LOCATION", "APPSTATUS", "Typology", "PROPOSED_UNITS"],
  });
  const applications = mappedApplications(features);
  if (!applications.length) throw new Error("No geocoded Waterloo development applications");

  await sql.begin(async (tx) => {
    await upsertSource(tx, {
      id: SOURCE,
      title: "City of Waterloo Major Developments map",
      url: "https://www.waterloo.ca/planning-and-development/explore-planning-and-land-use-data/",
      licence: "City of Waterloo public planning map",
      note: `${URL}. Includes mapped sites only. The feed does not provide submission dates.`,
      period: PERIOD,
    });
    await tx`delete from dev_applications where source_id = ${SOURCE}`;
    for (let i = 0; i < applications.length; i += 500) {
      await tx`insert into dev_applications ${tx(applications.slice(i, i + 500))}`;
    }
    await tx`delete from area_indicators where source_id = ${SOURCE}`;
    await tx`
      insert into area_indicators
        (area_id, area_kind, indicator_id, value, unit, period, source_id, sample_size, note)
      select n.id, 'neighbourhood', 'dev_applications_under_review', count(d.id)::float8,
             'applications', ${PERIOD}, ${SOURCE}, null,
             'Mapped major development applications currently under review'
      from neighbourhoods n
      left join dev_applications d on d.source_id = ${SOURCE} and d.status = 'Under Review'
        and ST_Covers(n.geometry, d.location::geometry)
      where n.source_id in ('waterloo-district-plans', 'waterloo-city-boundary')
      group by n.id
    `;
  });
  return { records: features.length, applications: applications.length };
}
