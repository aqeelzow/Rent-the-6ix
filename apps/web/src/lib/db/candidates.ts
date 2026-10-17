import { ListingSchema, SearchRequestSchema, SearchResultSchema, TravelTimeRowSchema, type Listing, type SearchRequest, type SearchResult, type TravelTarget, type TravelTimeRow } from '../../../../../packages/shared/schemas/index';
import { engineConfig } from '../../../../../packages/shared/engine/config';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { bestMatchOrder, scoreListing, tieBreak, valueScore, type ScoreContext, type TieSide } from '../../../../../packages/shared/engine/score';
import { distanceM, targetModes } from '../../../../../packages/shared/engine/travel';
export type SearchDependencies = {
  // Fixture/detail pool; live search can inject the read-only SQL candidate loader.
  listings: readonly Listing[];
  loadListing?: (id: string) => Promise<Listing | null>;
  loadCandidates?: (request: SearchRequest, signal?: AbortSignal) => Promise<readonly Listing[]>;
  // Full-pool hard gates/numeric ordering also use the owner context.
  enrich: (listing: Listing, intent: SearchRequest['intent'], signal?: AbortSignal) => Promise<ScoreContext>;
  // Draft adapter contract; not a claim about D's actual exports.
  routeTimes?: (origins: Listing[], targets: TravelTarget[], mode: TravelTimeRow['mode'], budgetMs: number, signal: AbortSignal) => Promise<TravelTimeRow[]>;
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
export function tripMinutes(intent: SearchRequest['intent'], travel: TravelTimeRow[]): number {
  if (!intent.travelTargets.length) return Infinity;
  let sum = 0;
  for (const target of intent.travelTargets) {
    const times = travel.filter(r => r.targetId === target.id && targetModes(target).includes(r.mode) && r.method === 'otp' && r.minutes !== null).map(r => r.minutes!);
    if (!times.length) return Infinity;
    sum += Math.min(...times);
  }
  return sum / intent.travelTargets.length;
}
const tieSide = (listing: Listing, valuation?: { status: string; confidence: TieSide['confidence'] }): TieSide => ({ listing, confidence: valuation?.confidence, valued: valuation?.status === 'ok' });
export function compareResults(intent: SearchRequest['intent'], a: SearchResult, b: SearchResult): number {
  const left = tieSide(a.listing, a.valuation), right = tieSide(b.listing, b.valuation);
  if (intent.sortBy === 'best_match') return bestMatchOrder({ total: a.matchScore.total, unconfirmed: a.matchScore.hardFilterNotes.length, tie: left }, { total: b.matchScore.total, unconfirmed: b.matchScore.hardFilterNotes.length, tie: right });
  const primary = intent.sortBy === 'lowest_rent' ? a.listing.monthlyRentCad - b.listing.monthlyRentCad : intent.sortBy === 'newest' ? Date.parse(b.listing.lastSeenAt) - Date.parse(a.listing.lastSeenAt) : intent.sortBy === 'best_value' ? part(b, 'value') - part(a, 'value') : intent.sortBy === 'shortest_trips' ? tripMinutes(intent, a.travel) - tripMinutes(intent, b.travel) : b.matchScore.total - a.matchScore.total;
  return (Number.isNaN(primary) ? 0 : primary) || tieBreak(left, right);
}
export async function searchCandidates(input: SearchRequest, dependencies: SearchDependencies) {
  const request = SearchRequestSchema.parse(input), { intent } = request;
  if (intent.numericExtreme) throw new SearchUnavailable('Percentile selection requires the full-pool percentile pipeline');
  if (intent.sortBy === 'lowest_true_cost') throw new SearchUnavailable('True monthly cost requires D-owned affordability data');
  const source = dependencies.loadCandidates ? await dependencies.loadCandidates(request) : dependencies.listings;
  const pool = source.map(l => ListingSchema.parse(l)).filter(l => filterListing(l, intent, {}, request.hideUnconfirmed, true).passes);
  // Numeric listing sorts operate on the entire cheap-filtered pool before expensive enrichment.
  if (intent.sortBy === 'lowest_rent' || intent.sortBy === 'newest') pool.sort((a, b) => intent.sortBy === 'lowest_rent' ? a.monthlyRentCad - b.monthlyRentCad || tieBreak(tieSide(a), tieSide(b)) : Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || tieBreak(tieSide(a), tieSide(b)));
  const contexts = new Map<string, ScoreContext>();
  // Fairness/safety hard filters must be known before taking the numeric candidate cap.
  const fullContextRequired = intent.sortBy === 'best_value' || intent.sortBy === 'shortest_trips' || intent.criteria.priceFairness?.hard || intent.safety.hard || intent.travelTargets.some(t => t.hard);
  const contextPool = fullContextRequired ? pool : pool.slice(0, engineConfig.candidateLimit);
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
  if (intent.sortBy === 'best_value' || intent.sortBy === 'shortest_trips') {
    const key = (listing: Listing) => {
      const context = contexts.get(listing.id)!;
      return intent.sortBy === 'best_value' ? valueScore(context.valuation) ?? -Infinity : -tripMinutes(intent, context.travel);
    };
    eligible.sort((a, b) => (key(b) - key(a) || tieBreak(tieSide(a, contexts.get(a.id)!.valuation), tieSide(b, contexts.get(b.id)!.valuation))));
  }
  const candidates = eligible.slice(0, engineConfig.candidateLimit).map(listing => {
    const context = contexts.get(listing.id)!;
    return SearchResultSchema.parse({ listing, valuation: context.valuation, safety: context.safety, travel: context.travel, matchScore: scoreListing(listing, intent, context) });
  }).sort((a, b) => compareResults(intent, a, b));
  // Amenities are routable too: `routeTimes` resolves each listing's nearest POI of that category.
  const targets = intent.travelTargets.filter(t => t.kind === 'place' || t.kind === 'amenity');
  await routeCandidateContexts(dependencies, candidates.slice(0, engineConfig.routingLimit).map(r => r.listing), targets, contexts);
  const results = candidates.flatMap(result => {
    const context = contexts.get(result.listing.id)!;
    if (!filterListing(result.listing, intent, context, request.hideUnconfirmed).passes) return [];
    return [SearchResultSchema.parse({ ...result, travel: context.travel, matchScore: scoreListing(result.listing, intent, context) })];
  }).sort((a, b) => compareResults(intent, a, b));
  const eligibleCount = fullContextRequired ? pool.filter(listing => filterListing(listing, intent, contexts.get(listing.id)!, request.hideUnconfirmed).passes).length : pool.length - (candidates.length - results.length);
  return { results, eligibleCount, notices: [dependencies.loadCandidates ? 'Unconfirmed fields and unrouted travel times remain unknown' : 'Fixture-backed application pool; live SQL and owner integrations pending'] };
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
