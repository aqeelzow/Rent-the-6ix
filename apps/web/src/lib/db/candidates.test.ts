import { test } from 'vitest';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, valuations, travelIntent, safetySearchFixture } from '../../../../../packages/shared/fixtures/index';
import type { Listing, TravelTimeRow } from '../../../../../packages/shared/schemas/index';
import { mapCandidatePool, searchCandidates, SearchUnavailable, type SearchDependencies } from './candidates';
const enrich: SearchDependencies['enrich'] = async () => ({ valuation: valuations[3], travel: [], safety: null });
const pool: Listing[] = Array.from({ length: 520 }, (_, i) => ({ ...sampleListings[1], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, monthlyRentCad: 1000 + 520 - i }));
const request = { intent: { ...baseIntent, sortBy: 'lowest_rent' as const }, hideUnconfirmed: false };
test('context workers preserve input order, cap concurrency and stop dispatch after failure', async () => {
  let active = 0, peak = 0;
  const selected = pool.slice(0, 24);
  const ids = await mapCandidatePool(selected, async listing => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, listing === selected[0] ? 10 : 1));
    active--;
    return listing.id;
  });
  assert.equal(peak, 8); assert.equal(active, 0);
  assert.deepEqual(ids, selected.map(listing => listing.id));
  let calls = 0;
  await assert.rejects(mapCandidatePool(selected, async () => { if (++calls === 1) throw new Error('owner failed'); await Promise.resolve(); }), /owner failed/);
  assert.equal(calls, 8);
});
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
test('amenity targets the router never reached still carry a labelled distance', async () => {
  const row = (listing: Listing, method: 'otp' | 'straight_line', minutes: number | null) => ({ listingId: listing.id, targetId: 'grocery', mode: 'walk' as const, distanceM: 300, minutes, method, computedAt: listing.lastSeenAt, poiId: null });
  const intent = { ...baseIntent, sortBy: 'lowest_rent' as const, travelTargets: [{ id: 'grocery', kind: 'amenity' as const, label: 'Groceries', category: 'grocery' as const, mode: 'walk' as const, hard: false }] };
  const result = await searchCandidates({ intent, hideUnconfirmed: false }, {
    listings: pool.slice(0, 5), enrich,
    // Answer for two listings only, as a spent routing budget does.
    routeTimes: async (origins, targets, mode) => origins.slice(0, 2).flatMap(listing => targets.map(target => ({ ...row(listing, 'otp', 6), targetId: target.id, mode }))),
    amenityDistances: async (listings, targets) => listings.flatMap(listing => targets.flatMap(target => ({ ...row(listing, 'straight_line', null), targetId: target.id }))),
  });
  const methods = result.results.map(item => item.travel.find(t => t.targetId === 'grocery')?.method);
  assert.equal(result.results.length, 5);
  assert.equal(methods.filter(method => method === 'otp').length, 2, 'the routed answers stay as they are');
  assert.equal(methods.filter(method => method === 'straight_line').length, 3, 'the rest get a distance, never minutes');
  assert.ok(result.results.every(item => item.travel.length === 1), 'no duplicate rows per target and mode');
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

test('enrichment overlaps owner reads and preserves input order for tied listings', async () => {
  let active = 0, peak = 0;
  const listings = pool.slice(0, 6).map(listing => ({ ...listing, monthlyRentCad: 2000 }));
  const result = await searchCandidates(request, { listings, enrich: async (...args) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, args[0].id === listings[0].id ? 5 : 0));
    active--;
    return enrich(...args);
  } });
  assert.equal(peak, 6);
  assert.deepEqual(result.results.map(row => row.listing.id), listings.map(listing => listing.id));
});

test('best match keeps confirmed bedrooms ahead of unknowns before the 500 cap; rooms remain excluded', async () => {
  const listings = pool.map((listing, i) => ({ ...listing, bedrooms: i < 500 ? null : 3 }));
  listings.push({ ...listings[0], id: '00000000-0000-4000-8000-999999999999', unitType: 'room', bedrooms: null });
  listings.push({ ...listings[0], id: '00000000-0000-4000-8000-999999999998', rentIsPerRoom: true, bedrooms: 3 });
  const intent = { ...baseIntent, criteria: { bedrooms: { value: { min: 3, max: 3 }, hard: true } } };
  const result = await searchCandidates({ intent, hideUnconfirmed: false }, { listings, enrich });
  assert.equal(result.eligibleCount, 520); assert.equal(result.results.length, 500);
  assert.ok(result.results.slice(0, 20).every(r => r.listing.bedrooms === 3));
  assert.ok(result.results.slice(20).every(r => r.matchScore.hardFilterNotes.includes('bedrooms: not confirmed')));
  assert.ok(result.results.every(r => r.listing.unitType !== 'room' && !r.listing.rentIsPerRoom));
  const cheapest = await searchCandidates({ intent: { ...intent, sortBy: 'lowest_rent' }, hideUnconfirmed: false }, { listings, enrich });
  assert.equal(cheapest.results[0].listing.monthlyRentCad, 1001);
});

test('best match uses neutral outlier value and confirmed must-haves before score', async () => {
  const listings = pool.slice(0, 3).map((listing, i) => ({ ...listing, bedrooms: i === 2 ? null : 2, furnished: 'yes' as const, monthlyRentCad: i === 0 ? 400 : 2000 + i * 100 }));
  const intent = { ...baseIntent, criteria: { bedrooms: { value: { min: 2, max: 2 }, hard: true }, furnished: { value: true, hard: false } } };
  const withValue: SearchDependencies['enrich'] = async listing => {
    const differencePct = listing.monthlyRentCad === 400 ? 60 : 20;
    const estimatedRentCad = listing.monthlyRentCad / (1 - differencePct / 100);
    return { valuation: { ...valuations[0], estimatedRentCad, differenceCad: estimatedRentCad - listing.monthlyRentCad, differencePct }, safety: null, travel: [] };
  };
  const result = await searchCandidates({ intent, hideUnconfirmed: false }, { listings, enrich: withValue });
  assert.deepEqual(result.results.map(r => r.listing.id), [listings[1].id, listings[0].id, listings[2].id]);
  assert.equal(result.results[0].matchScore.total, 100);
  assert.ok(result.results[1].matchScore.total < 100);
  assert.equal(result.results[1].matchScore.parts.find(p => p.id === 'value')!.score, 50);
  const numeric = await searchCandidates({ intent: { ...intent, sortBy: 'lowest_rent' }, hideUnconfirmed: false }, { listings, enrich: withValue });
  assert.equal(numeric.results[0].listing.id, listings[0].id);
});

test('best value applies C score guard before cap rather than selecting 500 outlier values', async () => {
  const listings = pool.map((listing, i) => ({ ...listing, monthlyRentCad: i < 500 ? 400 : 2000 }));
  const result = await searchCandidates({ intent: { ...baseIntent, sortBy: 'best_value' }, hideUnconfirmed: false }, { listings, enrich: async listing => {
    const differencePct = listing.monthlyRentCad === 400 ? 60 : 20;
    const estimatedRentCad = listing.monthlyRentCad / (1 - differencePct / 100);
    return { valuation: { ...valuations[0], estimatedRentCad, differenceCad: estimatedRentCad - listing.monthlyRentCad, differencePct }, safety: null, travel: [] };
  } });
  assert.ok(result.results.slice(0, 20).every(r => r.listing.monthlyRentCad === 2000));
  assert.ok(result.results.slice(20).every(r => r.matchScore.parts.find(p => p.id === 'value')!.score === 50));
});

test('rounded score ties use shared valuation confidence before rent', async () => {
  const listings = pool.slice(0, 2).map((listing, i) => ({ ...listing, monthlyRentCad: 2000 + i * 100 }));
  const result = await searchCandidates({ intent: baseIntent, hideUnconfirmed: false }, { listings, enrich: async listing => ({ valuation: { ...valuations[0], estimatedRentCad: listing.monthlyRentCad / .8, differenceCad: listing.monthlyRentCad / .8 - listing.monthlyRentCad, differencePct: 20, confidence: listing.id === listings[1].id ? 'high' : 'low' }, travel: [], safety: null }) });
  assert.deepEqual(result.results.map(r => r.matchScore.total), [100, 100]);
  assert.equal(result.results[0].listing.id, listings[1].id);
});

test('all confirmed must-haves precede any unknown hard fields', async () => {
  const listings = [
    { ...pool[0], bedrooms: null, parking: 'yes' as const },
    { ...pool[1], bedrooms: 2, parking: 'yes' as const },
  ];
  const result = await searchCandidates({ intent: { ...baseIntent, criteria: { bedrooms: { hard: true, value: { min: 2, max: 2 } }, parking: { hard: true, value: true } } }, hideUnconfirmed: false }, { listings, enrich });
  assert.equal(result.results[0].listing.id, listings[1].id);
  assert.deepEqual(result.results[0].matchScore.hardFilterNotes, []);
  assert.deepEqual(result.results[1].matchScore.hardFilterNotes, ['bedrooms: not confirmed']);
});

test('eligibility context filters full pool before500 while bounding valuation and preserving hide/routing counts', async () => {
  const listings = Array.from({ length: 620 }, (_, i) => ({ ...pool[i % pool.length], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, monthlyRentCad: 1000 + i }));
  const intent = { ...travelIntent, sortBy: 'lowest_rent' as const };
  let valuationsCalled = 0, filtersCalled = 0, routed = 0;
  const travel = (listing: Listing): TravelTimeRow[] => intent.travelTargets.flatMap(target => [target.mode, ...target.alternativeModes ?? []].map(mode => ({ listingId: listing.id, targetId: target.id, mode, minutes: listing.monthlyRentCad < 1100 ? 1000 : null, method: listing.monthlyRentCad < 1100 ? 'otp' : 'straight_line', distanceM: 100, computedAt: listing.lastSeenAt, poiId: null })));
  const deps: SearchDependencies = {
    listings,
    filterContext: async listing => { filtersCalled++; return { travel: travel(listing), safety: null }; },
    enrich: async listing => { valuationsCalled++; return { valuation: valuations[3], travel: travel(listing), safety: null }; },
    routeTimes: async (origins, targets, mode) => { routed = Math.max(routed, origins.length); return origins.flatMap(listing => targets.map(target => ({ listingId: listing.id, targetId: target.id, mode, minutes: 5, method: 'otp', distanceM: 100, computedAt: listing.lastSeenAt, poiId: null }))); },
  };
  const result = await searchCandidates({ intent, hideUnconfirmed: false }, deps);
  assert.equal(filtersCalled, 620); assert.equal(valuationsCalled, 500); assert.equal(routed, 100);
  assert.equal(result.eligibleCount, 520); assert.equal(result.results.length, 500);
  assert.equal(result.results[0].listing.monthlyRentCad, 1100);
  valuationsCalled = filtersCalled = 0;
  const hidden = await searchCandidates({ intent, hideUnconfirmed: true }, deps);
  assert.equal(filtersCalled, 620); assert.equal(valuationsCalled, 500);
  assert.equal(hidden.eligibleCount, 100); assert.equal(hidden.results.length, 100);
  const unrouted = await searchCandidates({ intent, hideUnconfirmed: true }, { ...deps, routeTimes: undefined });
  assert.equal(unrouted.eligibleCount, 0); assert.equal(unrouted.results.length, 0);
  valuationsCalled = 0;
  const unresolved = await searchCandidates({ intent: { ...intent, travelTargets: intent.travelTargets.map(target => ({ ...target, resolved: undefined })) }, hideUnconfirmed: true }, { ...deps, filterContext: async () => ({ travel: [] }) });
  assert.equal(valuationsCalled, 0); assert.equal(unresolved.results.length, 0);
});

test('valuation ordering/fairness retain full contexts and cross-listing eligibility travel cannot confirm', async () => {
  let full = 0, cheap = 0;
  const deps: SearchDependencies = { listings: pool, filterContext: async () => { cheap++; return {}; }, enrich: async (...args) => { full++; return enrich(...args); } };
  for (const intent of [{ ...travelIntent, sortBy: 'best_value' as const }, { ...travelIntent, sortBy: 'shortest_trips' as const }, { ...travelIntent, criteria: { priceFairness: { hard: true, value: ['underpriced' as const] } } }]) {
    full = cheap = 0;
    await searchCandidates({ intent, hideUnconfirmed: false }, deps);
    assert.equal(full, 520); assert.equal(cheap, 0);
  }
  const listing = pool[0];
  const response = await searchCandidates({ intent: travelIntent, hideUnconfirmed: true }, { ...deps, listings: [listing], filterContext: async () => ({ travel: [{ listingId: pool[1].id, targetId: travelIntent.travelTargets[0].id, mode: 'bike', minutes: 5, method: 'otp', distanceM: 100, computedAt: listing.lastSeenAt, poiId: null }] }) });
  assert.equal(response.results.length, 0); assert.equal(response.eligibleCount, 0);
});

test('hard safety eligibility rejects known failures across full pool before valuation cap', async () => {
  const safety = { ...(safetySearchFixture.status === 'completed' ? safetySearchFixture.results[0].safety! : null!), relativeRate: 0.5 };
  const listings = pool.map(listing => ({ ...listing, neighbourhoodId: safety.areaId }));
  const intent = { ...baseIntent, sortBy: 'lowest_rent' as const, safety: { enabled: true, hard: true, maxRelativeRate: 1 } };
  let calls = 0;
  const context = (listing: Listing) => ({ safety: listing.monthlyRentCad > 1020 ? { ...safety, relativeRate: 2 } : safety, travel: [] });
  const response = await searchCandidates({ intent, hideUnconfirmed: true }, { listings, filterContext: async listing => context(listing), enrich: async listing => { calls++; return { ...context(listing), valuation: valuations[3] }; } });
  assert.equal(calls, 20); assert.equal(response.eligibleCount, 20); assert.equal(response.results.length, 20);
  assert.equal(response.results[0].listing.monthlyRentCad, 1001);
});

test('hide filters unknown hard safety/travel before cap while retaining later confirmed matches', async () => {
  const safety = safetySearchFixture.status === 'completed' ? safetySearchFixture.results[0].safety! : null!;
  const listings = pool.map(listing => ({ ...listing, neighbourhoodId: safety.areaId }));
  const confirmed = (listing: Listing) => listing.monthlyRentCad > 1500;
  let calls = 0;
  const travel = (listing: Listing): TravelTimeRow[] => confirmed(listing) ? travelIntent.travelTargets.flatMap(target => [target.mode, ...target.alternativeModes ?? []].map(mode => ({ listingId: listing.id, targetId: target.id, mode, minutes: 5, method: 'otp', distanceM: 100, computedAt: listing.lastSeenAt, poiId: null }))) : [];
  const deps: SearchDependencies = { listings, filterContext: async listing => ({ safety: confirmed(listing) ? safety : null, travel: travel(listing) }), enrich: async listing => { calls++; return { valuation: valuations[3], safety: confirmed(listing) ? safety : null, travel: travel(listing) }; } };
  const timed = await searchCandidates({ intent: { ...travelIntent, sortBy: 'lowest_rent' }, hideUnconfirmed: true }, deps);
  assert.equal(calls, 20); assert.equal(timed.results.length, 20); assert.equal(timed.eligibleCount, 20);
  calls = 0;
  const safe = await searchCandidates({ intent: { ...baseIntent, sortBy: 'lowest_rent', safety: { enabled: true, hard: true, maxRelativeRate: 5 } }, hideUnconfirmed: true }, { ...deps, routeTimes: async () => [] });
  assert.equal(calls, 20); assert.equal(safe.results.length, 20); assert.equal(safe.eligibleCount, 20);
});
