import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, travelIntent } from '../../../../../packages/shared/fixtures/index';
import type { Listing, SearchRequest } from '../../../../../packages/shared/schemas/index';
import type { getClient as ClientFactory } from '../db';
import { getClient } from '../db';
import { clearValuationCache } from './valuation';
import { sqlSearchDependencies } from './candidates-context';
import { searchPercentileCandidates } from './candidates-percentiles';
import { SearchUnavailable } from './candidates';
import { createRuntime } from '../api/runtime';
vi.mock('../db', () => ({ getClient: vi.fn(() => null) }));
const listing: Listing = { ...sampleListings[0], monthlyRentCad: 2000, bedrooms: 1, bathrooms: 1, sqft: null, unitType: 'apartment', buildingId: null, neighbourhoodId: null, wardId: null, addressPointId: null, utilitiesIncluded: 'unknown', parking: 'unknown', furnished: 'unknown', laundryInSuite: 'unknown', dataStatus: 'live' };
const rowFor = (value: Listing) => ({ ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'location').map(([key, val]) => [key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), val])), lng: value.location.lng, lat: value.location.lat });
const five = () => [2400, 2450, 2500, 2550, 2600].map((rent, i) => ({ ...rowFor(listing), id: sampleListings[i + 1].id, monthly_rent_cad: rent, distance_m: 100 + i, last_seen_at: new Date(), duplicate_of: null, building_key: `building-${i}` }));
type Sql = NonNullable<ReturnType<typeof ClientFactory>>;
function client(options: { candidates?: unknown[]; observations?: unknown[]; comparables?: unknown[]; query?: () => Promise<unknown[]> } = {}) {
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (!text.includes('SELECT')) return { fragment: text };
    if (options.query) return options.query();
    if (text.includes('FROM listings c')) return Promise.resolve(options.comparables ?? five());
    if (text.includes('listing_observations')) return Promise.resolve(options.observations ?? [{ deposit: true, asking_rent_cad: 2200, observed_at: new Date('2026-10-01') }]);
    throw new Error('Unexpected SQL');
  });
  const unsafe = vi.fn((text: string, parameters?: unknown[]) => parameters ? Promise.resolve(options.candidates ?? [rowFor(listing)]) : text);
  Object.assign(sql, { unsafe });
  return { sql: sql as unknown as Sql, tagged: sql, unsafe };
}
const input: SearchRequest = { intent: baseIntent, hideUnconfirmed: false };
const http = (body: SearchRequest) => new Request('http://localhost/api/listings/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
afterEach(() => { clearValuationCache(); vi.mocked(getClient).mockReset(); vi.mocked(getClient).mockReturnValue(null); });
test('default SQL runtime consumes actual C context, cached valuation and stored caveats with nullable civic IDs', async () => {
  const db = client(); vi.mocked(getClient).mockReturnValue(db.sql);
  const api = createRuntime({ env: { DATABASE_URL: 'configured' } });
  const request = { ...input, intent: { ...baseIntent, criteria: { priceFairness: { hard: true, value: ['underpriced' as const] } } } };
  const response = await api.search(http(request), undefined);
  assert.equal(response.status, 200);
  const result = (await response.json()).results[0];
  assert.equal(result.listing.neighbourhoodId, null); assert.equal(result.listing.dataStatus, 'live');
  assert.equal(result.valuation.status, 'ok'); assert.equal(result.valuation.estimatedRentCad, 2500); assert.equal(result.valuation.effectiveCount, 5); assert.equal(result.valuation.comparableCount, 5); assert.equal(result.valuation.benchmark, null);
  assert.ok(result.matchScore.caveats.some((c: { code: string }) => c.code === 'deposit_before_viewing'));
  assert.ok(result.matchScore.caveats.some((c: { code: string }) => c.code === 'price_dropped'));
  assert.equal(result.safety, null);
  const rejected = await api.search(http({ ...request, intent: { ...request.intent, criteria: { priceFairness: { hard: true, value: ['overpriced'] } } } }), undefined);
  assert.equal((await rejected.json()).results.length, 0);
  assert.equal(db.tagged.mock.calls.filter(([s]) => s.join('?').includes('FROM listings c')).length, 1);
  const detail = await api.detail(new Request(`http://localhost/api/listings/${listing.id}?intent=${encodeURIComponent(JSON.stringify(baseIntent))}`), { params: Promise.resolve({ id: listing.id }) });
  assert.equal(detail.status, 503);
});
test('default config gate retains missing-config 503 and fixture opt-in wins over SQL', async () => {
  const unavailable = await createRuntime({ env: {} }).search(http(input), undefined); assert.equal(unavailable.status, 503); assert.equal(vi.mocked(getClient).mock.calls.length, 0);
  const fixture = await createRuntime({ env: { SEARCH_FIXTURES: '1', DATABASE_URL: 'configured' } }).search(http(input), undefined);
  assert.equal(fixture.status, 200); assert.equal(vi.mocked(getClient).mock.calls.length, 0);
  const broken = await createRuntime({ env: { DATABASE_URL: 'configured' } }).search(http(input), undefined); assert.equal(broken.status, 503);
  vi.mocked(getClient).mockImplementation(() => { throw new Error('private invalid connection URL'); });
  const invalid = createRuntime({ env: { DATABASE_URL: 'invalid' } });
  const failed = await invalid.search(http(input), undefined); assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(await failed.json()), /private/);
  const resolved = await invalid.resolve(new Request('http://localhost/api/geo/resolve?q=Union%20Station'), undefined); assert.equal(resolved.status, 200);
});
test('SQL context failures and malformed owner results return private 503 responses', async () => {
  for (const db of [client({ candidates: [{}] }), client({ query: async () => { throw new Error('secret database message'); } }), client({ comparables: five().map(row => ({ ...row, monthly_rent_cad: NaN })) })]) {
    clearValuationCache();
    const api = createRuntime({ dependencies: sqlSearchDependencies(() => db.sql), env: {} });
    const response = await api.search(http(input), undefined); assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(await response.json()), /secret/);
  }
});
test('missing routing/safety remain unknown and hide-unconfirmed excludes hard travel failures', async () => {
  const db = client(), dependencies = sqlSearchDependencies(() => db.sql), api = createRuntime({ dependencies, env: {} });
  const intent = { ...travelIntent, safety: { enabled: true, hard: false }, travelTargets: travelIntent.travelTargets.map(t => ({ ...t, hard: true })) };
  const response = await api.search(http({ ...input, intent }), undefined), result = (await response.json()).results[0];
  assert.equal(result.safety, null); assert.ok(result.travel.length); assert.ok(result.travel.every((r: { method: string; minutes: number | null }) => r.method === 'straight_line' && r.minutes === null));
  assert.equal(result.matchScore.parts.find((p: { id: string }) => p.id === 'safety').score, null);
  const hidden = await api.search(http({ intent, hideUnconfirmed: true }), undefined); assert.equal((await hidden.json()).results.length, 0);
  const exact = await searchPercentileCandidates({ ...input, intent: { ...travelIntent, numericExtreme: { field: 'travel', direction: 'min', percentage: 5, minimumCount: 10, targetId: travelIntent.travelTargets[0].id } } }, dependencies, { referenceYear: 2026 });
  assert.equal(exact.status, 'unavailable'); if (exact.status === 'unavailable') assert.equal(exact.reason, 'routing_incomplete');
});
test('exact deadline aborts enrichment and bounds uncooperative C queries across runtimes', async () => {
  let finish: (rows: unknown[]) => void = () => {};
  let queries = 0;
  const db = client({ query: () => { queries++; return queries === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]); } });
  const dependencies = sqlSearchDependencies(() => db.sql);
  const exact: SearchRequest = { ...input, intent: { ...travelIntent, numericExtreme: { field: 'travel', direction: 'min', percentage: 5, minimumCount: 10, targetId: travelIntent.travelTargets[0].id } } };
  const result = await searchPercentileCandidates(exact, dependencies, { referenceYear: 2026, deadline: Date.now() + 25 });
  assert.equal(result.status, 'unavailable'); if (result.status === 'unavailable') assert.equal(result.reason, 'timeout');
  assert.equal(queries, 1);
  const retry = sqlSearchDependencies(() => db.sql);
  await assert.rejects(retry.enrich(listing, baseIntent), SearchUnavailable); assert.equal(queries, 1);
  finish(five());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(queries, 2);
  const context = await retry.enrich(listing, baseIntent); assert.equal(context.valuation.status, 'ok'); assert.equal(queries, 3);
});
