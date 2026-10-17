// P1.12 — TTC stops from the GTFS feed. `is_rapid` drives the "rapid transit within 800 m"
// indicator (SPEC 9.2), so it is derived from the feed rather than guessed: a stop is rapid when
// it is served by a route with route_type 1 or 2 (subway/rail). TTC streetcars are route_type 0.
//
// The feed is a 36 MB ZIP published as one resource; it is read in memory and the three tables
// are indexed once, then `stop_times.txt` (the large one) is streamed line by line.
import type { Sql } from "postgres";
import { cityDataset, cityResourceUrl, CITY_LICENCE } from "./lib/ckan.ts";
import { parseCsvLine } from "./lib/csv.ts";
import { fetchBuffer } from "./lib/http.ts";
import { lines, readZipText } from "./lib/zip.ts";
import { upsertSource } from "./sources.ts";

const SLUG = "ttc-routes-and-schedules";
const SOURCE_ID = "ttc-routes-and-schedules";
const RESOURCE = "TTC Routes and Schedules Data";

interface StopRow {
  id: string;
  name: string;
  location: string;
  route_types: string[];
  is_rapid: boolean;
  source_id: string;
}

function table(text: string): { header: string[]; rows: Generator<string[]> } {
  const iterator = lines(text);
  const first = iterator.next();
  if (first.done) throw new Error("empty GTFS table");
  const header = parseCsvLine(first.value).map((name) => name.trim());
  function* rows(): Generator<string[]> {
    for (const line of iterator) {
      if (line.length > 0) yield parseCsvLine(line);
    }
  }
  return { header, rows: rows() };
}

export interface TransitStopLoad {
  stops: number;
  rapid: number;
}

export async function loadTransitStops(sql: Sql): Promise<TransitStopLoad> {
  const meta = await cityDataset(SLUG);
  const url = await cityResourceUrl(SLUG, RESOURCE);
  const archive = await fetchBuffer(url);

  const stopsText = readZipText(archive, "stops.txt");
  const routesText = readZipText(archive, "routes.txt");
  const tripsText = readZipText(archive, "trips.txt");
  const stopTimesText = readZipText(archive, "stop_times.txt");
  const feedInfo = archive.includes(Buffer.from("feed_info.txt"))
    ? readZipText(archive, "feed_info.txt")
    : null;

  // route_type 1 = subway, 2 = rail; both are "rapid". 0 (streetcar) and 3 (bus) are not.
  const rapidRoutes = new Set<string>();
  const routeTypes = new Map<string, Set<string>>();
  {
    const { header, rows } = table(routesText);
    const idAt = header.indexOf("route_id");
    const typeAt = header.indexOf("route_type");
    for (const row of rows) {
      const id = row[idAt];
      const type = row[typeAt];
      if (!id || type === undefined) continue;
      routeTypes.set(id, new Set([type]));
      if (type === "1" || type === "2") rapidRoutes.add(id);
    }
  }

  // trip_id → route_type, but only for trips that can make a stop rapid plus every type for the
  // stop's `route_types` array. Keeping the type (not the route) bounds memory to a few strings.
  const tripType = new Map<string, string>();
  {
    const { header, rows } = table(tripsText);
    const tripAt = header.indexOf("trip_id");
    const routeAt = header.indexOf("route_id");
    for (const row of rows) {
      const trip = row[tripAt];
      const route = row[routeAt];
      if (!trip || !route) continue;
      const types = routeTypes.get(route);
      if (types) for (const type of types) tripType.set(trip, type);
    }
  }

  const stopTypes = new Map<string, Set<string>>();
  {
    const { header, rows } = table(stopTimesText);
    const tripAt = header.indexOf("trip_id");
    const stopAt = header.indexOf("stop_id");
    for (const row of rows) {
      const type = tripType.get(row[tripAt]);
      if (type === undefined) continue;
      const stop = row[stopAt];
      if (!stop) continue;
      let set = stopTypes.get(stop);
      if (!set) stopTypes.set(stop, (set = new Set()));
      set.add(type);
    }
  }

  const rows: StopRow[] = [];
  {
    const { header, rows: stopRows } = table(stopsText);
    const idAt = header.indexOf("stop_id");
    const nameAt = header.indexOf("stop_name");
    const latAt = header.indexOf("stop_lat");
    const lonAt = header.indexOf("stop_lon");
    for (const row of stopRows) {
      const id = row[idAt];
      const name = row[nameAt];
      const lat = Number(row[latAt]);
      const lon = Number(row[lonAt]);
      if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const types = [...(stopTypes.get(id) ?? [])].sort();
      rows.push({
        id: `ttc:${id}`,
        name,
        location: `SRID=4326;POINT(${lon} ${lat})`,
        route_types: types,
        is_rapid: types.some((type) => type === "1" || type === "2"),
        source_id: SOURCE_ID,
      });
    }
  }

  let period: string | null = null;
  if (feedInfo) {
    const { header, rows: infoRows } = table(feedInfo);
    const start = header.indexOf("feed_start_date");
    const end = header.indexOf("feed_end_date");
    const first = infoRows.next();
    if (!first.done && start >= 0 && end >= 0) {
      period = `${first.value[start]}–${first.value[end]}`;
    }
  }

  await upsertSource(sql, {
    id: SOURCE_ID,
    title: meta.title,
    url: meta.pageUrl,
    licence: CITY_LICENCE,
    period,
    note: url,
  });

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into transit_stops ${sql(chunk, "id", "name", "location", "route_types", "is_rapid", "source_id")}
      on conflict (id) do update set
        name = excluded.name,
        location = excluded.location,
        route_types = excluded.route_types,
        is_rapid = excluded.is_rapid,
        source_id = excluded.source_id
    `;
  }

  const rapid = rows.filter((row) => row.is_rapid).length;
  if (rapid === 0) throw new Error("no rapid-transit stops found — route_type mapping is wrong");
  return { stops: rows.length, rapid };
}
