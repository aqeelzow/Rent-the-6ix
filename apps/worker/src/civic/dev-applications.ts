// P2.14 (development half) — the City's Development Applications into `dev_applications`, then two
// indicators per neighbourhood and ward (SPEC 5, 9.1): applications submitted in the last 12 months,
// and the residential units those applications propose.
//
// Data traps, each checked against the live dataset (2026-10-17):
// - X/Y are NAD27 / MTM zone 10 (EPSG:7991): 1.2 m from the matching Address Point, where
//   EPSG:2952 is 220 m off and EPSG:2019 17 m off.
// - One application spans several addresses (one row each); it is stored once, at its first row.
// - Units appear only in the free-text description ("a total of 1,170 dwelling units", "149-unit").
//   A rezoning (OZ) and the later site plan (SA) and condominium (CD) applications usually repeat the
//   same units, so the unit indicator sums rezoning applications only; the count includes every type.
// - The rows carry applicants' names, phones and emails; none of that is stored.
import type { Sql } from "postgres";
import { CITY_LICENCE, cityDatastoreId } from "./lib/ckan.ts";
import { fetchJson } from "./lib/http.ts";
import { upsertSource } from "./sources.ts";

const SLUG = "development-applications";
const RESOURCE = "Development Applications";
const SOURCE_ID = "development-applications";
const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search";
const PAGE_SIZE = 5000;
/** NAD27 / MTM zone 10, the City's grid for this dataset (see the note above). */
const SOURCE_SRID = 7991;
const KINDS = [
  { kind: "neighbourhood", table: "neighbourhoods" },
  { kind: "ward", table: "wards" },
] as const;

export type DevRecord = Record<string, string | number | null>;

export interface DevApplication {
  id: string;
  address: string | null;
  x: number;
  y: number;
  application_type: string | null;
  status: string | null;
  proposed_units: number | null;
  submitted_date: string | null;
}

const UNITS = [
  // "a total of 1,170 dwelling units", "40 residential units", "210 Units", "15 new rental units"
  /(\d[\d,]*)\s+(?:(?:new|additional|residential|dwelling|rental|condominium|purpose[- ]built)\s+)*units?\b/i,
  // "a larger 149-unit, three-storey townhouse development"
  /(\d[\d,]*)-unit\b/i,
];

/** The proposed residential units a description states, or null when it doesn't say. */
export function parseProposedUnits(description: string | null | undefined): number | null {
  if (!description) return null;
  for (const pattern of UNITS) {
    const match = pattern.exec(description);
    if (match) {
      const units = Number(match[1].replace(/,/g, ""));
      if (Number.isInteger(units) && units > 0 && units < 100_000) return units;
    }
  }
  return null;
}

const text = (value: string | number | null | undefined): string | null => {
  const trimmed = value === null || value === undefined ? "" : String(value).trim();
  return trimmed === "" ? null : trimmed;
};

/** One row per application (its first address), with coordinates; rows without either dropped. */
export function groupApplications(records: DevRecord[]): DevApplication[] {
  const byId = new Map<string, DevApplication>();
  for (const record of records) {
    const id = text(record["APPLICATION#"]);
    const x = Number(record.X);
    const y = Number(record.Y);
    if (!id || byId.has(id) || !Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) {
      continue;
    }
    const address = [
      record.STREET_NUM,
      record.STREET_NAME,
      record.STREET_TYPE,
      record.STREET_DIRECTION,
    ]
      .map(text)
      .filter(Boolean)
      .join(" ");
    byId.set(id, {
      id,
      address: address || null,
      x,
      y,
      application_type: text(record.APPLICATION_TYPE),
      status: text(record.STATUS),
      proposed_units: parseProposedUnits(text(record.DESCRIPTION)),
      submitted_date: text(record.DATE_SUBMITTED)?.slice(0, 10) ?? null,
    });
  }
  return [...byId.values()];
}

interface SearchPage {
  success: boolean;
  result?: { total: number; records: DevRecord[] };
}

export interface DevLoad {
  records: number;
  applications: number;
  withUnits: number;
  indicators: number;
  period: string;
}

export async function loadDevApplications(sql: Sql): Promise<DevLoad> {
  const resourceId = await cityDatastoreId(SLUG, RESOURCE);
  const records: DevRecord[] = [];
  for (let offset = 0, total = Infinity; offset < total;) {
    const page = await fetchJson<SearchPage>(
      `${CKAN}?resource_id=${resourceId}&limit=${PAGE_SIZE}&offset=${offset}&sort=_id`,
    );
    if (!page.success || !page.result)
      throw new Error(`datastore_search failed at offset ${offset}`);
    total = page.result.total;
    records.push(...page.result.records);
    if (page.result.records.length === 0) break;
    offset += page.result.records.length;
  }
  const applications = groupApplications(records);
  if (applications.length === 0) throw new Error("no development applications parsed");

  const month = new Date().toISOString().slice(0, 7);
  const period = `12 months to ${month}`;
  await upsertSource(sql, {
    id: SOURCE_ID,
    title: "Development Applications",
    url: `https://open.toronto.ca/dataset/${SLUG}/`,
    licence: CITY_LICENCE,
    period: null,
    note: `CKAN datastore ${resourceId}; one row per application at its first address; units parsed from descriptions`,
  });

  for (let i = 0; i < applications.length; i += 1000) {
    const chunk = JSON.stringify(applications.slice(i, i + 1000));
    await sql`
      insert into dev_applications
        (id, address, location, application_type, status, proposed_units, submitted_date, source_id)
      select id, address,
             ST_Transform(ST_SetSRID(ST_MakePoint(x, y), ${SOURCE_SRID}::int), 4326)::geography,
             application_type, status, proposed_units, submitted_date::date, ${SOURCE_ID}
      from json_to_recordset((${chunk}::text)::json) as t(
        id text, address text, x float8, y float8, application_type text, status text,
        proposed_units int, submitted_date text)
      on conflict (id) do update set
        address = excluded.address,
        location = excluded.location,
        application_type = excluded.application_type,
        status = excluded.status,
        proposed_units = excluded.proposed_units,
        submitted_date = excluded.submitted_date,
        source_id = excluded.source_id`;
  }

  let indicators = 0;
  for (const { kind, table } of KINDS) {
    const count = await sql`
      insert into area_indicators
        (area_id, area_kind, indicator_id, value, unit, period, source_id, sample_size, note)
      select a.id, ${kind}, 'dev_applications_12m',
             (select count(*) from dev_applications d
              where d.submitted_date >= current_date - interval '12 months'
                and ST_Covers(a.geometry, d.location::geometry))::float8,
             'applications', ${period}, ${SOURCE_ID}, null, 'all application types'
      from ${sql(table)} a
      on conflict (area_id, indicator_id, period) do update set
        value = excluded.value, unit = excluded.unit, source_id = excluded.source_id,
        sample_size = excluded.sample_size, note = excluded.note`;
    const units = await sql`
      insert into area_indicators
        (area_id, area_kind, indicator_id, value, unit, period, source_id, sample_size, note)
      select a.id, ${kind}, 'residential_units_proposed_12m',
             coalesce(sum(d.proposed_units), 0)::float8, 'units', ${period}, ${SOURCE_ID},
             count(d.id)::int,
             'rezoning (OZ) applications only, units read from their descriptions'
               || case when count(d.id) > count(d.proposed_units)
                       then '; ' || (count(d.id) - count(d.proposed_units)) || ' gave no unit count'
                       else '' end
      from ${sql(table)} a
      left join dev_applications d
        on d.application_type = 'OZ'
       and d.submitted_date >= current_date - interval '12 months'
       and ST_Covers(a.geometry, d.location::geometry)
      group by a.id
      on conflict (area_id, indicator_id, period) do update set
        value = excluded.value, unit = excluded.unit, source_id = excluded.source_id,
        sample_size = excluded.sample_size, note = excluded.note`;
    indicators += count.count + units.count;
  }

  return {
    records: records.length,
    applications: applications.length,
    withUnits: applications.filter((a) => a.proposed_units !== null).length,
    indicators,
    period,
  };
}
