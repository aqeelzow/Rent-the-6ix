import { test } from 'vitest';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, valuations, travelIntent, safetySearchFixture } from '../../../../../packages/shared/fixtures/index';
import { selectPercentile } from '../../../../../packages/shared/engine/score';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { SearchResponseSchema, type Listing, type NumericExtreme, type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { searchPercentileCandidates } from './candidates-percentiles';
import type { SearchDependencies } from './candidates';
const selector: NumericExtreme = { field: 'rent', direction: 'min', percentage: 5, minimumCount: 10 };
const enrich: SearchDependencies['enrich'] = async () => ({ valuation: valuations[3], travel: [], safety: null });
const execute = (intent: SearchIntent, dependencies: SearchDependencies, hideUnconfirmed = false, execution = { referenceYear: 2026 }) => searchPercentileCandidates({ intent, hideUnconfirmed }, dependencies, execution);
const scalar = { ...baseIntent, numericExtreme: selector };
const exact = { ...travelIntent, numericExtreme: { ...selector, field: 'travel' as const, targetId: 'campus', minimumCount: 1 } };
const router: NonNullable<SearchDependencies['routeTimes']> = async (origins, targets, mode) => origins.flatMap(listing => targets.map(target => ({ listingId: listing.id, targetId: target.id, mode, minutes: mode === 'walk' ? 5 : 20, distanceM: 100, computedAt: listing.lastSeenAt, method: 'otp' as const, poiId: null })));
test('scalar count, rounding, unknowns, both directions, ages and cutoff tie-breakers', () => {
  assert.equal(selectPercentile(sampleListings, selector, 2026).length, 8);
  assert.equal(selectPercentile(sampleListings, { ...selector, field: 'bedrooms' }, 2026).length, 6);
  const tied = sampleListings.slice(0, 3).map((listing, i) => ({ ...listing, bedrooms: 2, monthlyRentCad: 3000 - i * 100, lastSeenAt: i === 0 ? '2026-10-15T12:00:00Z' : listing.lastSeenAt }));
  assert.equal(selectPercentile(tied, { ...selector, field: 'bedrooms', minimumCount: 1 }, 2026)[0].id, tied[2].id);
  for (const field of ['rent', 'bedrooms', 'bathrooms', 'sizeSqft', 'buildingAge'] as const) {
    const values = selectPercentile(sampleListings, { ...selector, field, percentage: 100 }, 2026);
    const reversed = selectPercentile(sampleListings, { ...selector, field, direction: 'max', percentage: 100 }, 2026);
    if (field === 'buildingAge') { assert.equal(values[0].yearBuilt, 1966); assert.equal(reversed[0].yearBuilt, 1961); }
    else {
      const key = field === 'rent' ? 'monthlyRentCad' : field === 'sizeSqft' ? 'sqft' : field;
      assert.equal(values[0][key], reversed.at(-1)![key]);
    }
  }
  const pool = Array.from({ length: 501 }, (_, i) => ({ ...sampleListings[1], monthlyRentCad: 1000 + i }));
  assert.equal(selectPercentile(pool, { ...selector, percentage: 5 }, 2026).length, 26);
});
test('scalar full eligible pool before cap and full hard enriched filters before selection', async () => {
  const pool: Listing[] = Array.from({ length: 520 }, (_, i) => ({ ...sampleListings[1], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, monthlyRentCad: 2000 - i }));
  const all = await execute({ ...scalar, numericExtreme: { ...selector, percentage: 100 } }, { listings: pool, enrich });
  assert.equal(all.status, 'completed'); if (all.status !== 'completed') return;
  assert.equal(all.results.length, 520); assert.equal(all.results[0].listing.id, pool[519].id);
  const safety = safetySearchFixture.status === 'completed' ? safetySearchFixture.results[0].safety! : null!;
  const gated = await execute({ ...scalar, criteria: { priceFairness: { value: ['underpriced'], hard: true } }, safety: { enabled: true, hard: true }, travelTargets: travelIntent.travelTargets }, {
    listings: sampleListings, enrich: async (listing) => ({ valuation: { ...(listing.id === sampleListings[0].id ? valuations[2] : valuations[0]), estimatedRentCad: listing.monthlyRentCad / (listing.id === sampleListings[0].id ? 1.15 : .85), differenceCad: listing.monthlyRentCad / (listing.id === sampleListings[0].id ? 1.15 : .85) - listing.monthlyRentCad }, safety: { ...safety, areaId: listing.neighbourhoodId!, relativeRate: listing.id === sampleListings[1].id ? 2 : .5 }, travel: (await router([listing], travelIntent.travelTargets, 'walk', 100, new AbortController().signal)).map(row => ({ ...row, minutes: listing.id === sampleListings[2].id ? 30 : 5 })) }),
  }, true);
  assert.equal(gated.status, 'completed'); if (gated.status !== 'completed') return;
  assert.equal(gated.eligibleCount, 5); assert.equal(gated.results.length, 5);
  SearchResponseSchema.parse(gated);
});
test('scalar selection enriches only selected rows while preserving full counts, unknowns and numeric order', async () => {
  const pool: Listing[] = Array.from({ length: 520 }, (_, i) => ({ ...sampleListings[1], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, monthlyRentCad: 1500 + Math.floor(i / 3), bedrooms: i % 13 === 0 ? null : 1, sqft: i % 7 === 0 ? null : 500 + i, yearBuilt: i % 11 === 0 ? null : 1960 + i % 60 }));
  for (const field of ['rent', 'bedrooms', 'bathrooms', 'sizeSqft', 'buildingAge'] as const) for (const hide of [false, true]) {
    const intent: SearchIntent = { ...scalar, numericExtreme: { ...selector, field, direction: 'max' }, criteria: { bedrooms: { value: { min: 1 }, hard: true }, priceFairness: { value: ['underpriced'], hard: false } }, safety: { enabled: true, hard: false } };
    const eligible = pool.filter(listing => filterListing(listing, intent, {}, hide, true).passes);
    const expected = selectPercentile(eligible, intent.numericExtreme!, 2026).map(listing => listing.id);
    const enriched: string[] = [];
    const response = await execute(intent, { listings: pool, enrich: async (...args) => { enriched.push(args[0].id); return enrich(...args); } }, hide);
    assert.equal(response.status, 'completed'); if (response.status !== 'completed') continue;
    assert.equal(response.eligibleCount, eligible.length);
    assert.deepEqual(response.results.map(result => result.listing.id), expected);
    assert.deepEqual(enriched, expected);
    assert.ok(enriched.length < eligible.length);
    assert.ok(response.results.every(result => result.valuation.status === valuations[3].status && result.matchScore.parts.length === 5));
  }
});
test('scalar hard unknowns remain noted unless hidden', async () => {
  const intent = { ...scalar, criteria: { bedrooms: { value: { min: 0 }, hard: true } } };
  const visible = await execute(intent, { listings: sampleListings, enrich });
  const hidden = await execute(intent, { listings: sampleListings, enrich }, true);
  assert.equal(visible.status, 'completed'); assert.equal(hidden.status, 'completed');
  if (visible.status === 'completed' && hidden.status === 'completed') { assert.equal(visible.results.length, 7); assert.equal(hidden.results.length, 5); assert.equal(visible.results[0].matchScore.hardFilterNotes.length, 1); }
});
test('exact travel uses minimum OR mode, independent AND targets, all routes before selection', async () => {
  const targets = [...exact.travelTargets, { ...exact.travelTargets[0], id: 'work' }];
  const calls: number[] = [];
  const response = await execute({ ...exact, travelTargets: targets }, { listings: sampleListings, enrich, routeTimes: async (origins, requested, mode, budget, signal) => {
    calls.push(origins.length);
    return (await router(origins, requested, mode, budget, signal)).map(row => ({ ...row, minutes: row.targetId === 'work' && row.listingId === sampleListings[0].id ? 40 : row.targetId === 'campus' && row.listingId === sampleListings[7].id && row.mode === 'walk' ? 1 : row.minutes }));
  } });
  assert.deepEqual(calls, [8, 8]); assert.equal(response.status, 'completed'); if (response.status !== 'completed') return;
  assert.equal(response.eligibleCount, 7); assert.equal(response.results.length, 1); assert.equal(response.results[0].listing.id, sampleListings[7].id);
  assert.equal(response.results[0].travel.length, 4); assert.equal(response.results[0].matchScore.parts.length, 5);
});
test('travel full pool exceeds500 and100; no incomplete partial exact selection', async () => {
  const pool: Listing[] = Array.from({ length: 520 }, (_, i) => ({ ...sampleListings[1], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
  const seen: number[] = [];
  const complete = await execute(exact, { listings: pool, enrich, routeTimes: async (...args) => { seen.push(args[0].length); return router(...args); } });
  assert.equal(complete.status, 'completed'); assert.deepEqual(seen, [520, 520]);
  for (const failure of ['missing', 'straight_line', 'throws'] as const) {
    const result = await execute(exact, { listings: sampleListings, enrich, routeTimes: async (...args) => {
      if (failure === 'throws') throw Error('owner unavailable');
      const rows = await router(...args);
      if (args[2] !== 'bike') return rows;
      return failure === 'missing' ? rows.slice(1) : rows.map(row => ({ ...row, method: 'straight_line', minutes: null }));
    } });
    assert.equal(result.status, 'unavailable'); assert.ok(!('results' in result));
  }
});
test('shared deadline and caller abort bound enrichment and uncooperative routing', async () => {
  const budgets: number[] = [];
  const signals: AbortSignal[] = [];
  const deps: SearchDependencies = { listings: sampleListings, enrich, routeTimes: async (_l, _t, _m, budget, signal) => { budgets.push(budget); signals.push(signal); return new Promise<never>(() => {}); } };
  const result = await searchPercentileCandidates({ intent: exact, hideUnconfirmed: false }, deps, { referenceYear: 2026, deadline: Date.now() + 25 });
  assert.equal(result.status, 'unavailable'); assert.ok(budgets.every(budget => budget <= 25)); assert.ok(signals.every(signal => signal.aborted));
  const controller = new AbortController();
  const pending = searchPercentileCandidates({ intent: exact, hideUnconfirmed: false }, { listings: sampleListings, enrich: () => new Promise<never>(() => {}), routeTimes: router }, { referenceYear: 2026, signal: controller.signal });
  controller.abort(); assert.equal((await pending).status, 'unavailable');
  const expired = await searchPercentileCandidates({ intent: exact, hideUnconfirmed: false }, deps, { referenceYear: 2026, deadline: Date.now() - 1 });
  assert.equal(expired.status, 'unavailable');
});
test('exact travel without a router ranks the whole pool by distance and retains empty-pool completion', async () => {
  let calls = 0;
  const dependencies = { listings: sampleListings, enrich: async (...args: Parameters<SearchDependencies['enrich']>) => { calls++; return enrich(...args); } };
  const result = await execute(exact, dependencies);
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') {
    assert.equal(calls, sampleListings.length);
    // The 2.7 km listings are outside the 10-minute budget, so the nearest one wins on distance alone.
    assert.equal(result.results.length, 1); assert.equal(result.results[0].listing.id, sampleListings[5].id);
    assert.ok(result.results[0].travel.every(row => row.method === 'straight_line' && row.minutes === null));
  }
  const empty = await execute(exact, { ...dependencies, listings: [] });
  assert.equal(empty.status, 'completed'); if (empty.status === 'completed') { assert.equal(empty.eligibleCount, 0); assert.deepEqual(empty.results, []); }
});

test('scalar hard-place hide confirms through full-pool routing before percentile selection', async () => {
  let routed = 0;
  const result = await execute({ ...travelIntent, numericExtreme: selector }, { listings: sampleListings, enrich, routeTimes: async (...args) => { routed = args[0].length; return router(...args); } }, true);
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') { assert.equal(result.results.length, 8); assert.equal(result.eligibleCount, 8); }
  assert.equal(routed, 8);
  // A router that never answers leaves the straight-line distances, and 4 of the 8 fixture listings
  // are inside the 10-minute budget, so the search still answers rather than returning nothing.
  const failed = await execute({ ...travelIntent, numericExtreme: selector }, { listings: sampleListings, enrich, routingBudgetMs: 5, routeTimes: () => new Promise<never>(() => {}) }, true);
  assert.equal(failed.status, 'completed');
  if (failed.status === 'completed') assert.equal(failed.results.length, 4);
});
