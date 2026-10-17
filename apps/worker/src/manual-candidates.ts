// Pre-fill candidates for db/seed/manual.csv from TigerData, one group per SPEC 16 demo prompt:
// `pnpm --filter worker manual:candidates`. Writes the git-ignored
// apps/worker/.cache/manual-candidates.csv with checked_on empty: open each source_url, fix what's
// wrong, set checked_on, and copy the good rows into db/seed/manual.csv. Excerpts are left out.
import { mkdir, writeFile } from "node:fs/promises";
import { openDb } from "./lib/db.ts";
import { csvField, MANUAL_COLUMNS } from "./sources/manual.ts";

const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set (repo-root .env.local)");
  process.exit(1);
}

const PER_PROMPT = 12;
const yorkU = sql`ST_MakePoint(-79.5019, 43.7735)::geography`;
const stGeorge = sql`ST_MakePoint(-79.3996, 43.6683)::geography`;
const live = sql`status = 'active' AND duplicate_of IS NULL`;

const groups = {
  // "Room or studio near York University under $1,300, close to the subway, furnished."
  student: sql`
    SELECT *, ST_Distance(location, ${yorkU}) AS d FROM listings
    WHERE ${live} AND (unit_type = 'room' OR bedrooms = 0) AND monthly_rent_cad <= 1300
      AND ST_DWithin(location, ${yorkU}, 8000)
    ORDER BY (furnished = 'yes') DESC, d LIMIT ${PER_PROMPT}`,
  // "2-bed near UofT St. George, cat, value."
  couple: sql`
    SELECT *, ST_Distance(location, ${stGeorge}) AS d FROM listings
    WHERE ${live} AND bedrooms = 2 AND ST_DWithin(location, ${stGeorge}, 2000)
    ORDER BY (pets_allowed IN ('yes', 'cats_only')) DESC, d LIMIT ${PER_PROMPT}`,
  // "3 bedrooms in Scarborough under $3,200, near a public school and a park, parking."
  family: sql`
    SELECT *, 0 AS d FROM listings
    WHERE ${live} AND bedrooms = 3 AND monthly_rent_cad <= 3200
      AND ST_X(location::geometry) > -79.32 AND ST_Y(location::geometry) BETWEEN 43.70 AND 43.86
    ORDER BY (parking = 'yes') DESC, monthly_rent_cad LIMIT ${PER_PROMPT}`,
};

const lines = [MANUAL_COLUMNS.join(",")];
try {
  for (const [prompt, query] of Object.entries(groups)) {
    const rows = await query;
    console.log(`${prompt}: ${rows.length} candidates`);
    for (const r of rows) {
      const point =
        await sql`SELECT ST_X(${r.location}::geometry) AS lng, ST_Y(${r.location}::geometry) AS lat`;
      lines.push(
        [
          "",
          r.source_url,
          r.source,
          r.title,
          r.monthly_rent_cad,
          r.bedrooms,
          r.bathrooms,
          r.unit_type,
          r.sqft,
          r.year_built,
          r.air_conditioning,
          r.utilities_included,
          r.parking,
          r.pets_allowed,
          r.furnished,
          r.laundry_in_suite,
          r.available_from?.toISOString().slice(0, 10),
          r.address_text,
          point[0].lat,
          point[0].lng,
          `candidate for the ${prompt} demo prompt`,
        ]
          .map(csvField)
          .join(","),
      );
    }
  }
} finally {
  await sql.end();
}
const out = new URL("../.cache/manual-candidates.csv", import.meta.url);
await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
await writeFile(out, `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length - 1} candidates to ${out.pathname}`);
