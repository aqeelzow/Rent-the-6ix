// Refresh the static Waterloo intersections and ION station destinations.
import { writeFile } from "node:fs/promises";
import { queryAll } from "./lib/arcgis.ts";
import { fetchBuffer } from "./lib/http.ts";
import { parseTransitStops } from "./transit-stops.ts";

const intersectionsUrl =
  "https://utility.arcgis.com/usrsvcs/servers/bd8af511e8a5473c8f5d123f222b12f3/rest/services/OpenData/OpenData/MapServer/28";
const output = new URL("../../../web/src/lib/parse/known_places.generated.json", import.meta.url);
const [junctions, ion] = await Promise.all([
  queryAll(intersectionsUrl, {
    where: "Municipality='Waterloo' AND LifeStatus='Active'",
    orderBy: "OBJECTID",
    outFields: ["OBJECTID", "StreetName1", "StreetName2", "StreetName3", "StreetName4", "StreetName5"],
    pageSize: 1000,
  }),
  fetchBuffer("https://webapps.regionofwaterloo.ca/api/grt-routes/api/staticfeeds/2"),
]);

const round = (n: number) => Number(n.toFixed(6));
const places = junctions.flatMap(({ geometry, properties }) => {
  const roads = [...new Set(
    ["StreetName1", "StreetName2", "StreetName3", "StreetName4", "StreetName5"]
      .map((field) => properties[field])
      .filter((name): name is string => typeof name === "string" && !!name.trim()),
  )];
  if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates) || roads.length < 2) return [];
  const [lng, lat] = geometry.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  const name = roads.join(" & ");
  return [{ id: `waterloo-intersection:${properties.OBJECTID}`, label: `${name} intersection`, aliases: [name], lng: round(lng), lat: round(lat) }];
});
if (places.length < 1000) throw new Error("Incomplete Waterloo intersection feed");

const stations = new Map<string, { lng: number; lat: number; count: number }>();
for (const stop of parseTransitStops(ion, "grt-ion")) {
  if (!stop.is_rapid) continue;
  const name = stop.name.split(" - ")[0];
  const [lng, lat] = stop.location.slice("SRID=4326;POINT(".length, -1).split(" ").map(Number);
  const station = stations.get(name) ?? { lng: 0, lat: 0, count: 0 };
  stations.set(name, { lng: station.lng + lng, lat: station.lat + lat, count: station.count + 1 });
}
if (stations.size < 19) throw new Error("Incomplete ION station feed");
for (const [name, { lng, lat, count }] of [...stations].sort(([a], [b]) => a.localeCompare(b))) {
  places.push({
    id: `ion:${name.toLowerCase().replaceAll(" ", "-")}`,
    label: `${name} (ION)`,
    aliases: [name, `ION ${name}`],
    lng: round(lng / count),
    lat: round(lat / count),
  });
}

await writeFile(output, `[\n${places.map((place) => "  " + JSON.stringify(place)).join(",\n")}\n]\n`);
console.info(`Wrote ${places.length} known places to ${output.pathname}`);
