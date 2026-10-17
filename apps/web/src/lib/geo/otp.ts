import type { TravelTimeRow } from "@rentthe6ix/shared/schemas";

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

const planQuery = (mode: RouteMode) => `query plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String!, $time: String!) {
  plan(from: $from, to: $to, date: $date, time: $time, numItineraries: 3, transportModes: [{ mode: ${OTP_MODES[mode]} }]) {
    itineraries { duration legs { mode distance } }
  }
}`;

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
}
