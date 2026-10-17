import { test } from 'vitest';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, valuations, travelIntent, safetySearchFixture } from '../fixtures/index';
import { ListingSchema, MatchScoreSchema, SearchIntentSchema, type SearchIntent, type Listing, type TravelTimeRow } from '../schemas/index';
import { homeFit, roomsScore, sizeScore, unitTypeMatch } from './home-fit';
import { filterListing } from './filters';
import { bestMatchOrder, confirmedFieldCount, scoreListing, tieBreak, valueScore } from './score';
import { defaultMinutes, evaluateTarget, travelScore } from './travel';
const listing = sampleListings[1];
const intent = (criteria: object) => SearchIntentSchema.parse({ ...baseIntent, criteria });
const context = { valuation: valuations[3], travel: [], safety: null };
const row = (mode: TravelTimeRow['mode'], minutes: number | null, targetId = 'campus'): TravelTimeRow => ({ listingId: listing.id, targetId, mode, minutes, method: minutes === null ? 'straight_line' : 'otp', distanceM: 1000, computedAt: listing.lastSeenAt, poiId: null });
test('home formulas; unknown preferences score 50, between a match and a miss', () => {
  assert.equal(roomsScore(1, { min: 2 }), 50); assert.equal(roomsScore(.5, { min: 2 }), 0);
  assert.equal(sizeScore(750, { min: 1000 }), 0); assert.equal(sizeScore(1125, { max: 1000 }), 50);
  const i = intent({ buildingAge: { value: { builtAfter: 1980 }, hard: false }, availableBy: { value: '2026-11-01', hard: false } });
  assert.equal(homeFit({ ...listing, yearBuilt: 1970, availableFrom: '2026-11-16' }, i), 50);
  assert.equal(homeFit({ ...listing, yearBuilt: null, availableFrom: null }, i), 50);
  assert.equal(homeFit({ ...listing, airConditioning: 'yes' }, intent({ airConditioning: { value: 'central', hard: false } })), 60);
  assert.equal(homeFit({ ...listing, petsAllowed: 'cats_only' }, intent({ petsAllowed: { value: 'any', hard: false } })), 100);
  const ac = intent({ airConditioning: { value: 'any', hard: false } });
  assert.equal(homeFit({ ...listing, airConditioning: 'central' }, ac), 100);
  assert.equal(homeFit({ ...listing, airConditioning: 'unknown' }, ac), 50);
  assert.equal(homeFit({ ...listing, airConditioning: 'no' }, ac), 0);
});
test('hard unknown passes with note; hide removes; soft unknown scores 50', () => {
  const i = intent({ bedrooms: { value: { min: 2 }, hard: true } });
  assert.deepEqual(filterListing({ ...listing, bedrooms: null }, i), { passes: true, notes: ['bedrooms: not confirmed'] });
  assert.equal(filterListing({ ...listing, bedrooms: null }, i, {}, true).passes, false);
  assert.equal(filterListing({ ...listing, bedrooms: 1 }, i).passes, false);
  const fair = intent({ priceFairness: { value: ['underpriced'], hard: true } });
  assert.equal(filterListing(listing, fair, context).passes, true);
  assert.equal(filterListing(listing, fair, { valuation: valuations[2] }).passes, false);
  assert.equal(homeFit({ ...listing, bedrooms: null }, intent({ bedrooms: { value: { min: 2 }, hard: false } })), 50);
  const ac = intent({ airConditioning: { value: 'any', hard: true }, laundryInSuite: { value: true, hard: false } });
  assert.deepEqual(filterListing({ ...listing, airConditioning: 'unknown', laundryInSuite: 'unknown' }, ac), { passes: true, notes: ['airConditioning: not confirmed'] });
  assert.equal(filterListing({ ...listing, airConditioning: 'no' }, ac).passes, false);
  assert.equal(homeFit({ ...listing, laundryInSuite: 'unknown' }, ac), 50);
});
test('studio virtual choice, rooms excluded unless explicitly requested', () => {
  const studio: Listing = { ...listing, bedrooms: 0, unitType: 'apartment' };
  assert.equal(unitTypeMatch(studio, ['studio']), true);
  assert.equal(unitTypeMatch({ ...studio, rentIsPerRoom: true, unitType: null }, ['room', 'studio']), true);
  assert.equal(unitTypeMatch({ ...studio, unitType: null }, ['room', 'studio']), null);
  const room = { ...listing, bedrooms: 2, unitType: 'room' as const, rentIsPerRoom: true };
  assert.equal(filterListing(room, intent({ bedrooms: { value: { min: 2 }, hard: true } })).passes, false);
  assert.equal(filterListing(room, intent({ bedrooms: { value: { min: 2 }, hard: true }, unitTypes: { value: ['room', 'studio'], hard: true } })).passes, true);
});
test('alternative modes OR, destinations AND, unknown fallback never confirms minutes', () => {
  const target = travelIntent.travelTargets[0];
  assert.equal(evaluateTarget(target, [row('bike', 20), row('walk', 8)]).state, 'pass');
  assert.equal(evaluateTarget(target, [row('bike', 20), row('walk', 30)]).state, 'fail');
  assert.equal(evaluateTarget(target, [row('bike', 20), row('walk', null)]).state, 'unknown');
  assert.equal(travelScore([target], [row('bike', 15), row('walk', 10)]), 100);
  const i = { ...travelIntent, travelTargets: [target, { ...target, id: 'work', label: 'Work' }] };
  assert.equal(filterListing(listing, i, { travel: [row('walk', 8), row('bike', 20, 'work'), row('walk', 30, 'work')] }).passes, false);
  assert.equal(defaultMinutes({ ...target, maxMinutes: undefined }, 'walk'), 20);
  assert.equal(defaultMinutes({ ...target, kind: 'amenity', category: 'grocery' }, 'transit'), 15);
  assert.equal(evaluateTarget({ ...target, alternativeModes: undefined, maxMinutes: 40, mode: 'walk' }, [{ ...row('walk', null), distanceM: 1600 }]).score, 100);
});
test('five parts, exact value/price formulas, renormalization, safety off', () => {
  const i = intent({ rent: { value: { min: 2000, max: 2000 }, hard: false }, priceFairness: { value: ['underpriced'], hard: false } });
  const score = scoreListing({ ...listing, monthlyRentCad: 2150 }, i, { ...context, valuation: valuations[0] });
  assert.equal(score.parts.find(p => p.id === 'price')!.score, 50);
  assert.equal(score.parts.find(p => p.id === 'value')!.score, 87.5);
  assert.equal(score.parts.find(p => p.id === 'value')!.weight, 45);
  assert.ok(score.parts.find(p => p.id === 'price')!.evidence[0].includes('2150'));
  assert.ok(score.parts.find(p => p.id === 'value')!.evidence[0].includes('15% below'));
  MatchScoreSchema.parse(score);
  assert.equal(scoreListing(listing, baseIntent, context).total, 0);
  const safety = safetySearchFixture.status === 'completed' ? safetySearchFixture.results[0].safety : null;
  assert.equal(scoreListing(listing, baseIntent, { ...context, safety, safetyScore: 80 }).parts.find(p => p.id === 'safety')!.score, null);
  const enabled = scoreListing(listing, { ...baseIntent, safety: { enabled: true, hard: false } }, { ...context, safety, safetyScore: 80 });
  assert.equal(enabled.total, 80); assert.equal(enabled.parts[4].weight, 15); MatchScoreSchema.parse(enabled);
});

test('travel evidence labels distance and driving free flow', () => {
  const t = { ...travelIntent.travelTargets[0], mode: 'drive' as const, alternativeModes: undefined };
  const score = scoreListing(listing, { ...baseIntent, travelTargets: [t] }, { ...context, travel: [row('drive', null)] });
  const evidence = score.parts.find(p => p.id === 'travel')!.evidence.join(' ');
  assert.ok(evidence.includes('1000 m straight-line')); assert.ok(evidence.includes('driving, no traffic')); assert.ok(!evidence.includes('null minutes'));
});

test('missing civic IDs stay unconfirmed through geographic OR and hide gates', () => {
  const sparse = ListingSchema.parse({ ...listing, neighbourhoodId: null, wardId: null });
  assert.equal(sparse.neighbourhoodId, null); assert.equal(sparse.wardId, null);
  const areas: SearchIntent['areas'] = [{ kind: 'ward', id: 'known-ward' }];
  const current = { ...baseIntent, areas };
  assert.deepEqual(filterListing(sparse, current), { passes: true, notes: ['area: not confirmed'] });
  assert.equal(filterListing(sparse, current, {}, true).passes, false);
  assert.equal(filterListing({ ...sparse, wardId: 'different-ward' }, current).passes, false);
  const withNear = { ...current, areas: [...areas, { kind: 'near' as const, point: sparse.location, radiusM: 1 }] };
  assert.deepEqual(filterListing(sparse, withNear, {}, true), { passes: true, notes: [] });
  assert.deepEqual(filterListing(sparse, baseIntent, {}, true), { passes: true, notes: [] });
});

test('a rent far below the estimate scores 50 on value, so other parts cannot fill its share', () => {
  const home = { ...sampleListings[0], airConditioning: 'central' as const };
  const priced = (differencePct: number) => ({ ...valuations[0], status: 'ok' as const, differencePct });
  const deal = scoreListing(home, baseIntent, { ...context, valuation: priced(20) });
  const suspicious = scoreListing(home, intent({ airConditioning: { value: 'any', hard: false } }), { ...context, valuation: priced(55) });
  assert.equal(deal.parts.find(p => p.id === 'value')!.score, 100);
  assert.equal(valueScore(priced(55)), 50);
  assert.equal(suspicious.parts.find(p => p.id === 'value')!.score, 50);
  assert.match(suspicious.parts.find(p => p.id === 'value')!.evidence[0], /scored neutral/);
  assert.equal(suspicious.parts.find(p => p.id === 'home')!.score, 100);
  assert.ok(suspicious.total < 100);
  assert.equal(suspicious.parts.find(p => p.id === 'price')!.score, null);
});
test('best match ranks a confirmed must-have above an unconfirmed one, then confidence, fields, newest, rent', () => {
  const tie = { listing };
  assert.ok(bestMatchOrder({ total: 100, unconfirmed: 1, tie }, { total: 60, unconfirmed: 0, tie }) > 0);
  assert.ok(bestMatchOrder({ total: 80, unconfirmed: 0, tie }, { total: 70, unconfirmed: 0, tie }) < 0);
  const older = { ...listing, lastSeenAt: '2026-10-01T00:00:00Z', monthlyRentCad: 900 };
  const newer = { ...listing, lastSeenAt: '2026-10-16T00:00:00Z', monthlyRentCad: 2200 };
  assert.ok(tieBreak({ listing: older, confidence: 'high', valued: true }, { listing: newer, confidence: 'low', valued: true }) < 0);
  const sparse = { ...listing, bedrooms: null, bathrooms: null, sqft: null, yearBuilt: null, unitType: null, airConditioning: 'unknown' as const, petsAllowed: 'unknown' as const, furnished: 'unknown' as const, parking: 'unknown' as const, laundryInSuite: 'unknown' as const, utilitiesIncluded: 'unknown' as const, availableFrom: null, leaseTerm: null, monthlyRentCad: 400, lastSeenAt: '2026-10-20T00:00:00Z' };
  assert.ok(confirmedFieldCount(sparse) < confirmedFieldCount(listing));
  assert.ok(tieBreak({ listing, confidence: 'low', valued: true }, { listing: sparse, confidence: 'low', valued: true }) < 0);
  assert.ok(tieBreak({ listing: newer }, { listing: older }) < 0);
  assert.ok(tieBreak({ listing: { ...listing, monthlyRentCad: 800 } }, { listing: { ...listing, monthlyRentCad: 1800 } }) < 0);
  assert.equal(tieBreak({ listing }, { listing }), 0);
});
test('hard safety keeps neighbourhoods at or below the renter\'s limit, else the city rate', () => {
  const listing = sampleListings[1];
  const safe = (relativeRate: number) => ({ ...context, safety: { areaId: listing.neighbourhoodId!, rate: 1000 * relativeRate, relativeRate, byType: {}, years: [2025], caveats: [{ severity: 'info' as const, code: 'x', title: 'x', explanation: 'x' }] } });
  const hard = (maxRelativeRate?: number): SearchIntent => ({ ...baseIntent, safety: { enabled: true, hard: true, ...(maxRelativeRate === undefined ? {} : { maxRelativeRate }) } });
  assert.equal(filterListing(listing, hard(), safe(1)).passes, true);
  assert.equal(filterListing(listing, hard(), safe(1.1)).passes, false);
  assert.equal(filterListing(listing, hard(0.8), safe(0.8)).passes, true);
  assert.equal(filterListing(listing, hard(0.8), safe(0.9)).passes, false);
  assert.equal(filterListing(listing, hard(1.5), safe(1.4)).passes, true);
  assert.equal(SearchIntentSchema.safeParse(hard(0.8)).success, true);
  assert.equal(SearchIntentSchema.safeParse(hard(0)).success, false);
});
