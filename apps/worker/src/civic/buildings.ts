// P1.14 — RentSafeTO registered apartment buildings. Two City CSVs joined on RSN:
//   * registration: year built, storeys, units, property type, site address (no coordinates)
//   * evaluations (2023–current): the score, its date, and latitude/longitude
//
// The evaluation scores also feed C's same-building valuation cap and the area indicators.
// Colour thresholds are the City's colour-coded sign bands (green 85–100, yellow 70–84,
// red below 70), which apply from 2026-06-15; the score itself is always stored so a reader can
// disagree with the band.
import type { Sql } from "postgres";
import { cityDataset, CITY_LICENCE } from "./lib/ckan.ts";
import { csvTable, pick, toFloat, toInt, type Row } from "./lib/csv.ts";
import { fetchText } from "./lib/http.ts";
import { normalizeAddress } from "./lib/address.ts";
import { upsertSource } from "./sources.ts";
import type { CkanResource } from "./lib/ckan.ts";

const REGISTRATION_SLUG = "apartment-building-registration";
const EVALUATION_SLUG = "apartment-building-evaluation";
const REGISTRATION_ID = "apartment-building-registration";
const EVALUATION_ID = "apartment-building-evaluation";
const SOURCE_ID = REGISTRATION_ID;

interface Score {
  year: number;
  score: number;
  date: string | null;
}

interface Building {
  id: string;
  address: string;
  addressNorm: string;
  lat: number | null;
  lng: number | null;
  yearBuilt: number | null;
  storeys: number | null;
  units: number | null;
  propertyType: string | null;
  scores: Score[];
}

function csvResource(resources: CkanResource[], matcher: RegExp, slug: string): CkanResource {
  const resource = resources.find((r) => r.format === "CSV" && matcher.test(r.name));
  if (!resource) {
    throw new Error(
      `${slug}: no CSV resource matching ${matcher}; available: ${resources
        .map((r) => r.name)
        .join(", ")}`,
    );
  }
  return resource;
}

function propertyType(value: string | null): string | null {
  const upper = (value ?? "").toUpperCase();
  if (upper.includes("TCHC")) return "tchc";
  if (upper.includes("SOCIAL")) return "social_housing";
  if (upper.includes("PRIVATE")) return "private";
  return null;
}

/** City colour bands: green 85–100, yellow 70–84, red below 70. */
function signColour(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 85) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

function buildingFor(map: Map<string, Building>, row: Row): Building | null {
  const rsn = pick(row, "RSN", "rsn");
  if (!rsn) return null;
  let building = map.get(rsn);
  if (!building) {
    const address = pick(row, "SITE_ADDRESS", "SITE ADDRESS", "site_address") ?? "";
    building = {
      id: rsn,
      address,
      addressNorm: normalizeAddress(address),
      lat: null,
      lng: null,
      yearBuilt: null,
      storeys: null,
      units: null,
      propertyType: null,
      scores: [],
    };
    map.set(rsn, building);
  }
  return building;
}

export interface BuildingLoad {
  buildings: number;
  withLocation: number;
  withAddressPoint: number;
  withScore: number;
}

export async function loadBuildings(sql: Sql): Promise<BuildingLoad> {
  const registrationMeta = await cityDataset(REGISTRATION_SLUG);
  const evaluationMeta = await cityDataset(EVALUATION_SLUG);
  const registrationResource = csvResource(
    registrationMeta.resources,
    /registration/i,
    REGISTRATION_SLUG,
  );
  const evaluationResource = csvResource(
    evaluationMeta.resources,
    /2023.*current/i,
    EVALUATION_SLUG,
  );

  await upsertSource(sql, {
    id: REGISTRATION_ID,
    title: registrationMeta.title,
    url: registrationMeta.pageUrl,
    licence: CITY_LICENCE,
    note: registrationResource.url,
  });
  await upsertSource(sql, {
    id: EVALUATION_ID,
    title: evaluationMeta.title,
    url: evaluationMeta.pageUrl,
    licence: CITY_LICENCE,
    period: "2023–current",
    note: evaluationResource.url,
  });

  const buildings = new Map<string, Building>();

  const registration = csvTable(await fetchText(registrationResource.url));
  for (const row of registration.rows) {
    const building = buildingFor(buildings, row);
    if (!building) continue;
    building.yearBuilt ??= toInt(pick(row, "YEAR_BUILT", "YEAR BUILT"));
    building.storeys ??= toInt(pick(row, "CONFIRMED_STOREYS", "NO_OF_STOREYS"));
    building.units ??= toInt(pick(row, "CONFIRMED_UNITS", "NO_OF_UNITS"));
    building.propertyType ??= propertyType(pick(row, "PROPERTY_TYPE", "PROPERTY TYPE"));
    if (!building.address) {
      building.address = pick(row, "SITE_ADDRESS", "SITE ADDRESS") ?? "";
      building.addressNorm = normalizeAddress(building.address);
    }
  }

  const evaluations = csvTable(await fetchText(evaluationResource.url));
  for (const row of evaluations.rows) {
    const building = buildingFor(buildings, row);
    if (!building) continue;
    building.yearBuilt ??= toInt(pick(row, "YEAR BUILT", "YEAR_BUILT"));
    building.storeys ??= toInt(pick(row, "CONFIRMED STOREYS", "CONFIRMED_STOREYS"));
    building.units ??= toInt(pick(row, "CONFIRMED UNITS", "CONFIRMED_UNITS"));
    building.propertyType ??= propertyType(pick(row, "PROPERTY TYPE", "PROPERTY_TYPE"));
    building.lat ??= toFloat(pick(row, "LATITUDE", "LAT"));
    building.lng ??= toFloat(pick(row, "LONGITUDE", "LONG"));
    const score = toInt(pick(row, "CURRENT BUILDING EVAL SCORE"));
    const year = toInt(pick(row, "YEAR EVALUATED"));
    if (score !== null && year !== null) {
      building.scores.push({
        year,
        score,
        date: pick(row, "EVALUATION COMPLETED ON"),
      });
    }
  }

  const rows = [...buildings.values()].map((building) => {
    const sorted = [...building.scores].sort((a, b) => a.year - b.year);
    const latest = sorted.at(-1) ?? null;
    return {
      id: building.id,
      address: building.address || "(address not published)",
      address_norm: building.addressNorm,
      location:
        building.lat !== null && building.lng !== null
          ? `SRID=4326;POINT(${building.lng} ${building.lat})`
          : null,
      year_built: building.yearBuilt,
      storeys: building.storeys,
      units: building.units,
      property_type: building.propertyType,
      latest_score: latest?.score ?? null,
      score_date: latest?.date ?? null,
      sign_colour: signColour(latest?.score ?? null),
      previous_scores: JSON.stringify(sorted.map((s) => ({ year: s.year, score: s.score }))),
      source_id: SOURCE_ID,
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into buildings ${sql(
        chunk,
        "id",
        "address",
        "address_norm",
        "location",
        "year_built",
        "storeys",
        "units",
        "property_type",
        "latest_score",
        "score_date",
        "sign_colour",
        "previous_scores",
        "source_id",
      )}
      on conflict (id) do update set
        address = excluded.address,
        address_norm = excluded.address_norm,
        location = excluded.location,
        year_built = excluded.year_built,
        storeys = excluded.storeys,
        units = excluded.units,
        property_type = excluded.property_type,
        latest_score = excluded.latest_score,
        score_date = excluded.score_date,
        sign_colour = excluded.sign_colour,
        previous_scores = excluded.previous_scores,
        source_id = excluded.source_id
    `;
  }

  // Match to an address point on the normalised address; the City's own sites and the address
  // repository disagree on spacing and abbreviations, which is exactly what the normaliser fixes.
  console.log("  buildings: matching address points");
  await sql`
    update buildings b set address_point_id = a.id
      from address_points a
     where b.address_point_id is null
       and a.address_norm = b.address_norm
  `;
  await sql`
    update buildings b set location = a.location
      from address_points a
     where b.location is null and a.id = b.address_point_id
  `;

  const [row] = await sql<
    {
      buildings: number;
      with_location: number;
      with_address_point: number;
      with_score: number;
    }[]
  >`select count(*)::int as buildings,
           count(*) filter (where location is not null)::int as with_location,
           count(*) filter (where address_point_id is not null)::int as with_address_point,
           count(*) filter (where latest_score is not null)::int as with_score
      from buildings`;
  return {
    buildings: row.buildings,
    withLocation: row.with_location,
    withAddressPoint: row.with_address_point,
    withScore: row.with_score,
  };
}
