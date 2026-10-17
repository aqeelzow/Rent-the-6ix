import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, valuations, travelIntent, safetySearchFixture } from '../fixtures/index';
import { MatchScoreSchema, SearchIntentSchema, type Listing, type TravelTimeRow } from '../schemas/index';
import { homeFit, roomsScore, sizeScore, unitTypeMatch } from './home-fit';
import { filterListing } from './filters';
import { scoreListing } from './score';
import { defaultMinutes, evaluateTarget, travelScore } from './travel';
const listing = sampleListings[1];
const intent = (criteria: object) => SearchIntentSchema.parse({ ...baseIntent, criteria });
const context = { valuation: valuations[3], travel: [], safety: null };
const row = (mode: TravelTimeRow['mode'], minutes: number | null, targetId = 'campus'): TravelTimeRow => ({ listingId: listing.id, targetId, mode, minutes, method: minutes === null ? 'straight_line' : 'otp', distanceM: 1000, computedAt: listing.lastSeenAt, poiId: null });
test('home formulas and omitted unknown preferences', () => {
  assert.equal(roomsScore(1, { min: 2 }), 50); assert.equal(roomsScore(.5, { min: 2 }), 0);
  assert.equal(sizeScore(750, { min: 1000 }), 0); assert.equal(sizeScore(1125, { max: 1000 }), 50);
  const i = intent({ buildingAge: { value: { builtAfter: 1980 }, hard: false }, availableBy: { value: '2026-11-01', hard: false } });
  assert.equal(homeFit({ ...listing, yearBuilt: 1970, availableFrom: '2026-11-16' }, i), 50);
  assert.equal(homeFit({ ...listing, yearBuilt: null, availableFrom: null }, i), null);
  assert.equal(homeFit({ ...listing, airConditioning: 'yes' }, intent({ airConditioning: { value: 'central', hard: false } })), 60);
  assert.equal(homeFit({ ...listing, petsAllowed: 'cats_only' }, intent({ petsAllowed: { value: 'any', hard: false } })), 100);
});
test('hard unknown passes with note; hide removes; soft unknown is omitted', () => {
  const i = intent({ bedrooms: { value: { min: 2 }, hard: true } });
  assert.deepEqual(filterListing({ ...listing, bedrooms: null }, i), { passes: true, notes: ['bedrooms: not confirmed'] });
  assert.equal(filterListing({ ...listing, bedrooms: null }, i, {}, true).passes, false);
  assert.equal(filterListing({ ...listing, bedrooms: 1 }, i).passes, false);
  const fair = intent({ priceFairness: { value: ['underpriced'], hard: true } });
  assert.equal(filterListing(listing, fair, context).passes, true);
  assert.equal(filterListing(listing, fair, { valuation: valuations[2] }).passes, false);
  assert.equal(homeFit({ ...listing, bedrooms: null }, intent({ bedrooms: { value: { min: 2 }, hard: false } })), null);
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
