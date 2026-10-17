import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, valuations, travelIntent } from '../../../../../packages/shared/fixtures/index';
import type { Listing, TravelTimeRow } from '../../../../../packages/shared/schemas/index';
import { searchCandidates, SearchUnavailable, type SearchDependencies } from './candidates';
const enrich: SearchDependencies['enrich'] = async () => ({ valuation: valuations[3], travel: [], safety: null });
const pool: Listing[] = Array.from({ length: 520 }, (_, i) => ({ ...sampleListings[1], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, monthlyRentCad: 1000 + 520 - i }));
const request = { intent: { ...baseIntent, sortBy: 'lowest_rent' as const }, hideUnconfirmed: false };
test('full pool numeric order precedes cap; cheap filters precede enrichment', async () => {
  let calls = 0;
  const result = await searchCandidates(request, { listings: pool, enrich: async (...args) => { calls++; return enrich(...args); } });
  assert.equal(result.eligibleCount, 520); assert.equal(result.results.length, 500);
  assert.equal(result.results[0].listing.monthlyRentCad, 1001);
  assert.equal(result.results[499].listing.monthlyRentCad, 1500);
  calls = 0;
  await searchCandidates({ ...request, intent: { ...request.intent, criteria: { rent: { value: { max: 1002 }, hard: true } } } }, { listings: pool, enrich: async (...args) => { calls++; return enrich(...args); } });
  assert.equal(calls, 2);
  await assert.rejects(searchCandidates({ ...request, intent: { ...request.intent, sortBy: 'lowest_true_cost' } }, { listings: pool, enrich }), SearchUnavailable);
});
test('routing only top100; numeric sort survives rescore; hide waits for routing', async () => {
  let routed = 0;
  const result = await searchCandidates({ intent: { ...travelIntent, sortBy: 'lowest_rent' }, hideUnconfirmed: true }, {
    listings: pool, enrich,
    routeTimes: async (origins, targets, mode) => {
      routed = Math.max(routed, origins.length);
      return origins.flatMap(l => targets.map(t => ({ listingId: l.id, targetId: t.id, mode, distanceM: 100, minutes: 5, method: 'otp' as const, computedAt: l.lastSeenAt, poiId: null })));
    },
  });
  assert.equal(routed, 100); assert.equal(result.results.length, 100); assert.equal(result.eligibleCount, 100);
  assert.equal(result.results[0].listing.monthlyRentCad, 1001);
  assert.equal(result.results[99].listing.monthlyRentCad, 1100);
});
test('one shared deadline across modes, late routing ignored, failure retains unknown', async () => {
  const budgets: number[] = [];
  let resolveLate: (rows: TravelTimeRow[]) => void = () => {};
  const late = new Promise<TravelTimeRow[]>(resolve => { resolveLate = resolve; });
  const started = Date.now();
  const result = await searchCandidates({ intent: travelIntent, hideUnconfirmed: false }, { listings: sampleListings, enrich, routingBudgetMs: 20, routeTimes: async (_l, _t, _m, budget, signal) => { budgets.push(budget); assert.equal(signal.aborted, false); return late; } });
  assert.equal(budgets.length, 2); assert.ok(budgets.every(b => b <= 20)); assert.ok(Date.now() - started < 300);
  assert.ok(result.results.every(r => r.travel.every(t => t.minutes === null)));
  assert.ok(result.results.every(r => r.matchScore.hardFilterNotes.length === 1));
  resolveLate([]);
  const failed = await searchCandidates({ intent: travelIntent, hideUnconfirmed: true }, { listings: sampleListings, enrich, routeTimes: async () => { throw Error('unavailable'); } });
  assert.equal(failed.results.length, 0);
});
test('ordinary best-match enriches only500; shortest trips sorts actual times before cap', async () => {
  let calls = 0;
  const ordinary = await searchCandidates({ intent: baseIntent, hideUnconfirmed: false }, { listings: pool, enrich: async (...args) => { calls++; return enrich(...args); } });
  assert.equal(calls, 500); assert.equal(ordinary.results.length, 500);
  const result = await searchCandidates({ intent: { ...travelIntent, sortBy: 'shortest_trips' }, hideUnconfirmed: false }, {
    listings: pool, enrich: async listing => ({ valuation: valuations[3], safety: null, travel: [{ listingId: listing.id, targetId: 'campus', mode: 'bike', minutes: listing.id === pool[519].id ? 5 : 10, method: 'otp', distanceM: 100, computedAt: listing.lastSeenAt, poiId: null }] }),
  });
  assert.equal(result.results.length, 500); assert.equal(result.results[0].listing.id, pool[519].id);
});

test('hide removes unknown cheap home fields before cap and counts full eligible pool', async () => {
  const listings = pool.map((l, i) => ({ ...l, bedrooms: i < 500 ? null : 2 }));
  const result = await searchCandidates({ intent: { ...baseIntent, criteria: { bedrooms: { value: { min: 2 }, hard: true } } }, hideUnconfirmed: true }, { listings, enrich });
  assert.equal(result.results.length, 20); assert.equal(result.eligibleCount, 20);
  assert.ok(result.results.every(r => r.listing.bedrooms === 2));
});
