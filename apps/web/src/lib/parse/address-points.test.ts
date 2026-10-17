import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { addressPointsLookup, addressPointsStatement } from './address-points';
import { DestinationResolver } from './resolve';
import { createRuntime } from '../api/runtime';
import { getClient } from '../db';
import { normalizeAddress } from '../../../../worker/src/civic/lib/address';
vi.mock('../db', () => ({ getClient: vi.fn(() => null) }));
const sample = [
  { id: 'city-1', address_full: '100 Queen St W', lng: -79.384, lat: 43.653 },
  { id: 'city-2', address_full: '200 King St W', lng: -79.388, lat: 43.647 },
];
const signal = () => new AbortController().signal;
test('small Address Points sample uses bound exact-address SQL and validates all row output', async () => {
  let bound: string[] = [];
  const lookup = addressPointsLookup(() => ({ unsafe: async (statement, parameters) => {
    assert.equal(statement, addressPointsStatement); assert.match(statement, /ST_X\(location::geometry\)/); assert.match(statement, /LIMIT 21/); assert.match(statement, /WHERE address_norm = \$1/); assert.doesNotMatch(statement, /regexp_replace/);
    bound = parameters;
    return sample.filter(row => normalizeAddress(row.address_full) === parameters[0]);
  } }));
  const result = await lookup(' Unit 4 - 100  QUEEN Street West ', signal());
  assert.equal(result?.status, 'resolved');
  if (result?.status === 'resolved') { assert.equal(result.destination.id, 'city-1'); assert.equal(result.destination.resolved.source, 'address_points'); }
  assert.deepEqual(bound, ['100 QUEEN ST W']);
  assert.equal(await lookup("100 Queen St W'; SELECT 1 --", signal()), undefined);
  assert.deepEqual(bound, ["100 QUEEN ST W SELECT 1"]);
  for (const rows of [[], [{ ...sample[0], lat: 91 }], [{ ...sample[0], id: '' }], [{ ...sample[0], lng: '-79' }], [sample[1]], [sample[0], sample[0]], Array.from({ length: 21 }, (_, i) => ({ ...sample[0], id: String(i) }))]) {
    assert.equal(await addressPointsLookup(() => ({ unsafe: async () => rows }))('100 Queen St W', signal()), undefined);
  }
  const ambiguous = await addressPointsLookup(() => ({ unsafe: async () => [sample[0], { ...sample[0], id: 'city-3' }] }))('100 Queen St W', signal());
  assert.equal(ambiguous?.status, 'ambiguous');
  if (ambiguous?.status === 'ambiguous') assert.equal(ambiguous.choices.length, 2);
});
test('absent/failed client falls through; cancellation ignores late reads and bounds concurrent work', async () => {
  assert.equal(await addressPointsLookup(() => null)('x', signal()), undefined);
  assert.equal(await addressPointsLookup(() => { throw Error('private connection'); })('x', signal()), undefined);
  assert.equal(await addressPointsLookup(() => ({ unsafe: async () => { throw Error('private database'); } }))('x', signal()), undefined);
  let reads = 0, rejectLate!: (error: Error) => void;
  const lookup = addressPointsLookup(() => ({ unsafe: () => { reads++; return new Promise((_resolve, reject) => { rejectLate = reject; }); } }));
  const controller = new AbortController(); controller.abort();
  assert.equal(await lookup('x', controller.signal), undefined); assert.equal(reads, 0);
  const pending = new AbortController(); const result = lookup('x', pending.signal); pending.abort();
  assert.equal(await result, undefined);
  assert.equal(await lookup('x', signal()), undefined); assert.equal(reads, 1);
  rejectLate(Error('late failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await addressPointsLookup(() => ({ unsafe: async () => [] }))('x', signal()), undefined);
});
test('resolver preserves known places, fallback and total deadline without late geocoder calls', async () => {
  const fallback = vi.fn(async () => Response.json({ features: [{ id: 'm1', place_name: 'Address', relevance: 1, center: [-79.38, 43.65] }] }));
  const resolver = new DestinationResolver({ addressLookup: addressPointsLookup(() => ({ unsafe: async () => [] })), maptilerKey: 'test', fetch: fallback });
  assert.equal((await resolver.resolve('Union Station')).status, 'resolved'); assert.equal(fallback.mock.calls.length, 0);
  assert.equal((await resolver.resolve('unknown exact address')).status, 'resolved'); assert.equal(fallback.mock.calls.length, 1);
  let finish!: (rows: unknown) => void;
  const slow = new DestinationResolver({ timeoutMs: 5, addressLookup: addressPointsLookup(() => ({ unsafe: () => new Promise(resolve => { finish = resolve; }) })), maptilerKey: 'test', fetch: fallback });
  assert.equal((await slow.resolve('another address')).status, 'unavailable');
  finish([sample[0]]); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fallback.mock.calls.length, 1);
});
test('runtime enables existing database client only when configured outside fixture mode', async () => {
  const mock = vi.mocked(getClient); mock.mockClear();
  for (const env of [{}, { SEARCH_FIXTURES: '1', DATABASE_URL: 'configured' }]) {
    await createRuntime({ env }).resolve(new Request('http://localhost/api/geo/resolve?q=100%20Queen%20St%20W'), undefined);
    assert.equal(mock.mock.calls.length, 0);
  }
  await createRuntime({ env: { DATABASE_URL: 'configured' } }).resolve(new Request('http://localhost/api/geo/resolve?q=100%20Queen%20St%20W'), undefined);
  // Both database lookups run (address points, then neighbourhood/ward names), so the configured
  // client is opened rather than the exact call count being fixed.
  assert.ok(mock.mock.calls.length >= 1, 'the configured client is used');
});
