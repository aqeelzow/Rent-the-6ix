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
   * Destination for a target that carries none of its own. Amenity targets ("close to") have no
   * fixed place to route to, so the caller supplies each listing's nearest POI of that category.
   * Returning null leaves the pair unrouted, which the UI shows as unknown rather than guessed.
   */
  destinationFor?: (listing: Listing, target: TravelTarget) => Promise<{ lat: number; lng: number } | null>;
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
 * borrow one per listing from `destinationFor` (the nearest POI), so "close to groceries" is
 * routed to the shop that listing would actually walk to instead of one city-wide pin.
 */
export function createRouteTimes(router: Router, options: CreateRouteTimesOptions = {}): RouteTimes {
  const cache = options.cache ?? new RouteTimeCache();
  const concurrency = Math.max(1, options.concurrency ?? 12);
  const now = options.now ?? (() => Date.now());

  return async (origins, targets, mode, budgetMs, signal) => {
    try {
      if (signal.aborted || !origins.length) return [];
      // Places carry their own coordinates; amenities get one per listing from `destinationFor`.
      const routable = targets.filter((target) => {
        if (target.resolved) return Number.isFinite(target.resolved.lat) && Number.isFinite(target.resolved.lng);
        return target.kind === "amenity" && !!options.destinationFor;
      });
      if (!routable.length) return [];

      const departure = options.departure ?? { date: torontoDate(new Date(now())), time: COMMUTE_TIME };
      const at = new Date(now()).toISOString();
      const queued: { index: number; listing: Listing; target: TravelTarget }[] = [];
      const rows = new Array<TravelTimeRow>(origins.length * routable.length);
      let cursor = 0;
      for (const listing of origins) for (const target of routable) queued.push({ index: cursor++, listing, target });

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
          // A place's destination is known without waiting, so its distance row survives a spent budget.
          let to: { lat: number; lng: number } | null = item.target.resolved ?? null;
          if (!to && options.destinationFor && !signal.aborted && now() < softDeadline) {
            // Amenity destinations are resolved here, per listing, and stay inside the budget.
            try { to = await options.destinationFor(item.listing, item.target); } catch { to = null; }
          }
          if (to && !signal.aborted && now() < softDeadline) {
            const key = `${mode}|${originCell(item.listing.location)}|${destinationKey(to)}`;
            const hit = cache.get(key, now());
            if (hit) {
              rows[item.index] = {
                listingId: item.listing.id,
                targetId: item.target.id,
                mode,
                distanceM: Math.round(hit.distanceM),
                minutes: hit.minutes,
                poiId: null,
                computedAt: at,
                method: "otp",
              };
              continue;
            }
            let request = inFlight.get(key);
            if (!request) {
              const controller = new AbortController();
              const forward = () => controller.abort();
              signal.addEventListener("abort", forward, { once: true });
              let timer: ReturnType<typeof setTimeout> | undefined;
              // The race is the actual guarantee: a router that ignores its signal must not be able
              // to hold the search open past the budget. Aborting the request is housekeeping.
              request = Promise.race([
                router
                  .route(item.listing.location, to, mode, { signal: controller.signal, departure })
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
              inFlight.set(key, request);
              void request.finally(() => inFlight.delete(key));
            }
            try {
              trip = await request;
            } catch {
              trip = null;
            }
          }
          if (trip && to && Number.isFinite(trip.minutes) && trip.minutes >= 0 && !signal.aborted) {
            cache.set(`${mode}|${originCell(item.listing.location)}|${destinationKey(to)}`, trip, now());
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
          } else if (to) {
            rows[item.index] = straightLineRow(item.listing, item.target, mode, to, at);
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
