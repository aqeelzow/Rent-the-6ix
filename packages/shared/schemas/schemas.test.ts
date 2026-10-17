import test from 'node:test';
import assert from 'node:assert/strict';
import { AreaSchema, DetailResponseSchema, DestinationResolutionSchema, ListingSchema, MatchScoreSchema, NumericExtremeSchema, ParseRequestSchema, SearchIntentSchema, SearchRequestSchema, SearchResponseSchema, SearchResultSchema, TravelTimeRowSchema, ValuationSchema } from './index';
import { areas, baseIntent, detailFixture, listings, sampleListings, safetySearchFixture, searchFixture, travelIntent, valuations } from '../fixtures/index';

test('50 synthetic listings, 3 areas, small sample, and representative responses initialize and validate', () => {
  assert.equal(listings.length, 50); assert.equal(new Set(listings.map(l => l.id)).size, 50);
  assert.equal(areas.length, 3); assert.equal(sampleListings.length, 8);
  listings.forEach(l => assert.equal(ListingSchema.safeParse(l).success, true));
  areas.forEach(a => assert.equal(AreaSchema.safeParse(a).success, true));
  assert.equal(SearchResponseSchema.safeParse(searchFixture).success, true);
  assert.equal(SearchResponseSchema.safeParse(safetySearchFixture).success, true);
  assert.equal(DetailResponseSchema.safeParse(detailFixture).success, true);
  assert.ok(listings.some(l => l.sqft === null)); assert.ok(listings.some(l => l.yearBuilt === null));
  assert.deepEqual(new Set(valuations.map(v => v.priceLabel)), new Set(['underpriced', 'reasonable', 'overpriced', 'unknown']));
});
test('legacy single mode and explicit alternatives both validate without adding unstated criteria', () => {
  assert.deepEqual(baseIntent.criteria, {}); assert.equal(baseIntent.safety.enabled, false);
  const target = travelIntent.travelTargets[0];
  assert.equal(SearchIntentSchema.safeParse(travelIntent).success, true);
  const { alternativeModes, ...legacy } = target;
  void alternativeModes; // destructured only to drop it from the legacy shape
  assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, travelTargets: [legacy] }).success, true);
  assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, travelTargets: [{ ...target, alternativeModes: ['bike'] }] }).success, false);
  assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, travelTargets: [{ ...target, resolved: { ...target.resolved, representativePoint: true, label: undefined } }] }).success, false);
});
test('trust boundaries reject invalid ranges, dates, coordinates, discriminators and unknown criteria', () => {
  for (const criteria of [{ rent: { value: { min: 3, max: 2 }, hard: true } }, { bedrooms: { value: {}, hard: true } }, { availableBy: { value: '2026-02-30', hard: true } }, { mystery: true }]) assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, criteria }).success, false);
  assert.equal(ListingSchema.safeParse({ ...listings[1], location: { lng: 181, lat: 43 } }).success, false);
  assert.equal(ListingSchema.safeParse({ ...listings[1], sourceUrl: 'javascript:alert(1)' }).success, false);
  assert.equal(ListingSchema.safeParse({ ...listings[1], yearBuiltSource: null }).success, true);
  assert.equal(ListingSchema.safeParse({ ...listings[1], firstSeenAt: '2027-01-01T00:00:00Z' }).success, false);
  assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, travelTargets: [{ ...travelIntent.travelTargets[0], kind: 'amenity' }] }).success, false);
  assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, safety: { enabled: false, hard: true } }).success, false);
  assert.equal(SearchRequestSchema.parse({ intent: baseIntent }).hideUnconfirmed, false);
  assert.equal(ParseRequestSchema.safeParse({ prompt: '   ' }).success, false);
});
test('ONE numeric extreme selector, valid target references and positive finite weights', () => {
  assert.equal(NumericExtremeSchema.parse({ field: 'rent', direction: 'min', percentage: 5 }).minimumCount, 10);
  for (const numericExtreme of [[{ field: 'rent', direction: 'min', percentage: 5 }], { field: 'rent', direction: 'min', percentage: 101 }, { field: 'travel', direction: 'min', percentage: 5, targetId: 'missing' }]) assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, numericExtreme }).success, false);
  assert.equal(SearchIntentSchema.safeParse({ ...travelIntent, numericExtreme: { field: 'travel', direction: 'min', percentage: 5, targetId: 'campus' } }).success, true);
  for (const weights of [{ value: 0, price: 0, travel: 0, home: 0, safety: 0 }, { value: Infinity, price: 0, travel: 0, home: 0, safety: 0 }, { value: 30, price: 15, travel: 30, home: 25, safety: 1 }]) assert.equal(SearchIntentSchema.safeParse({ ...baseIntent, weights }).success, false);
});
test('straight-line distance never fabricates minutes; routed rows require minutes', () => {
  assert.equal(searchFixture.status, 'completed'); if (searchFixture.status !== 'completed') return;
  const fallback = searchFixture.results[0].travel[0];
  assert.equal(fallback.minutes, null);
  assert.equal(TravelTimeRowSchema.safeParse({ ...fallback, minutes: 4 }).success, false);
  assert.equal(TravelTimeRowSchema.safeParse({ ...fallback, method: 'otp', minutes: null }).success, false);
  assert.equal(TravelTimeRowSchema.safeParse({ ...fallback, method: 'otp', minutes: 4 }).success, true);
});
test('torontorentals listings and listings not yet geocoded are representable', () => {
  // C ingests torontorentals and geocodes later, so a live row can be missing its area ids.
  const sourced = { ...listings[1], source: 'torontorentals' as const, neighbourhoodId: null, wardId: null };
  assert.equal(ListingSchema.safeParse(sourced).success, true);
  assert.equal(ListingSchema.safeParse({ ...sourced, source: 'craigslist' }).success, false);
  const { areas: unusedAreas, indicators, duplicates, ...result } = detailFixture;
  void unusedAreas; void indicators; void duplicates;
  const safety = safetySearchFixture.status === 'completed' ? safetySearchFixture.results[0].safety! : undefined!;
  assert.equal(SearchResultSchema.safeParse({ ...result, listing: sourced, safety: { ...safety, areaId: 'demo-neighbourhood-1' } }).success, false);
  assert.equal(SearchResultSchema.safeParse({ ...result, listing: sourced, safety: null }).success, true);
});
test('valuation benchmark is optional context and adjustments identify what they changed', () => {
  const adjustment = { code: 'parking', amountCad: -100, count: 3, label: '3 comparables had parking, this listing does not' };
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], benchmark: null }).success, true);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], adjustments: [adjustment] }).success, true);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], adjustments: [{ label: adjustment.label, amountCad: -100 }] }).success, true);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], adjustments: [{ ...adjustment, count: -1 }] }).success, false);
});
test('the same-building cap counts effective comparables, not raw candidates', () => {
  // Six floor plans in one building are six candidates but only two effective comparables (SPEC 7.2).
  assert.equal(ValuationSchema.safeParse({ ...valuations[3], comparableCount: 6, effectiveCount: 2 }).success, true);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], effectiveCount: 2 }).success, false);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], effectiveCount: 6 }).success, false);
  // `comparables` may be a subset of the candidates the engine considered.
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], comparableCount: 6 }).success, true);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], comparableCount: 4 }).success, false);
});
test('valuation and match-score evidence stay internally consistent', () => {
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], comparableCount: 3 }).success, false);
  assert.equal(ValuationSchema.safeParse({ ...valuations[3], estimatedRentCad: 2000 }).success, false);
  assert.equal(ValuationSchema.safeParse({ ...valuations[0], differencePct: -15 }).success, false);
  const score = detailFixture.matchScore;
  assert.equal(MatchScoreSchema.safeParse({ ...score, total: score.total + 1 }).success, false);
  assert.equal(MatchScoreSchema.safeParse({ ...score, parts: score.parts.map(p => ({ ...p, effectiveWeight: 0 })) }).success, false);
  assert.equal(MatchScoreSchema.safeParse({ ...score, parts: Array(5).fill(score.parts[0]) }).success, false);
  assert.equal(SearchResultSchema.safeParse({ ...detailFixture, areas: undefined, indicators: undefined, duplicates: undefined }).success, false);
  const { areas: unusedAreas, indicators, duplicates, ...result } = detailFixture;
  void unusedAreas; void indicators; void duplicates;
  assert.equal(SearchResultSchema.safeParse({ ...result, valuation: { ...result.valuation, differenceCad: 100, differencePct: 4 } }).success, false);
});
test('structured choices and async envelopes distinguish ambiguity, pending and unavailable', () => {
  const resolved = travelIntent.travelTargets[0].resolved;
  assert.equal(DestinationResolutionSchema.safeParse({ status: 'ambiguous', query: 'campus', choices: [{ id: 'a', label: 'Campus A', resolved }, { id: 'b', label: 'Campus B', resolved }] }).success, true);
  assert.equal(DestinationResolutionSchema.safeParse({ status: 'ambiguous', query: 'campus', choices: [] }).success, false);
  const jobToken = 'x'.repeat(32);
  assert.equal(SearchResponseSchema.safeParse({ status: 'pending', jobToken, pollUrl: `/api/listings/search/jobs/${jobToken}`, expiresAt: '2026-10-16T12:02:00Z' }).success, true);
  assert.equal(SearchResponseSchema.safeParse({ status: 'pending', jobToken, pollUrl: `/api/listings/search/jobs/${'y'.repeat(32)}`, expiresAt: '2026-10-16T12:02:00Z' }).success, false);
  assert.equal(SearchResponseSchema.safeParse({ status: 'unavailable', reason: 'routing_incomplete', message: 'Exact travel percentile unavailable' }).success, true);
});
