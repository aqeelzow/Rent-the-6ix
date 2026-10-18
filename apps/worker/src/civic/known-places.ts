// Refresh the static destination catalogue used by the search parser/resolver.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { cityResourceUrl } from "./lib/ckan.ts";
import { parseCsvLine } from "./lib/csv.ts";
import { fetchText, postFormJson } from "./lib/http.ts";

const BBOX = "43.58,-79.64,43.87,-79.10";
const OUTPUT = resolve(import.meta.dirname, "../../../web/src/lib/parse/known_places.generated.json");
const placeSchema = z.object({ id: z.string().min(1), label: z.string().min(1), aliases: z.array(z.string()), group: z.string().optional(), primary: z.boolean().optional(), lng: z.number().finite().min(-180).max(180), lat: z.number().finite().min(-90).max(90) });
type Place = z.infer<typeof placeSchema>;
type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

async function intersections(): Promise<Place[]> {
  const slug = "intersection-file-city-of-toronto";
  const text = await fetchText(await cityResourceUrl(slug, "Centreline Intersection - 4326.csv"));
  const [header, ...lines] = text.trim().split(/\r?\n/).map(parseCsvLine);
  const col = (name: string) => header.indexOf(name);
  const rows: Place[] = [];
  for (const fields of lines) {
    const description = fields[col("INTERSECTION_DESC")].trim();
    const roads = description.split(" / ");
    if (roads.length < 2) continue;
    const geometry = JSON.parse(fields[col("geometry")]) as { coordinates?: number[][] };
    const [lng, lat] = geometry.coordinates?.[0] ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const short = roads.map(road => road.replace(/\b(street|avenue|road|boulevard|drive|crescent)\b/ig, "").replace(/\b(st|ave|rd|blvd|dr|cres)\.?$/i, "").trim());
    const aliases = [description, roads.join(" & "), roads.join(" and "), `${short[0]} and ${short.slice(1).join(" and ")}`];
    rows.push({ id: `toronto-intersection:${fields[col("INTERSECTION_ID")]}`, label: `${roads.join(" & ")} intersection`, aliases: [...new Set(aliases)], lng, lat });
  }
  return rows;
}

async function openStreetMap(): Promise<Place[]> {
  const query = `[out:json][timeout:120];(nwr["leisure"="park"]["name"](${BBOX});nwr["landuse"~"^(allotments|aquaculture|basin|brownfield|cemetery|commercial|construction|depot|education|farmland|farmyard|forest|garages|grass|greenfield|greenhouse_horticulture|greenery|industrial|landfill|meadow|military|orchard|plant_nursery|port|quarry|railway|recreation_ground|religious|residential|retail|salt_pond|village_green|vineyard|winter_sports)$"]["name"](${BBOX});nwr["place"="neighbourhood"]["name"](${BBOX});nwr["tourism"~"^(attraction|museum|zoo|gallery|theme_park)$"]["name"](${BBOX});nwr["railway"~"^(station|subway_entrance)$"]["name"](${BBOX});nwr["amenity"~"^(restaurant|cafe)$"]["name"]["wikidata"](${BBOX}););out center tags;`;
  const body = await postFormJson<{ elements?: Element[]; osm3s?: { timestamp_osm_base?: string } }>("https://overpass-api.de/api/interpreter", `data=${encodeURIComponent(query)}`);
  const rows: Place[] = [];
  for (const item of body.elements ?? []) {
    const name = item.tags?.name?.trim();
    const lat = item.lat ?? item.center?.lat, lng = item.lon ?? item.center?.lon;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push({ id: `osm:${item.type}/${item.id}`, label: name, aliases: [name], lng: lng!, lat: lat! });
  }
  console.info(`OpenStreetMap snapshot: ${body.osm3s?.timestamp_osm_base ?? "unknown date"}`);
  return rows;
}

const existing = placeSchema.array().parse(JSON.parse(await readFile(OUTPUT, "utf8")));
const merged = new Map(existing.map(place => [place.id, place]));
for (const place of [...await intersections(), ...await openStreetMap()]) merged.set(place.id, place);
await writeFile(OUTPUT, `${JSON.stringify([...merged.values()], null, 2)}\n`);
console.info(`Merged ${merged.size} known places into ${OUTPUT}`);
