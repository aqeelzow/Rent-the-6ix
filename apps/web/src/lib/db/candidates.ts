import { ListingSchema, SearchRequestSchema, SearchResultSchema, TravelTimeRowSchema, type DetailResponse, type Listing, type SearchRequest, type SearchResult, type TravelTarget, type TravelTimeRow } from '../../../../../packages/shared/schemas/index';
import { engineConfig } from '../../../../../packages/shared/engine/config';
import { filterListing, type FilterContext } from '../../../../../packages/shared/engine/filters';
import { bestMatchOrder, scoreListing, tieBreak, type ScoreContext, type TieSide } from '../../../../../packages/shared/engine/score';
import { distanceM, targetModes } from '../../../../../packages/shared/engine/travel';
export type SearchDependencies = {
  // Fixture/detail pool; live search can inject the read-only SQL candidate loader.
  listings: readonly Listing[];
  loadListing?: (id: string) => Promise<Listing | null>;
  loadDetail?: (listing: Listing, intent: SearchRequest['intent']) => Promise<Pick<DetailResponse, 'areas' | 'indicators' | 'duplicates' | 'building'>>;
  loadCandidates?: (request: SearchRequest, signal?: AbortSignal) => Promise<readonly Listing[]>;
  // Same safety/stored-travel facts as enrich, without valuation; omit when those facts require enrich.
  filterContext?: (listing: Listing, intent: SearchRequest['intent']) => Promise<FilterContext>;
  // Full-pool fairness/numeric ordering also use the owner context.
  enrich: (listing: Listing, intent: SearchRequest['intent'], signal?: AbortSignal) => Promise<ScoreContext>;
  // Optional and off by default: travel is answered by straight-line distance, and a router only
  // replaces those rows when a deployment explicitly switches it on.
  routeTimes?: (origins: Listing[], targets: TravelTarget[], mode: TravelTimeRow['mode'], budgetMs: number, signal: AbortSignal) => Promise<TravelTimeRow[]>;
  /** Labelled straight-line distance from each listing to its nearest POI per amenity target. */
  amenityDistances?: (listings: readonly Listing[], targets: readonly TravelTarget[]) => Promise<TravelTimeRow[]>;
  routingBudgetMs?: number;
};
export class SearchUnavailable extends Error {}
// Eight pipelined contexts hide network round trips without adding database connections.
export async function mapCandidatePool<T>(listings: readonly Listing[], operation: (listing: Listing) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(listings.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(8, listings.length) }, async () => {
    while (!failed && next < listings.length) {
      const index = next++;
      try { results[index] = await operation(listings[index]); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}
const part = (result: SearchResult, id: 'value') => result.matchScore.parts.find(p => p.id === id)?.score ?? -Infinity;
/**
 * Mean distance to the search's targets, the figure `shortest_trips` orders by. An unmeasured
 * listing returns Infinity, so "nothing is known about this one" never sorts as if it were close.
 */
export function tripDistanceM(intent: SearchRequest['intent'], travel: TravelTimeRow[]): number {
  if (!intent.travelTargets.length) return Infinity;
  let sum = 0;
  for (const target of intent.travelTargets) {
    const rows = travel.filter(r => r.targetId === target.id && targetModes(target).includes(r.mode));
    if (!rows.length) return Infinity;
    sum += Math.min(...rows.map(r => r.distanceM));
  }
  return sum / intent.travelTargets.length;
}
const tieSide = (listing: Listing, valuation?: { status: string; confidence: TieSide['confidence'] }): TieSide => ({ listing, confidence: valuation?.confidence, valued: valuation?.status === 'ok' });
export function compareResults(intent: SearchRequest['intent'], a: SearchResult, b: SearchResult): number {
  const left = tieSide(a.listing, a.valuation), right = tieSide(b.listing, b.valuation);
  if (intent.sortBy === 'best_match') return bestMatchOrder({ total: a.matchScore.total, unconfirmed: a.matchScore.hardFilterNotes.length, tie: left }, { total: b.matchScore.total, unconfirmed: b.matchScore.hardFilterNotes.length, tie: right });
  const primary = intent.sortBy === 'lowest_rent' ? a.listing.monthlyRentCad - b.listing.monthlyRentCad : intent.sortBy === 'newest' ? Date.parse(b.listing.lastSeenAt) - Date.parse(a.listing.lastSeenAt) : intent.sortBy === 'best_value' ? part(b, 'value') - part(a, 'value') : intent.sortBy === 'shortest_trips' ? tripDistanceM(intent, a.travel) - tripDistanceM(intent, b.travel) : b.matchScore.total - a.matchScore.total;
  return (Number.isNaN(primary) ? 0 : primary) || tieBreak(left, right);
}
/**
 * Fills the straight-line distance for every target that carries its own point, which is what the
 * app reports as travel: no router, network call or budget is involved. An amenity target has no
 * point of its own — "close to groceries" is a different address for every listing — so those are
 * left to `fillAmenityDistances`, which answers them in one query per category.
 * Existing rows for a target are replaced, except a routed row, which is a better answer when a
 * deployment has switched routing on.
 */
export async function fillDistanceRows(
  origins: readonly Listing[],
  targets: readonly TravelTarget[],
  contexts: Map<string, ScoreContext>,
): Promise<void> {
  if (!targets.length || !origins.length) return;
  await mapCandidatePool(origins, async listing => {
    const context = contexts.get(listing.id);
    if (!context) return;
    for (const target of targets) {
      if (context.travel.some(row => row.targetId === target.id && row.method === 'otp')) continue;
      const point = target.resolved ?? null;
      if (!point) continue;
      const rows = targetModes(target).map(mode => TravelTimeRowSchema.parse({
        listingId: listing.id, targetId: target.id, mode, minutes: null,
        distanceM: distanceM(listing.location, point), method: 'straight_line' as const,
        poiId: null, computedAt: listing.lastSeenAt,
      }));
      context.travel = [...context.travel.filter(row => row.targetId !== target.id), ...rows];
    }
  });
}
export async function searchCandidates(input: SearchRequest, dependencies: SearchDependencies) {
  const request = SearchRequestSchema.parse(input), { intent } = request;
  if (intent.numericExtreme) throw new SearchUnavailable('Percentile selection requires the full-pool percentile pipeline');
  if (intent.sortBy === 'lowest_true_cost') throw new SearchUnavailable('True monthly cost requires D-owned affordability data');
  const source = dependencies.loadCandidates ? await dependencies.loadCandidates(request) : dependencies.listings;
  const pool = source.map(l => ListingSchema.parse(l)).filter(l => filterListing(l, intent, {}, request.hideUnconfirmed, true).passes);
  // Numeric listing sorts operate on the entire cheap-filtered pool before expensive enrichment.
  if (intent.sortBy === 'lowest_rent' || intent.sortBy === 'newest') pool.sort((a, b) => intent.sortBy === 'lowest_rent' ? a.monthlyRentCad - b.monthlyRentCad || tieBreak(tieSide(a), tieSide(b)) : Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || tieBreak(tieSide(a), tieSide(b)));
  // Confirm hard listing facts before the ordinary candidate cap.
  if (intent.sortBy === 'best_match') pool.sort((a, b) => filterListing(a, intent, {}, false, true).notes.length - filterListing(b, intent, {}, false, true).notes.length || tieBreak(tieSide(a), tieSide(b)));
  const contexts = new Map<string, ScoreContext>();
  const filterContexts = new Map<string, FilterContext>();
  const hardContextGate = intent.safety.enabled && intent.safety.hard || intent.travelTargets.some(t => t.hard);
  const fullContextRequired = intent.sortBy === 'best_value' || intent.sortBy === 'shortest_trips' || intent.criteria.priceFairness?.hard || hardContextGate && !dependencies.filterContext;
  let eligiblePool = pool;
  if (hardContextGate && !fullContextRequired && dependencies.filterContext) {
    const filtered = await mapCandidatePool(pool, async listing => {
      const owner = await dependencies.filterContext!(listing, intent);
      const context = { ...owner, travel: owner.travel?.map(row => TravelTimeRowSchema.parse(row)).filter(row => row.listingId === listing.id) };
      filterContexts.set(listing.id, context);
      const eligibility = filterListing(listing, intent, context);
      // Travel is answered by distance further down, so a travel gate that is still open here is not
      // a reason to hide a listing the way an unknown bedroom count is.
      const unresolved = request.hideUnconfirmed && eligibility.notes.some(note => !note.startsWith('Travel to '));
      return eligibility.passes && !unresolved ? listing : null;
    });
    eligiblePool = filtered.filter((listing): listing is Listing => listing !== null);
    if (intent.sortBy === 'best_match') eligiblePool.sort((a, b) => filterListing(a, intent, filterContexts.get(a.id)).notes.length - filterListing(b, intent, filterContexts.get(b.id)).notes.length || tieBreak(tieSide(a), tieSide(b)));
  }
  const contextPool = fullContextRequired ? eligiblePool : eligiblePool.slice(0, engineConfig.candidateLimit);
  const enriched = await mapCandidatePool(contextPool, async listing => {
      const owner = await dependencies.enrich(listing, intent);
      const travel = owner.travel.map(row => TravelTimeRowSchema.parse(row)).filter(row => row.listingId === listing.id);
      for (const target of intent.travelTargets) if (target.resolved) for (const mode of targetModes(target)) {
        if (!travel.some(r => r.targetId === target.id && r.mode === mode)) travel.push({ listingId: listing.id, targetId: target.id, mode, distanceM: distanceM(listing.location, target.resolved), minutes: null, poiId: null, computedAt: listing.lastSeenAt, method: 'straight_line' });
      }
      const context = { ...owner, safety: intent.safety.enabled ? owner.safety : null, travel };
      contexts.set(listing.id, context);
      return filterListing(listing, intent, context).passes ? listing : null;
  });
  const eligible = enriched.filter((listing): listing is Listing => listing !== null);
  const candidates = eligible.map(listing => {
    const context = contexts.get(listing.id)!;
    return SearchResultSchema.parse({ listing, valuation: context.valuation, safety: context.safety, travel: context.travel, matchScore: scoreListing(listing, intent, context) });
  }).sort((a, b) => compareResults(intent, a, b)).slice(0, engineConfig.candidateLimit);
  const targets = intent.travelTargets.filter(t => t.kind === 'place' || t.kind === 'amenity');
  const origins = candidates.slice(0, engineConfig.routingLimit).map(r => r.listing);
  // Distance is the answer; a configured router only upgrades those rows to real times.
  await fillDistanceRows(origins, targets, contexts);
  await routeCandidateContexts(dependencies, origins, targets, contexts);
  // Amenities are filled for every candidate, not just the routed ones, and after routing so the
  // batch lookups never compete with the router for the same budget.
  await fillAmenityDistances(dependencies, candidates.map(r => r.listing), intent.travelTargets, contexts);
  const results = candidates.flatMap(result => {
    const context = contexts.get(result.listing.id)!;
    if (!filterListing(result.listing, intent, context, request.hideUnconfirmed).passes) return [];
    return [SearchResultSchema.parse({ ...result, travel: context.travel, matchScore: scoreListing(result.listing, intent, context) })];
  }).sort((a, b) => compareResults(intent, a, b));
  const eligibleCount = fullContextRequired || filterContexts.size ? pool.filter(listing => filterListing(listing, intent, contexts.get(listing.id) ?? filterContexts.get(listing.id), request.hideUnconfirmed).passes).length : pool.length - (candidates.length - results.length);
  return { results, eligibleCount, notices: [dependencies.loadCandidates ? 'Unconfirmed fields and unrouted travel times remain unknown' : 'Fixture-backed application pool; live SQL and owner integrations pending'] };
}

/**
 * Amenity targets the router never reached still get a labelled distance to their nearest POI.
 *
 * This runs after routing on purpose: the lookups are a batched query per category, so they cost
 * milliseconds, but running them before routing measurably starved the router and turned minutes
 * into distances. Rows already present — routed or not — are never overwritten.
 */
export async function fillAmenityDistances(
  dependencies: SearchDependencies,
  listings: readonly Listing[],
  travelTargets: readonly TravelTarget[],
  contexts: Map<string, ScoreContext>,
): Promise<void> {
  const amenities = travelTargets.filter(target => target.kind === 'amenity');
  if (!dependencies.amenityDistances || !amenities.length || !listings.length) return;
  const missing = listings.filter(listing => amenities.some(target => !contexts.get(listing.id)?.travel.some(row => row.targetId === target.id)));
  if (!missing.length) return;
  try {
    const rows = (await dependencies.amenityDistances(missing, amenities)).map(row => TravelTimeRowSchema.parse(row));
    for (const row of rows) {
      const context = contexts.get(row.listingId);
      if (!context || context.travel.some(existing => existing.targetId === row.targetId && existing.mode === row.mode)) continue;
      context.travel = [...context.travel, row];
    }
  } catch { /* A failed lookup leaves the time unconfirmed rather than guessed. */ }
}

// Shared ordinary search/detail routing preserves one deadline and owner-failure fallback.
export async function routeCandidateContexts(dependencies: SearchDependencies, origins: Listing[], targets: TravelTarget[], contexts: Map<string, ScoreContext>): Promise<void> {
  if (dependencies.routeTimes && targets.length && origins.length) {
    const budget = Math.min(engineConfig.routingBudgetMs, Math.max(0, dependencies.routingBudgetMs ?? engineConfig.routingBudgetMs));
    const deadline = Date.now() + budget;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const calls = [...new Set(targets.flatMap(targetModes))].map(async mode => {
      try {
        const rows = await dependencies.routeTimes!(origins, targets.filter(t => targetModes(t).includes(mode)), mode, Math.max(0, deadline - Date.now()), controller.signal);
        if (controller.signal.aborted || Date.now() > deadline) return;
        const validated = rows.map(row => TravelTimeRowSchema.parse(row));
        for (const row of validated) {
          if (row.mode !== mode || !origins.some(l => l.id === row.listingId) || !targets.some(t => t.id === row.targetId && targetModes(t).includes(mode))) continue;
          const context = contexts.get(row.listingId)!;
          context.travel = [...context.travel.filter(r => r.targetId !== row.targetId || r.mode !== mode), row];
        }
      } catch { /* Owner failure leaves labelled distance and unconfirmed time. */ }
    });
    await Promise.race([Promise.all(calls), new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, budget); })]);
    clearTimeout(timer);
    controller.abort();
  }
}
