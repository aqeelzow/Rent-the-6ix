import { test } from 'vitest';
import assert from 'node:assert/strict';
import { areas, baseIntent, sampleListings } from '../../../../../packages/shared/fixtures/index';
import { sqlDetailLoader } from './candidates-detail';
import { SearchUnavailable } from './candidates';
import { createRuntime, fixtureDependencies } from '../api/runtime';
const listing = { ...sampleListings[0], buildingId: '42', neighbourhoodId: 'n', dataStatus: 'live' as const };
const row = (value: typeof listing) => ({ ...Object.fromEntries(Object.entries(value).map(([key, val]) => [key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), val])), lng: value.location.lng, lat: value.location.lat });
test('static detail maps authoritative rows, nullable fields and bound IDs', async () => {
  const calls: { statement: string; parameters: unknown[] }[] = [];
  const load = sqlDetailLoader(() => ({ unsafe: async (statement, parameters) => {
    calls.push({ statement, parameters });
    if (statement.includes('FROM neighbourhoods')) return [{ id: 'n', kind: 'neighbourhood', name: 'Neighbourhood', number: null, geometry: areas[0].geometry }];
    if (statement.includes('FROM area_indicators')) return [{ area_id: 'n', indicator_id: 'listing_count_30d', value: 8, unit: 'listings', period: '2026', source_id: 'source', sample_size: null, note: null }];
    return [row({ ...listing, id: sampleListings[1].id, duplicateOf: listing.id })];
  } }));
  const detail = await load(listing, baseIntent);
  assert.equal(detail.areas.length, 1); assert.equal(detail.areas[0].number, undefined);
  assert.equal(detail.indicators[0].sourceId, 'source'); assert.equal(detail.indicators[0].sampleSize, undefined);
  assert.equal(detail.duplicates[0].duplicateOf, listing.id);
  assert.deepEqual(calls.map(c => c.parameters), [['n'], ['n', false], [listing.id]]);
  assert.match(calls[1].statement, /source_id IS NOT NULL/); assert.match(calls[1].statement, /crime\[:_\]/);
  calls.length = 0; await load(listing, { ...baseIntent, safety: { ...baseIntent.safety, enabled: true } }); assert.equal(calls[1].parameters[1], true);
});
test('missing civic associations stay empty/null; malformed rows and SQL failures are sanitized', async () => {
  assert.deepEqual(await sqlDetailLoader(() => ({ unsafe: async () => [] }))(listing, baseIntent), { areas: [], indicators: [], duplicates: [] });
  for (const client of [() => null, () => ({ unsafe: async () => { throw Error('secret'); } }), () => ({ unsafe: async () => [{}] })]) {
    await assert.rejects(sqlDetailLoader(client)(listing, baseIntent), error => error instanceof SearchUnavailable && !error.message.includes('secret'));
  }
});
test('detail API consumes optional static extras and reports adapter errors as 503', async () => {
  for (const fails of [false, true]) {
    const api = createRuntime({ env: {}, dependencies: { ...fixtureDependencies, loadListing: async () => listing, loadDetail: sqlDetailLoader(() => ({ unsafe: async () => { if (fails) throw Error('private'); return []; } })) } });
    const response = await api.detail(new Request(`http://localhost/api/listings/${listing.id}?intent=${encodeURIComponent(JSON.stringify(baseIntent))}`), { params: Promise.resolve({ id: listing.id }) });
    assert.equal(response.status, fails ? 503 : 200);
    const body = await response.json();
    if (fails) assert.doesNotMatch(JSON.stringify(body), /private/);
    else { assert.deepEqual(body.areas, []); assert.deepEqual(body.duplicates, []); }
  }
});
