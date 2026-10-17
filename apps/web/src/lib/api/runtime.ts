import { z } from 'zod';
import { ParseRequestSchema, SearchRequestSchema, SearchResponseSchema, SearchIntentSchema, DetailResponseSchema, TravelTimeRowSchema, ValuationSchema, CaveatSchema } from '../../../../../packages/shared/schemas/index';
import { sampleListings, fixtureTimestamp, safetySearchFixture, areas, detailFixture } from '../../../../../packages/shared/fixtures/index';
import { valuate } from '../../../../../packages/shared/engine/valuation';
import { caveats } from '../../../../../packages/shared/engine/caveats';
import { scoreListing } from '../../../../../packages/shared/engine/score';
import { distanceM, targetModes } from '../../../../../packages/shared/engine/travel';
import { ParseService, DestinationResolver, IpLimiter } from '../parse/index';
import { providerFromEnv } from '../ai/index';
import { addressPointsLookup } from '../parse/address-points';
import { searchCandidates, routeCandidateContexts, SearchUnavailable, type SearchDependencies } from '../db/candidates';
import { sqlSearchDependencies } from '../db/candidates-context';
import { OtpClient } from '../geo/otp';
import { createRouteTimes } from '../geo/route-times';
import { searchPercentileCandidates } from '../db/candidates-percentiles';
import { SearchJobs } from './jobs';
import { ApiError, jsonRoute } from './json-route';
export const fixtureDependencies: SearchDependencies = {
  listings: sampleListings,
  enrich: async (listing, intent) => {
    const now = new Date(fixtureTimestamp);
    const comparables = sampleListings.map(candidate => ({ ...candidate, distanceM: distanceM(listing.location, candidate.location), buildingKey: candidate.buildingId ?? candidate.addressPointId }));
    const valuation = ValuationSchema.parse(valuate(listing, comparables, null, now));
    // shortcut: synthetic fixtures have no building evaluation or duplicate-text matches; use owner queries for live data.
    const listingCaveats = caveats(listing, { valuation, building: null, sameTextElsewhere: 0, now }).map(c => CaveatSchema.parse(c));
    const safety = safetySearchFixture.status === 'completed' ? safetySearchFixture.results[0].safety : null;
    return { valuation, travel: [], safety: intent.safety.enabled && safety && listing.neighbourhoodId !== null ? { ...safety, areaId: listing.neighbourhoodId } : null, safetyScore: 80, caveats: listingCaveats };
  },
};
/** Travel times (P2.11): only when a router URL is configured; any failure degrades to labelled distance. */
function withRouting(dependencies: SearchDependencies, otpUrl: string | undefined): SearchDependencies {
  if (!otpUrl) return dependencies;
  return { ...dependencies, routeTimes: createRouteTimes(new OtpClient({ url: otpUrl })) };
}
type RuntimeOptions = { env?: Record<string, string | undefined>; parser?: ParseService; resolver?: DestinationResolver; dependencies?: SearchDependencies; jobs?: SearchJobs; identity?: (request: Request) => string; limiter?: IpLimiter; startLimiter?: IpLimiter; pollLimiter?: IpLimiter };
export function createRuntime(options: RuntimeOptions = {}) {
  const env = options.env ?? process.env;
  const resolver = options.resolver ?? new DestinationResolver({ maptilerKey: env.NEXT_PUBLIC_MAPTILER_KEY, addressLookup: env.SEARCH_FIXTURES !== '1' && env.DATABASE_URL ? addressPointsLookup() : undefined });
  const parser = options.parser ?? new ParseService({ provider: providerFromEnv(env), resolver });
  const jobs = options.jobs ?? new SearchJobs();
  const dependencies = options.dependencies ?? (env.SEARCH_FIXTURES === '1' ? fixtureDependencies : env.DATABASE_URL ? withRouting(sqlSearchDependencies(), env.OTP_URL) : undefined);
  // shortcut: one anonymous quota without trusted server identity, integrate A's trusted proxy adapter before production.
  const identity = options.identity ?? (() => 'anonymous');
  const limiter = options.limiter ?? new IpLimiter(60), startLimiter = options.startLimiter ?? new IpLimiter(10), pollLimiter = options.pollLimiter ?? new IpLimiter(120);
  const limit = (request: Request) => limiter.check(identity(request));
  const requireDependencies = () => { if (!dependencies) throw new ApiError(503, 'service_unavailable', 'Search temporarily unavailable'); return dependencies; };
  const params = z.strictObject({ id: z.uuid() });
  const token = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) });
  const query = (request: Request, field: string) => {
    const url = new URL(request.url);
    if (url.searchParams.getAll(field).length !== 1) throw new ApiError(422, 'validation_error', 'Exactly one query value is required');
    return z.strictObject({ [field]: z.string().min(1) }).parse(Object.fromEntries(url.searchParams))[field];
  };
  return {
    jobs,
    parse: jsonRoute({ name: 'search.parse', body: ParseRequestSchema, rateLimit: limit }, async (input, raw) => parser.parse(input, identity(raw))),
    resolve: jsonRoute({ name: 'geo.resolve', rateLimit: limit }, async (_input, request) => resolver.resolve(z.string().trim().min(1).max(500).parse(query(request, 'q')))),
    search: jsonRoute({ name: 'listings.search', body: SearchRequestSchema, rateLimit: limit }, async (request, raw) => {
      const deps = requireDependencies();
      if (request.intent.numericExtreme?.field === 'travel') {
        startLimiter.check(identity(raw));
        return jobs.start((signal, deadline) => searchPercentileCandidates(request, deps, { referenceYear: new Date().getUTCFullYear(), deadline, signal }));
      }
      try {
        return request.intent.numericExtreme ? await searchPercentileCandidates(request, deps, { referenceYear: new Date().getUTCFullYear() }) : SearchResponseSchema.parse({ status: 'completed', ...await searchCandidates(request, deps) });
      } catch (error) { if (error instanceof SearchUnavailable) throw new ApiError(503, 'service_unavailable', 'This search is temporarily unavailable'); throw error; }
    }),
    poll: jsonRoute<undefined, { params: Promise<{ token: string }> }>({ name: 'listings.search.jobs', rateLimit: request => pollLimiter.check(identity(request)) }, async (_input, _request, context) => jobs.poll(token.parse(await context.params).token)),
    detail: jsonRoute<undefined, { params: Promise<{ id: string }> }>({ name: 'listings.detail', rateLimit: limit }, async (_input, request, context) => {
      const id = params.parse(await context.params).id;
      const encoded = query(request, 'intent');
      if (encoded.length > 65536) throw new ApiError(422, 'validation_error', 'Intent exceeds 64 KiB');
      let input: unknown; try { input = JSON.parse(encoded); } catch { throw new ApiError(422, 'validation_error', 'Malformed intent JSON'); }
      const intent = SearchIntentSchema.parse(input);
      if (intent.rawPrompt || Object.keys(intent.fieldSources).length || intent.droppedRequests.length) throw new ApiError(422, 'validation_error', 'Detail intent must redact rawPrompt, fieldSources and droppedRequests');
      const deps = requireDependencies();
      let listing, owner;
      try {
        listing = deps.loadListing ? await deps.loadListing(id) : deps.listings.find(l => l.id === id);
        if (!listing) throw new ApiError(404, 'listing_not_found', 'Listing not found');
        owner = await deps.enrich(listing, intent);
      } catch (error) { if (error instanceof SearchUnavailable) throw new ApiError(503, 'service_unavailable', 'Listing details temporarily unavailable'); throw error; }
      const travel = owner.travel.map(row => TravelTimeRowSchema.parse(row)).filter(row => row.listingId === id);
      for (const target of intent.travelTargets) if (target.resolved) for (const mode of targetModes(target)) if (!travel.some(row => row.targetId === target.id && row.mode === mode)) travel.push({ listingId: id, targetId: target.id, mode, minutes: null, distanceM: distanceM(listing.location, target.resolved), method: 'straight_line', poiId: null, computedAt: listing.lastSeenAt });
      const scoring = { ...owner, travel, safety: intent.safety.enabled ? owner.safety : null };
      await routeCandidateContexts(deps, [listing], intent.travelTargets.filter(t => t.kind === 'place'), new Map([[id, scoring]]));
      // shortcut: live civic detail and duplicate adapters are unavailable; never substitute synthetic geography.
      const fixture = !deps.loadCandidates && !deps.loadListing && listing.dataStatus === 'demo';
      return DetailResponseSchema.parse({ listing, valuation: owner.valuation, travel: scoring.travel, safety: scoring.safety, matchScore: scoreListing(listing, intent, scoring), areas: fixture ? areas.filter(a => a.id === listing.neighbourhoodId || a.id === listing.wardId) : [], indicators: fixture ? detailFixture.indicators.filter(i => i.areaId === listing.neighbourhoodId) : [], duplicates: fixture ? deps.listings.filter(l => l.duplicateOf === id) : [] });
    }),
  };
}
type Runtime = ReturnType<typeof createRuntime>;
const globalRuntime = globalThis as typeof globalThis & { __rentSearchRuntime?: Runtime };
export const getRuntime = (): Runtime => globalRuntime.__rentSearchRuntime ??= createRuntime();
