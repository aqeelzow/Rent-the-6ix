import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { baseIntent, sampleListings, travelIntent, valuations } from '../../../../../packages/shared/fixtures';
import type { Listing, TravelTarget, TravelTimeRow } from '../../../../../packages/shared/schemas';
import type { ScoreContext } from '../../../../../packages/shared/engine/score';
import { createRouteTimes } from '../geo/route-times';
import { candidateColumns, listingFromRow } from './candidates-sql';
import { routeCandidateContexts, searchCandidates, type SearchDependencies } from './candidates';
import { searchPercentileCandidates } from './candidates-percentiles';

const context = (): ScoreContext => ({ valuation: valuations[3], safety: null, travel: [] });
test('ordinary routing retains a completed mode when another hangs and ignores its late response', async () => {
  const listing = sampleListings[0], target = travelIntent.travelTargets[0];
  const contexts = new Map([[listing.id, context()]]);
  let finishLate!: (rows: TravelTimeRow[]) => void;
  const late = new Promise<TravelTimeRow[]>(resolve => { finishLate = resolve; });
  const row: TravelTimeRow = { listingId: listing.id, targetId: target.id, mode: 'bike', minutes: 5, distanceM: 100, method: 'otp', computedAt: listing.lastSeenAt, poiId: null };
  const signals: AbortSignal[] = [];
  const dependencies: SearchDependencies = { listings: [listing], enrich: async () => context(), routingBudgetMs: 20, routeTimes: async (_origins, _targets, mode, _budget, signal) => {
    signals.push(signal);
    return mode === 'bike' ? [row] : late;
  } };
  await routeCandidateContexts(dependencies, [listing], [target], contexts);
  assert.deepEqual(contexts.get(listing.id)!.travel, [row]);
  assert.ok(signals.every(signal => signal.aborted));
  finishLate([{ ...row, mode: 'walk', minutes: 1 }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(contexts.get(listing.id)!.travel, [row]);
});

// Opt in: RUN_LIVE_PARTIAL_ROUTING=1 pnpm --filter web exec vitest run src/lib/db/candidates-routing.test.ts
// Actual read-only listings + published D adapter, controlled routing answers; this is not live OTP acceptance.
test.skipIf(process.env.RUN_LIVE_PARTIAL_ROUTING !== '1')('real listings retain partial D routes, OR modes/AND destinations and honest exact-percentile unavailability', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const rows = await sql.unsafe(`SELECT ${candidateColumns} FROM listings WHERE status = 'active' AND duplicate_of IS NULL ORDER BY id LIMIT 100`);
    const listings: Listing[] = [];
    for (const row of rows) {
      const listing = listingFromRow(row);
      if (!listings.some(previous => Math.abs(previous.location.lat - listing.location.lat) < .002 && Math.abs(previous.location.lng - listing.location.lng) < .002)) listings.push(listing);
      if (listings.length === 3) break;
    }
    assert.equal(listings.length, 3, 'three distinct real origin cells required');
    const campus: TravelTarget = { ...travelIntent.travelTargets[0], id: 'partial-campus', alternativeModes: ['transit'], mode: 'bike', maxMinutes: 10, hard: true, resolved: { lat: 43.6629, lng: -79.3957, source: 'known_place' } };
    const work: TravelTarget = { ...campus, id: 'partial-work', alternativeModes: undefined, label: 'Controlled work destination', resolved: { lat: 43.65, lng: -79.38, source: 'known_place' } };
    const intent = { ...baseIntent, travelTargets: [campus, work] };
    const routedModes = new Set<string>();
    const makeDependencies = (): SearchDependencies => ({ listings, enrich: async () => context(), routingBudgetMs: 400, routeTimes: createRouteTimes({ route: async (from, to, mode) => {
      routedModes.add(mode);
      const index = listings.findIndex(listing => listing.location.lat === from.lat && listing.location.lng === from.lng);
      if (mode === 'transit' || index === 2) return new Promise<never>(() => {});
      return { minutes: index === 1 && to.lat === work.resolved!.lat ? 25 : 5, distanceM: 1000 };
    } }) });
    for (const hideUnconfirmed of [false, true]) {
      routedModes.clear();
      const started = performance.now();
      const response = await searchCandidates({ intent, hideUnconfirmed }, makeDependencies());
      assert.deepEqual(routedModes, new Set(['bike', 'transit']));
      assert.ok(performance.now() - started < 1200, 'uncooperative pairs must not hold search open');
      assert.deepEqual(new Set(response.results.map(result => result.listing.id)), new Set(hideUnconfirmed ? [listings[0].id] : [listings[0].id, listings[2].id]));
      const confirmed = response.results.find(result => result.listing.id === listings[0].id)!;
      assert.equal(confirmed.travel.filter(row => row.method === 'otp').length, 2);
      assert.equal(confirmed.travel.filter(row => row.method === 'straight_line' && row.minutes === null).length, 1);
      assert.deepEqual(confirmed.matchScore.hardFilterNotes, []);
      assert.ok(confirmed.matchScore.parts.find(part => part.id === 'travel')!.score! > 0);
      for (const result of response.results) assert.equal(result.matchScore.total, Math.round(result.matchScore.parts.reduce((sum, part) => sum + (part.score ?? 0) * part.effectiveWeight, 0)));
      if (!hideUnconfirmed) {
        const unknown = response.results.find(result => result.listing.id === listings[2].id)!;
        assert.equal(unknown.matchScore.hardFilterNotes.length, 2);
        assert.ok(unknown.travel.every(row => row.method === 'straight_line' && row.minutes === null));
      }
    }
    const exact = await searchPercentileCandidates({ intent: { ...intent, numericExtreme: { field: 'travel', targetId: campus.id, direction: 'min', percentage: 5, minimumCount: 1 } }, hideUnconfirmed: false }, makeDependencies(), { deadline: Date.now() + 700, referenceYear: 2026 });
    assert.equal(exact.status, 'unavailable');
    assert.ok(!('results' in exact), 'partial route coverage must never become an exact percentile');
    process.stdout.write(JSON.stringify({ database: 'live read-only', listings: listings.length, router: 'controlled via published D adapter', partialOrdinary: 'passed', exactPartial: 'unavailable' }) + '\n');
  } finally { await sql.end({ timeout: 2 }); }
}, 15000);
