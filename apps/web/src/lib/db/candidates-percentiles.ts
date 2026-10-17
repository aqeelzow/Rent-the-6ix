import { ListingSchema, SearchRequestSchema, SearchResponseSchema, TravelTimeRowSchema, type SearchRequest, type SearchResponse, type Listing } from '../../../../../packages/shared/schemas/index';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { scoreListing, selectPercentile, type ScoreContext } from '../../../../../packages/shared/engine/score';
import { distanceM, targetModes, targetDistanceM, estimateTravelMinutes } from '../../../../../packages/shared/engine/travel';
import { fillAmenityDistances, fillDistanceRows, mapCandidatePool, type SearchDependencies } from './candidates';
import { engineConfig } from '../../../../../packages/shared/engine/config';

export type PercentileExecution = { referenceYear: number; deadline?: number; signal?: AbortSignal };
// Jobs own scheduling and opaque tokens; this executes a single bounded job without persistence.
export async function searchPercentileCandidates(input: SearchRequest, dependencies: SearchDependencies, execution: PercentileExecution): Promise<SearchResponse> {
  const request = SearchRequestSchema.parse(input), { intent } = request, selector = intent.numericExtreme;
  if (!selector) throw new Error('A numeric percentile selector is required');
  const exactTravel = selector.field === 'travel';
  const routeTargets = exactTravel ? intent.travelTargets : intent.travelTargets.filter(target => target.hard && (target.kind === 'place' || target.kind === 'amenity'));
  const deadline = Math.min(Date.now() + engineConfig.percentileBudgetMs, execution.deadline ?? Infinity);
  const controller = new AbortController();
  const unavailable = (reason: 'timeout' | 'routing_incomplete'): SearchResponse => ({ status: 'unavailable', reason, message: reason === 'timeout' ? 'Exact travel percentile deadline elapsed or execution was cancelled' : 'Complete routed times are unavailable; no exact partial percentile is returned' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const work = async (): Promise<SearchResponse> => {
    const contexts = new Map<string, ScoreContext>();
    // Routing can change cached hard travel results; defer those gates until every route is known.
    const beforeRouting = { ...intent, travelTargets: intent.travelTargets.filter(target => !routeTargets.includes(target)) };
    const source = dependencies.loadCandidates ? await dependencies.loadCandidates(request, controller.signal) : dependencies.listings;
    const selectBeforeEnrichment = !exactTravel && !intent.criteria.priceFairness?.hard && !intent.safety.hard && !intent.travelTargets.some(target => target.hard);
    const cheapPool = source.map(raw => ListingSchema.parse(raw)).filter(listing => filterListing(listing, beforeRouting, {}, request.hideUnconfirmed, true).passes);
    // A travel percentile ranks the full pool by estimated time from distance, without a router.
    // Scalar values cannot change during enrichment when no hard gate needs owner context.
    const contextPool = selectBeforeEnrichment ? selectPercentile(cheapPool, selector, execution.referenceYear) : cheapPool;
    const enriched = await mapCandidatePool(contextPool, async listing => {
      if (controller.signal.aborted) return null;
      const owner = await dependencies.enrich(listing, intent, controller.signal);
      if (controller.signal.aborted) return null;
      const travel = owner.travel.map(row => TravelTimeRowSchema.parse(row)).filter(row => row.listingId === listing.id);
      for (const target of intent.travelTargets) if (target.resolved) for (const mode of targetModes(target)) {
        if (!travel.some(row => row.targetId === target.id && row.mode === mode)) travel.push({ listingId: listing.id, targetId: target.id, mode, minutes: null, distanceM: distanceM(listing.location, target.resolved), method: 'straight_line', computedAt: listing.lastSeenAt, poiId: null });
      }
      const context = { ...owner, travel, safety: intent.safety.enabled ? owner.safety : null };
      if (!filterListing(listing, beforeRouting, context, request.hideUnconfirmed).passes) return null;
      contexts.set(listing.id, context);
      return listing;
    });
    if (controller.signal.aborted) return unavailable('timeout');
    const eligible = enriched.filter((listing): listing is Listing => listing !== null);
    await fillDistanceRows(eligible, routeTargets, contexts);
    if (routeTargets.length && eligible.length && dependencies.routeTimes) {
      const routingDeadline = exactTravel ? deadline : Date.now() + Math.min(engineConfig.routingBudgetMs, Math.max(0, dependencies.routingBudgetMs ?? engineConfig.routingBudgetMs));
      let routingTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const groups = [...new Set(routeTargets.flatMap(targetModes))];
        const calls = Promise.all(groups.map(async mode => {
          const targets = routeTargets.filter(target => targetModes(target).includes(mode));
          let rows;
          try { rows = await dependencies.routeTimes!(eligible, targets, mode, Math.max(0, routingDeadline - Date.now()), controller.signal); }
          catch (error) { if (exactTravel) throw error; return; }
          if (controller.signal.aborted) return;
          const validated = rows.map(row => TravelTimeRowSchema.parse(row));
          for (const listing of eligible) for (const target of targets) {
            const matches = validated.filter(row => row.listingId === listing.id && row.targetId === target.id && row.mode === mode);
            if (matches.length !== 1 || matches[0].method !== 'otp' || matches[0].minutes === null) {
              if (exactTravel) throw new Error('Incomplete routed mode');
              continue;
            }
            const context = contexts.get(listing.id)!;
            context.travel = [...context.travel.filter(row => row.targetId !== target.id || row.mode !== mode), matches[0]];
          }
        }));
        await Promise.race([calls, new Promise<void>(resolve => { routingTimer = setTimeout(() => { controller.abort(); resolve(); }, Math.max(0, routingDeadline - Date.now())); })]);
      } catch { controller.abort(); if (exactTravel) return unavailable('routing_incomplete'); }
      finally { clearTimeout(routingTimer); }
      if (exactTravel && (controller.signal.aborted || Date.now() >= deadline)) return unavailable('timeout');
    }
    // Amenity targets have no point of their own, so every eligible listing gets a distance for them.
    await fillAmenityDistances(dependencies, eligible, routeTargets, contexts);
    const filtered = eligible.filter(listing => filterListing(listing, intent, contexts.get(listing.id)!, request.hideUnconfirmed).passes);
    const target = intent.travelTargets.find(target => target.id === selector.targetId);
    const selected = selectBeforeEnrichment ? filtered : selectPercentile(filtered, selector, execution.referenceYear, listing => {
      if (!target) return null;
      const metres = targetDistanceM(target, contexts.get(listing.id)!.travel, listing.location);
      return metres === null ? null : Math.min(...targetModes(target).map(mode => estimateTravelMinutes(metres, mode)));
    });
    return SearchResponseSchema.parse({ status: 'completed', results: selected.map(listing => {
      const context = contexts.get(listing.id)!;
      return { listing, valuation: context.valuation, safety: context.safety, travel: context.travel, matchScore: scoreListing(listing, intent, context) };
    }), eligibleCount: selectBeforeEnrichment ? cheapPool.length : filtered.length, notices: ['Travel times are distance-based estimates, without live traffic or timetables.'] });
  };
  if (!exactTravel) return work();
  if (execution.signal?.aborted || Date.now() >= deadline) return unavailable('timeout');
  const stopped = new Promise<SearchResponse>(resolve => {
    onAbort = () => { controller.abort(); resolve(unavailable('timeout')); };
    execution.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(onAbort, Math.max(0, deadline - Date.now()));
  });
  try { return await Promise.race([work(), stopped]); }
  finally { clearTimeout(timer); if (onAbort) execution.signal?.removeEventListener('abort', onAbort); controller.abort(); }
}
