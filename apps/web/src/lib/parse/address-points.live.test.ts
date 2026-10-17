import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { addressPointsLookup, addressPointsStatement } from './address-points';
import { DestinationResolver } from './resolve';
import { normalizeAddress } from '../../../../worker/src/civic/lib/address';

// Opt in: RUN_LIVE_ADDRESS_POINTS=1 pnpm --filter web exec vitest run src/lib/parse/address-points.live.test.ts
// Uses ignored web .env.local and read-only SQL; no provider calls or civic data writes.
test.skipIf(process.env.RUN_LIVE_ADDRESS_POINTS !== '1')('live normalized Address Points resolves before geocoding using the owner index', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const query = 'Unit 4 - 100 Queen Street West';
    const lookup = addressPointsLookup(() => ({ unsafe: async (statement, parameters) => await sql.unsafe(statement, parameters) }));
    let geocodes = 0;
    const resolver = new DestinationResolver({ addressLookup: lookup, maptilerKey: 'unused', fetch: async () => { geocodes++; throw Error('unexpected geocoder call'); } });
    const resolution = await resolver.resolve(query);
    assert.ok(resolution.status === 'resolved' || resolution.status === 'ambiguous', 'public civic address must match');
    const choices = resolution.status === 'resolved' ? [resolution.destination] : resolution.choices;
    assert.ok(choices.length > 0);
    for (const choice of choices) {
      assert.equal(normalizeAddress(choice.label), normalizeAddress(query));
      assert.equal(choice.resolved.source, 'address_points');
    }
    assert.equal(geocodes, 0);
    const [explain] = await sql.unsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${addressPointsStatement}`, [normalizeAddress(query)]);
    const plan = explain['QUERY PLAN'][0];
    assert.match(JSON.stringify(plan.Plan), /address_points_trgm_idx/);
    assert.doesNotMatch(JSON.stringify(plan.Plan), /Seq Scan/);
    console.info(JSON.stringify({ feature: 'P1.23 Address Points', database: 'live', source: 'address_points', matches: choices.length, geocodes, index: 'address_points_trgm_idx', executionMs: plan['Execution Time'] }));
  } finally { await sql.end({ timeout: 2 }); }
}, 15000);

test.skipIf(process.env.RUN_LIVE_MAPTILER !== '1')('live MapTiler fallback returns only full query matches', async () => {
  if (!process.env.NEXT_PUBLIC_MAPTILER_KEY) process.loadEnvFile('.env.local');
  assert.ok(process.env.NEXT_PUBLIC_MAPTILER_KEY);
  const resolver = new DestinationResolver({ addressLookup: async () => undefined, maptilerKey: process.env.NEXT_PUBLIC_MAPTILER_KEY });
  const known = await resolver.resolve('Union Station');
  assert.equal(known.status, 'resolved');
  if (known.status === 'resolved') assert.equal(known.destination.resolved.source, 'known_place');
  const result = await resolver.resolve('100 Queen Street West Toronto');
  assert.ok(result.status === 'resolved' || result.status === 'ambiguous');
  const choices = result.status === 'resolved' ? [result.destination] : result.choices;
  assert.ok(choices.length > 0);
  assert.ok(choices.every(choice => choice.resolved.source === 'maptiler'));
}, 10000);
