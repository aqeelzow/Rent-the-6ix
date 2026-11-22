// Waterloo building catalogue (issue #30): db/seed/buildings.csv into `buildings` and
// `building_addresses`. The CSV is the reviewed list: a person checks each row (name, kind,
// addresses, aliases) before it is added, so every loaded building is `reviewed`.
//
// Each address must match a City of Waterloo Address Point; a row with an unmatched address
// stops the load, so a typo never silently drops a building. Buildings removed from the CSV are
// deleted, and so are their links (listings keep nothing stale: geocode re-links every run).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { normalizeAddress } from "./lib/address.ts";
import { upsertSource } from "./sources.ts";

const SOURCE_ID = "building-catalogue";
export const CSV_PATH = fileURLToPath(
  new URL("../../../../db/seed/buildings.csv", import.meta.url),
);
const KINDS = new Set(["student", "rental_apartment", "condo", "other"]);
const COLUMNS = ["id", "name", "kind", "addresses", "aliases", "strict_aliases", "evidence"];

export interface CatalogueRow {
  id: string;
  name: string;
  kind: string;
  addresses: string[];
  aliases: string[];
  strictAliases: string[];
}

const list = (cell: string) =>
  cell
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

/** Parses the catalogue CSV (no quoted fields: names and aliases never contain commas). */
export function parseCatalogue(text: string): CatalogueRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header !== COLUMNS.join(",")) throw new Error(`buildings.csv header must be: ${COLUMNS}`);
  const ids = new Set<string>();
  return lines.map((line, i) => {
    const cells = line.split(",");
    if (cells.length !== COLUMNS.length)
      throw new Error(`buildings.csv line ${i + 2}: expected ${COLUMNS.length} cells`);
    const [id, name, kind, addresses, aliases, strict] = cells.map((c) => c.trim());
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`buildings.csv: bad id "${id}"`);
    if (ids.has(id)) throw new Error(`buildings.csv: duplicate id "${id}"`);
    if (!name || !KINDS.has(kind)) throw new Error(`buildings.csv: bad name or kind for "${id}"`);
    if (!list(addresses).length) throw new Error(`buildings.csv: "${id}" has no address`);
    ids.add(id);
    return {
      id,
      name,
      kind,
      addresses: list(addresses),
      aliases: list(aliases).map((a) => a.toLowerCase()),
      strictAliases: list(strict),
    };
  });
}

export interface BuildingLoad {
  buildings: number;
  addresses: number;
  removed: number;
}

export async function loadBuildings(
  sql: Sql,
  csv = readFileSync(CSV_PATH, "utf8"),
): Promise<BuildingLoad> {
  const rows = parseCatalogue(csv);
  const points = new Map(
    (
      await sql<{ id: string; address_norm: string }[]>`
      SELECT id, address_norm FROM address_points`
    ).map((p) => [p.address_norm, p.id]),
  );
  const missing: string[] = [];
  const resolved = rows.map((row) => ({
    ...row,
    pointIds: row.addresses.map((a) => {
      const id = points.get(normalizeAddress(a) ?? "");
      if (!id) missing.push(`${row.id}: ${a}`);
      return id!;
    }),
  }));
  if (missing.length)
    throw new Error(`addresses with no City Address Point:\n  ${missing.join("\n  ")}`);

  await upsertSource(sql, {
    id: SOURCE_ID,
    title: "Waterloo building names",
    url: "/data",
    licence: "Names from OpenStreetMap (ODbL) and listing sites, reviewed by Rent the Loo",
    note: "db/seed/buildings.csv",
  });
  let addresses = 0;
  await sql.begin(async (tx) => {
    for (const b of resolved) {
      const first = b.pointIds[0];
      await tx`
        INSERT INTO buildings (id, address, address_point_id, location, name, aliases,
                               strict_aliases, kind, reviewed, source_id)
        SELECT ${b.id}, ${b.addresses[0]}, ap.id, ap.location, ${b.name}, ${b.aliases},
               ${b.strictAliases}, ${b.kind}, true, ${SOURCE_ID}
        FROM address_points ap WHERE ap.id = ${first}
        ON CONFLICT (id) DO UPDATE SET
          address = excluded.address, address_point_id = excluded.address_point_id,
          location = excluded.location, name = excluded.name, aliases = excluded.aliases,
          strict_aliases = excluded.strict_aliases, kind = excluded.kind, reviewed = true,
          source_id = excluded.source_id`;
      await tx`DELETE FROM building_addresses WHERE building_id = ${b.id}`;
      for (const ap of new Set(b.pointIds)) {
        await tx`INSERT INTO building_addresses (building_id, address_point_id) VALUES (${b.id}, ${ap})`;
        addresses++;
      }
    }
  });
  const ids = resolved.map((b) => b.id);
  const removed = await sql`
    DELETE FROM buildings WHERE source_id = ${SOURCE_ID} AND id <> all(${ids})`;
  await sql`
    UPDATE listings SET building_id = NULL
    WHERE building_id IS NOT NULL AND building_id NOT IN (SELECT id FROM buildings)`;
  return { buildings: resolved.length, addresses, removed: removed.count };
}
