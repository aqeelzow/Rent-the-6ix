import type { TravelTimeRow } from "@rentkdubs/shared/schemas";

/**
 * OpenTripPlanner client (P2.11). Owner: D.
 *
 * OTP's GTFS GraphQL API plans exactly one origin/target pair per request — arrays are rejected
 * with `VariableTypeMismatch` — so batching happens above this file, by caching on the origin
 * grid, not by sending many places at once.
 *
 * Everything here is failure-tolerant by design: the search falls back to labelled straight-line
 * distance, so a missing, slow or broken router must never throw into a request.
 */

/** OTP's transport-mode enum for each mode the product exposes. */
export const OTP_MODES = {
  walk: "WALK",
  bike: "BICYCLE",
  drive: "CAR",
  transit: "TRANSIT",
} as const;

export type RouteMode = TravelTimeRow["mode"];

/** A routed trip: the minutes a renter would spend, and the distance actually travelled. */
export type RoutedTrip = { minutes: number; distanceM: number };

export type Spot = { lat: number; lng: number };

/** OTP reads date and time as local values in the graph's time zone, so they travel as strings. */
export type Departure = { date: string; time: string };

export type OtpClientOptions = {
  /** Base URL, e.g. `http://otp:8080`; the GraphQL endpoint is appended. */
  url: string;
  fetch?: typeof fetch;
  /** Per-request ceiling. The search budget is shorter; the caller's signal still wins. */
  timeoutMs?: number;
};

/** Demo and precompute both route at a weekday commute hour, not at whatever time a judge opens the app. */
export const COMMUTE_TIME = "08:30:00";

/** Toronto's calendar date for an instant — the machine running this may be in another zone. */
export function torontoDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

type Leg = { mode: string; distance?: number | null };
type Itinerary = { duration: number; legs?: Leg[] | null };

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * The fastest itinerary, in minutes.
 *
 * Transit is special: OTP returns a direct walk in TRANSIT results — often first — so taking
 * `itineraries[0]` reports a 69-minute "transit" trip that is really walking. For transit only
 * itineraries with at least one non-walk leg are eligible; if none exist there is no service at
 * that hour and the caller should show distance instead of a made-up time.
 */
export function fastestTrip(itineraries: readonly Itinerary[], mode: RouteMode): RoutedTrip | null {
  const usable =
    mode === "transit"
      ? itineraries.filter((itinerary) => (itinerary.legs ?? []).some((leg) => leg.mode !== "WALK"))
      : itineraries;
  let best: Itinerary | null = null;
  for (const itinerary of usable) {
    if (!Number.isFinite(itinerary.duration) || itinerary.duration < 0) continue;
    if (best === null || itinerary.duration < best.duration) best = itinerary;
  }
  if (best === null) return null;
  const distanceM = (best.legs ?? []).reduce(
    (total, leg) => total + (Number.isFinite(leg.distance) ? (leg.distance as number) : 0),
    0,
  );
  return { minutes: Math.max(1, Math.round(best.duration / 60)), distanceM };
}

const planQuery = (
  mode: RouteMode,
) => `query plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String!, $time: String!) {
  plan(from: $from, to: $to, date: $date, time: $time, numItineraries: 3, transportModes: [{ mode: ${OTP_MODES[mode]} }]) {
    itineraries { duration legs { mode distance } }
  }
}`;

/** One leg of a routed trip, with its shape along the streets or the transit line. */
export type PathLeg = {
  /** OTP's mode: WALK, BICYCLE, CAR, BUS, TRAM, RAIL… */
  mode: string;
  minutes: number;
  distanceM: number;
  /** Route number on a transit leg ("301", "7"), else null. */
  route: string | null;
  /** [lng, lat] points, as the map draws them. */
  coordinates: [number, number][];
};

/** A routed trip with its legs: what the map draws for a selected listing (#24). */
export type RoutedPath = RoutedTrip & { legs: PathLeg[] };

/**
 * Google's encoded polyline (OTP's `legGeometry.points`) as [lng, lat] pairs. Each value is a
 * zig-zag varint in 5-bit chunks, offset by 63, relative to the previous point.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

type PathItinerary = {
  duration: number;
  legs?:
    | {
        mode: string;
        duration?: number | null;
        distance?: number | null;
        route?: { shortName?: string | null } | null;
        legGeometry?: { points?: string | null } | null;
      }[]
    | null;
};

const pathQuery = (
  mode: RouteMode,
) => `query plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String!, $time: String!) {
  plan(from: $from, to: $to, date: $date, time: $time, numItineraries: 3, transportModes: [{ mode: ${OTP_MODES[mode]} }${mode === "transit" ? ", { mode: WALK }" : ""}]) {
    itineraries { duration legs { mode duration distance route { shortName } legGeometry { points } } }
  }
}`;

/** The fastest itinerary with its legs' shapes, by the same rules as `fastestTrip`. */
export function fastestPath(
  itineraries: readonly PathItinerary[],
  mode: RouteMode,
): RoutedPath | null {
  const trip = fastestTrip(itineraries, mode);
  if (!trip) return null;
  const usable =
    mode === "transit"
      ? itineraries.filter((itinerary) => (itinerary.legs ?? []).some((leg) => leg.mode !== "WALK"))
      : itineraries;
  const best = usable.reduce<PathItinerary | null>(
    (fastest, itinerary) =>
      Number.isFinite(itinerary.duration) && (!fastest || itinerary.duration < fastest.duration)
        ? itinerary
        : fastest,
    null,
  );
  const legs = (best?.legs ?? []).map((leg) => ({
    mode: leg.mode,
    minutes: Math.max(1, Math.round((leg.duration ?? 0) / 60)),
    distanceM: Math.round(leg.distance ?? 0),
    route: leg.route?.shortName ?? null,
    coordinates: leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : [],
  }));
  return { ...trip, legs: legs.filter((leg) => leg.coordinates.length > 1) };
}

export class OtpClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OtpClientOptions) {
    this.endpoint = `${trimSlash(options.url)}/otp/gtfs/v1`;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4_000;
  }

  /** One pair, one mode. Returns null for any failure — callers show distance, never an error. */
  async route(
    from: Spot,
    to: Spot,
    mode: RouteMode,
    options: { signal?: AbortSignal; departure?: Departure } = {},
  ): Promise<RoutedTrip | null> {
    if (!Number.isFinite(from.lat) || !Number.isFinite(to.lat)) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, this.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const departure = options.departure ?? { date: torontoDate(new Date()), time: COMMUTE_TIME };
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: planQuery(mode),
          // OTP's InputCoordinates spells longitude `lon`; our schemas use `lng`. Sending `lng`
          // is a validation error ("field name 'lng' is not defined"), not a wrong result.
          variables: {
            from: { lat: from.lat, lon: from.lng },
            to: { lat: to.lat, lon: to.lng },
            date: departure.date,
            time: departure.time,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        data?: { plan?: { itineraries?: Itinerary[] } | null } | null;
      };
      return fastestTrip(body.data?.plan?.itineraries ?? [], mode);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  /** Like `route`, with every leg's shape for drawing. Null for any failure. */
  async path(
    from: Spot,
    to: Spot,
    mode: RouteMode,
    options: { signal?: AbortSignal; departure?: Departure } = {},
  ): Promise<RoutedPath | null> {
    if (!Number.isFinite(from.lat) || !Number.isFinite(to.lat)) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, this.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const departure = options.departure ?? { date: torontoDate(new Date()), time: COMMUTE_TIME };
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: pathQuery(mode),
          variables: {
            from: { lat: from.lat, lon: from.lng },
            to: { lat: to.lat, lon: to.lng },
            date: departure.date,
            time: departure.time,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        data?: { plan?: { itineraries?: PathItinerary[] } | null } | null;
      };
      return fastestPath(body.data?.plan?.itineraries ?? [], mode);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
