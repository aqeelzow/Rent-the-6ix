import assert from 'node:assert/strict';
import { test } from 'vitest';
import { baseIntent, sampleListings, travelIntent } from '../fixtures/index';
import { filterListing } from './filters';
import { estimateTravelMinutes, evaluateTarget, targetDistanceM } from './travel';

test('distance estimates include detours and mode overhead, rounded up', () => {
  for (const [mode, oneKm, fiveKm] of [['walk', 16, 79], ['bike', 6, 26], ['drive', 7, 20], ['transit', 13, 32]] as const) {
    assert.equal(estimateTravelMinutes(0, mode), 0);
    assert.equal(estimateTravelMinutes(1000, mode), oneKm);
    assert.equal(estimateTravelMinutes(5000, mode), fiveKm);
    for (const metres of [-1, NaN, Infinity]) assert.throws(() => estimateTravelMinutes(metres, mode), RangeError);
  }
});

test('resolved coordinates supply estimates without routing rows or unconfirmed travel notes', () => {
  const listing = sampleListings[1];
  const target = { ...travelIntent.travelTargets[0], resolved: { ...listing.location, source: 'known_place' as const }, hard: true };
  assert.equal(targetDistanceM(target, [], listing.location), 0);
  assert.equal(evaluateTarget(target, [], listing.location).state, 'pass');
  assert.deepEqual(filterListing(listing, { ...baseIntent, travelTargets: [target] }, {}, true), { passes: true, notes: [] });
});

test('time limits use the same rounded estimates and unresolved places remain explicit', () => {
  const listing = sampleListings[1];
  const target = { ...travelIntent.travelTargets[0], resolved: undefined, alternativeModes: undefined, mode: 'walk' as const, maxMinutes: 16, hard: true };
  const row = { listingId: listing.id, targetId: target.id, mode: 'walk' as const, distanceM: 1000, method: 'straight_line' as const, minutes: null, poiId: null, computedAt: listing.lastSeenAt };
  assert.equal(evaluateTarget(target, [row]).state, 'pass');
  assert.equal(evaluateTarget(target, [{ ...row, distanceM: 1025 }]).state, 'fail');
  const unresolved = filterListing(listing, { ...baseIntent, travelTargets: [target] });
  assert.deepEqual(unresolved.notes, [`Location for ${target.label}: unavailable`]);
  assert.equal(filterListing(listing, { ...baseIntent, travelTargets: [target] }, {}, true).passes, false);
});
