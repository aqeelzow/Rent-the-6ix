import { distanceM } from "@rentthe6ix/shared/engine/travel";
import type { Listing, TravelTarget, TravelTimeRow } from "@rentthe6ix/shared/schemas";
import { COMMUTE_TIME, torontoDate, type Departure, type RouteMode, type RoutedTrip } from "./otp";

/**
 * `routeTimes()` — owner D, the travel contract in TEAM.md §3.4 (P2.11).
 *
 * Returns one row per (listing, resolved target, mode). Rows come back as `otp` when the router
 * answered inside the budget and as `straight_line` with `minutes: null` otherwise, so the UI can
 * always label what it shows. This function never throws: a search with travel targets must still
 * rank listings when the router is down.
 *
 * Cache key is the 100 m origin cell, not the listing: at 19.5k active listings there are ~6.1k
 * distinct cells, because hundreds of ads share a building. The alternative — one route per
 * listing — triples the router load for identical answers.
 */

export type RouteTimes = (
  origins: Listing[],
  targets: TravelTarget[],
  mode: RouteMode,
  budgetMs: number,
  signal: AbortSignal,
) => Promise<TravelTimeRow[]>;

/** ~111 m of latitude, ~80 m of longitude in Toronto: the cell size the 50 m contract rounds to safely. */
const CELL_DEGREES = 0.001;
export const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROUTE_CACHE_LIMIT = 100_000;

type CacheEntry = RoutedTrip & { at: number };

/** Bounded, expiring cache of routed minutes, keyed by mode + origin cell + destination. */
export class RouteTimeCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly limit: number;

  constructor(ttlMs = ROUTE_CACHE_TTL_MS, limit = ROUTE_CACHE_LIMIT) {
    this.ttlMs = ttlMs;
    this.limit = limit;
  }

  get(key: string, now = Date.now()): RoutedTrip | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return { minutes: entry.minutes, distanceM: entry.distanceM };
  }

  set(key: string, trip: RoutedTrip, now = Date.now()): void {
    if (this.entries.size >= this.limit) {
      // Map preserves insertion order, so the oldest key is the first one; re-inserting on set
      // keeps that order aligned with recency.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, { ...trip, at: now });
  }

  get size(): number {
    return this.entries.size;
  }
}

export const originCell = (spot: { lat: number; lng: number }): string =>
  `${(Math.round(spot.lat / CELL_DEGREES) * CELL_DEGREES).toFixed(3)}:${(Math.round(spot.lng / CELL_DEGREES) * CELL_DEGREES).toFixed(3)}`;

/** Destinations are shared between listings; five decimals is ~1 m, far finer than the router's snapping. */
export const destinationKey = (spot: { lat: number; lng: number }): string =>
  `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`;

type Router = {
  route: (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    mode: RouteMode,
    options?: { signal?: AbortSignal; departure?: Departure },
  ) => Promise<RoutedTrip | null>;
};

export type CreateRouteTimesOptions = {
  cache?: RouteTimeCache;
  /**
   * Parallel router requests. Measured on the demo graph through one connection: 42 walk routes
   * finish in ~0.6 s at 12 concurrent (15 ms each), while 42 transit routes need ~4 s even at 16
   * (100 ms each) because transit search is CPU-bound. 12 keeps walk/bike/drive well inside the
   * 3 s search budget without starving the router.
   */
  concurrency?: number;
  departure?: Departure;
  now?: () => number;
};

/**
 * Hand the answer back this much before the caller's deadline.
 *
 * The search's routing step races a timer against `routeTimes` and drops the *entire* response
 * when the timer wins (candidates.ts `routeCandidateContexts`), so a 3.2-second answer to a
 * 3-second budget is worth nothing at all. Stopping short turns the pairs that did not come back
 * in time into labelled distance rows instead of discarding the ones that did.
 */
const RETURN_MARGIN_MS = 250;

const straightLineRow = (
  listing: Listing,
  target: TravelTarget,
  mode: RouteMode,
  to: { lat: number; lng: number },
  at: string,
): TravelTimeRow => ({
  listingId: listing.id,
  targetId: target.id,
  mode,
  distanceM: Math.round(distanceM(listing.location, to)),
  minutes: null,
  poiId: null,
  computedAt: at,
  method: "straight_line",
});

/**
 * Builds the `routeTimes` dependency. Place targets carry their own coordinates; amenity targets
 * have none until the POI precompute lands (P2.10), so they produce no rows here and stay
 * "unknown" rather than guessed.
 */
export function createRouteTimes(router: Router, options: CreateRouteTimesOptions = {}): RouteTimes {
  const cache = options.cache ?? new RouteTimeCache();
  const concurrency = Math.max(1, options.concurrency ?? 12);
  const now = options.now ?? (() => Date.now());

  return async (origins, targets, mode, budgetMs, signal) => {
    try {
      if (signal.aborted || !origins.length) return [];
      const places = targets.filter(
        (target): target is TravelTarget & { resolved: NonNullable<TravelTarget["resolved"]> } =>
          !!target.resolved && Number.isFinite(target.resolved.lat) && Number.isFinite(target.resolved.lng),
      );
      if (!places.length) return [];

      const departure = options.departure ?? { date: torontoDate(new Date(now())), time: COMMUTE_TIME };
      const at = new Date(now()).toISOString();
      const queued: { index: number; listing: Listing; target: TravelTarget; to: { lat: number; lng: number }; key: string }[] = [];
      const rows = new Array<TravelTimeRow>(origins.length * places.length);
      let cursor = 0;

      for (const listing of origins) for (const target of places) {
        const index = cursor++;
        const key = `${mode}|${originCell(listing.location)}|${destinationKey(target.resolved)}`;
        const hit = cache.get(key, now());
        if (hit) {
          rows[index] = {
            listingId: listing.id,
            targetId: target.id,
            mode,
            distanceM: Math.round(hit.distanceM),
            minutes: hit.minutes,
            poiId: null,
            computedAt: at,
            method: "otp",
          };
        } else {
          queued.push({ index, listing, target, to: target.resolved, key });
        }
      }

      const deadline = now() + Math.max(0, budgetMs);
      const softDeadline = deadline - RETURN_MARGIN_MS;
      // Coalesce concurrent misses: two ads in one cell must share a single router call, and the
      // cache only holds answers that have already come back.
      const inFlight = new Map<string, Promise<RoutedTrip | null>>();
      let next = 0;
      const worker = async () => {
        while (next < queued.length) {
          const item = queued[next++];
          let trip: RoutedTrip | null = null;
          if (!signal.aborted && now() < softDeadline) {
            let request = inFlight.get(item.key);
            if (!request) {
              const controller = new AbortController();
              const forward = () => controller.abort();
              signal.addEventListener("abort", forward, { once: true });
              let timer: ReturnType<typeof setTimeout> | undefined;
              // The race is the actual guarantee: a router that ignores its signal must not be able
              // to hold the search open past the budget. Aborting the request is housekeeping.
              request = Promise.race([
                router
                  .route(item.listing.location, item.to, mode, { signal: controller.signal, departure })
                  .catch(() => null),
                new Promise<RoutedTrip | null>((resolve) => {
                  timer = setTimeout(() => {
                    controller.abort();
                    resolve(null);
                  }, Math.max(50, softDeadline - now()));
                }),
              ]).finally(() => {
                clearTimeout(timer);
                signal.removeEventListener("abort", forward);
              });
              inFlight.set(item.key, request);
              void request.finally(() => inFlight.delete(item.key));
            }
            try {
              trip = await request;
            } catch {
              trip = null;
            }
          }
          if (trip && Number.isFinite(trip.minutes) && trip.minutes >= 0 && !signal.aborted) {
            cache.set(item.key, trip, now());
            rows[item.index] = {
              listingId: item.listing.id,
              targetId: item.target.id,
              mode,
              distanceM: Math.round(trip.distanceM),
              minutes: trip.minutes,
              poiId: null,
              computedAt: at,
              method: "otp",
            };
          } else {
            rows[item.index] = straightLineRow(item.listing, item.target, mode, item.to, at);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queued.length) }, worker));
      return rows.filter((row): row is TravelTimeRow => row !== undefined);
    } catch {
      return [];
    }
  };
}
