import type { Sql } from "postgres";
import { parseCsvLine } from "./lib/csv.ts";
import { fetchBuffer } from "./lib/http.ts";
import { lines, readZipText } from "./lib/zip.ts";
import { upsertSource } from "./sources.ts";

const FEEDS = [
  { id: "grt-bus", feed: 1 },
  { id: "grt-ion", feed: 2 },
] as const;

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

export function parseTransitStops(archive: Buffer, sourceId: string): StopRow[] {
  const stopsText = readZipText(archive, "stops.txt");
  const routesText = readZipText(archive, "routes.txt");
  const tripsText = readZipText(archive, "trips.txt");
  const stopTimesText = readZipText(archive, "stop_times.txt");
  const routes = new Map<string, string>();
  const rapidRoutes = new Set<string>();
  {
    const { header, rows } = table(routesText);
    const idAt = header.indexOf("route_id");
    const typeAt = header.indexOf("route_type");
    const numberAt = header.indexOf("route_short_name");
    for (const row of rows) {
      const id = row[idAt];
      const type = row[typeAt];
      if (!id || !type) continue;
      routes.set(id, type);
      if (type === "0" && row[numberAt] === "301") rapidRoutes.add(id);
    }
  }

  const rapidTrips = new Set<string>();
  const tripType = new Map<string, string>();
  {
    const { header, rows } = table(tripsText);
    const tripAt = header.indexOf("trip_id");
    const routeAt = header.indexOf("route_id");
    for (const row of rows) {
      const trip = row[tripAt];
      const route = row[routeAt];
      if (!trip || !route) continue;
      const type = routes.get(route);
      if (type !== undefined) tripType.set(trip, type);
      if (rapidRoutes.has(route)) rapidTrips.add(trip);
    }
  }

  const rapidStops = new Set<string>();
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
      if (rapidTrips.has(row[tripAt])) rapidStops.add(stop);
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
      const lat = Number(row[latAt] || NaN);
      const lon = Number(row[lonAt] || NaN);
      if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const types = [...(stopTypes.get(id) ?? [])].sort();
      rows.push({
        id: `${sourceId}:${id}`,
        name,
        location: `SRID=4326;POINT(${lon} ${lat})`,
        route_types: types,
        is_rapid: rapidStops.has(id),
        source_id: "grt-gtfs",
      });
    }
  }

  return rows;
}

export async function loadTransitStops(sql: Sql): Promise<TransitStopLoad> {
  const feeds = await Promise.all(FEEDS.map(async (feed) => {
    const url = `https://webapps.regionofwaterloo.ca/api/grt-routes/api/staticfeeds/${feed.feed}`;
    return { ...feed, url, rows: parseTransitStops(await fetchBuffer(url), feed.id) };
  }));
  const rows = feeds.flatMap((feed) => feed.rows);
  const rapid = rows.filter((row) => row.is_rapid).length;
  if (feeds.some((feed) => feed.rows.length === 0) || rapid === 0) {
    throw new Error("Expected bus stops and ION rapid-transit stops");
  }

  await sql.begin(async (tx) => {
    await upsertSource(tx, {
      id: "grt-gtfs",
      title: "Grand River Transit bus and ION light rail schedules",
      url: "https://www.grt.ca/about-grt/open-data/",
      licence: "Region of Waterloo Open Data Licence v2.0",
      note: feeds.map((feed) => feed.url).join(", "),
    });
    await tx`delete from transit_stops where source_id in ('ttc-routes-and-schedules', 'grt-gtfs')`;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx`
        insert into transit_stops ${tx(chunk, "id", "name", "location", "route_types", "is_rapid", "source_id")}
      `;
    }
  });
  return { stops: rows.length, rapid };
}
