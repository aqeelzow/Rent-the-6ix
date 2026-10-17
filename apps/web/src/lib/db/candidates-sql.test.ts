import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { baseIntent, sampleListings, valuations, travelIntent } from '../../../../../packages/shared/fixtures/index';
import type { Listing, SearchRequest } from '../../../../../packages/shared/schemas/index';
import { candidateQuery, listingFromRow, sqlCandidateLoader } from './candidates-sql';
import { SearchUnavailable } from './candidates';
import { createRuntime } from '../api/runtime';
import { getClient } from '../db';
vi.mock('../db', () => ({ getClient: vi.fn(() => null) }));
const rowFor = (listing: Listing): Record<string, unknown> => ({ ...Object.fromEntries(Object.entries(listing).filter(([key]) => key !== 'location').map(([key, value]) => [key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), value])), lng: listing.location.lng, lat: listing.location.lat });
const input: SearchRequest = { intent: baseIntent, hideUnconfirmed: false };
const enrich = async () => ({ valuation: valuations[3], travel: [], safety: null });
const http = (body: SearchRequest) => new Request('http://localhost/api/listings/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('D rows map numeric/date/null fields and reject malformed data without fabricating geography', () => {
  const row = { ...rowFor(sampleListings[0]), bathrooms: '1.5', monthly_rent_cad: '1500', lng: '-79.4', lat: '43.7', available_from: new Date('2026-10-17T00:00:00Z'), first_seen_at: new Date(sampleListings[0].firstSeenAt), excerpt: null, parking: null, neighbourhood_id: null, ward_id: null };
  const mapped = listingFromRow(row);
  assert.equal(mapped.monthlyRentCad, 1500); assert.equal(mapped.bathrooms, 1.5); assert.equal(mapped.availableFrom, '2026-10-17');
  assert.equal(Date.parse(mapped.firstSeenAt), Date.parse(sampleListings[0].firstSeenAt)); assert.equal(mapped.parking, 'unknown'); assert.equal(mapped.excerpt, ''); assert.equal(mapped.neighbourhoodId, null); assert.equal(mapped.wardId, null);
  for (const patch of [{ monthly_rent_cad: '' }, { bathrooms: 'NaN' }, { lng: 200 }, { field_evidence: null }, { id: 'invalid' }]) assert.throws(() => listingFromRow({ ...row, ...patch }));
});
test('all request values are bound; active unique pool has no LIMIT or premature sorting cap', () => {
  const attack = "x' OR true; DROP TABLE listings; --";
  const query = candidateQuery({ intent: { ...baseIntent, areas: [{ kind: 'ward', id: attack }], criteria: { rent: { hard: true, value: { min: 1000, max: 2000 } }, leaseTerm: { hard: true, value: '12_months' } } }, hideUnconfirmed: false });
  assert.ok(!query.statement.includes(attack)); assert.deepEqual(query.parameters, [1000, 2000, '12_months', attack]);
  assert.match(query.statement, /status = 'active' AND duplicate_of IS NULL/); assert.match(query.statement, /ward_id = \$4 OR ward_id IS NULL/); assert.doesNotMatch(query.statement, /LIMIT/i);
  const refs = [...query.statement.matchAll(/\$(\d+)/g)].map(match => Number(match[1])); assert.deepEqual(refs, [1, 2, 3, 4]);
});
test('hard cheap filters mirror unknown, room/studio, date and amenity semantics; soft values do not gate', () => {
  const request: SearchRequest = { intent: { ...baseIntent, criteria: { bedrooms: { hard: true, value: { min: 1 } }, bathrooms: { hard: true, value: { min: 1 } }, sizeSqft: { hard: true, value: { max: 800 } }, unitTypes: { hard: true, value: ['studio'] }, buildingAge: { hard: true, value: { builtAfter: 2000 } }, airConditioning: { hard: true, value: 'central' }, petsAllowed: { hard: true, value: 'cats' }, furnished: { hard: true, value: false }, parking: { hard: true, value: true }, laundryInSuite: { hard: true, value: true }, utilitiesIncluded: { hard: true, value: true }, availableBy: { hard: true, value: '2026-11-01' } } }, hideUnconfirmed: false };
  const { statement, parameters } = candidateQuery(request);
  for (const column of ['bedrooms', 'bathrooms', 'sqft', 'year_built', 'available_from']) assert.ok(statement.includes(`${column} IS NULL`));
  assert.match(statement, /unit_type IS DISTINCT FROM 'room' AND rent_is_per_room = false/);
  assert.match(statement, /air_conditioning = 'central'/); assert.match(statement, /pets_allowed IN \('yes', \$/); assert.ok(parameters.includes('cats_only')); assert.ok(parameters.includes('no')); assert.ok(parameters.includes('2026-11-01'));
  const hidden = candidateQuery({ ...request, hideUnconfirmed: true }).statement;
  assert.doesNotMatch(hidden, /OR bedrooms IS NULL|OR air_conditioning = 'unknown'/); assert.match(hidden, /air_conditioning IS NOT NULL AND air_conditioning <> 'unknown'/);
  assert.doesNotMatch(candidateQuery({ ...input, intent: { ...baseIntent, criteria: { rent: { hard: false, value: { max: 1 } } } } }).statement, /monthly_rent_cad <=/);
});
test('SQL areas use OR and conservative near gating; pure verification handles exact bounds and unknowns', async () => {
  const first = sampleListings[0];
  const rows = [rowFor(first), rowFor({ ...first, id: sampleListings[1].id, neighbourhoodId: null, wardId: null }), rowFor({ ...first, id: sampleListings[2].id, location: { lng: -80, lat: 44 } })];
  const load = sqlCandidateLoader(() => ({ unsafe: async () => rows }));
  const near: SearchRequest = { ...input, intent: { ...baseIntent, areas: [{ kind: 'near', point: first.location, radiusM: 1 }] } };
  assert.equal((await load(near)).length, 2); assert.match(candidateQuery(near).statement, /AND \(true\)/);
  const area: SearchRequest = { ...input, intent: { ...baseIntent, areas: [{ kind: 'neighbourhood', id: 'not-a-match' }, { kind: 'configured', id: 'box', label: 'box', bounds: [-80.1, 43.9, -79.9, 44.1] }] } };
  assert.equal((await load(area)).length, 2); assert.equal((await load({ ...area, hideUnconfirmed: true })).length, 1);
  const query = candidateQuery(area); assert.match(query.statement, / OR \(ST_X/); assert.deepEqual(query.parameters, ['not-a-match', -80.1, -79.9, 43.9, 44.1]);
});
test('loader reaches ordinary and scalar APIs, preserving full >500 pool before numeric ordering/percentile', async () => {
  const rows = Array.from({ length: 520 }, (_, i) => rowFor({ ...sampleListings[0], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, monthlyRentCad: 1520 - i }));
  let calls = 0;
  const loadCandidates = sqlCandidateLoader(() => ({ unsafe: async (statement) => { calls++; assert.doesNotMatch(statement, /LIMIT/i); return rows; } }));
  const api = createRuntime({ env: {}, dependencies: { listings: [], loadCandidates, enrich } });
  const ordinary = await api.search(http({ ...input, intent: { ...baseIntent, sortBy: 'lowest_rent' } }), undefined);
  const result = await ordinary.json(); assert.equal(ordinary.status, 200); assert.equal(result.results.length, 500); assert.equal(result.eligibleCount, 520); assert.equal(result.results[0].listing.monthlyRentCad, 1001);
  const scalar = await api.search(http({ ...input, intent: { ...baseIntent, numericExtreme: { field: 'rent', direction: 'min', percentage: 100, minimumCount: 10 } } }), undefined);
  const selected = await scalar.json(); assert.equal(scalar.status, 200); assert.equal(selected.results.length, 520); assert.equal(selected.eligibleCount, 520); assert.equal(calls, 2);
});
test('loader pure verification applies every cheap gate before enrichment even with simulated unfiltered DB', async () => {
  const first = { ...sampleListings[0], bedrooms: 2 as number | null };
  let enriched = 0;
  const loadCandidates = sqlCandidateLoader(() => ({ unsafe: async () => [rowFor(first), rowFor({ ...first, id: sampleListings[1].id, bedrooms: null }), rowFor({ ...first, id: sampleListings[2].id, status: 'removed' }), rowFor({ ...first, id: sampleListings[3].id, duplicateOf: first.id })] }));
  const api = createRuntime({ env: {}, dependencies: { listings: [], loadCandidates, enrich: async () => { enriched++; return enrich(); } } });
  const body = { ...input, intent: { ...baseIntent, criteria: { bedrooms: { hard: true, value: { min: 2 } } } }, hideUnconfirmed: true };
  const response = await api.search(http(body), undefined); assert.equal(response.status, 200); assert.equal((await response.json()).results.length, 1); assert.equal(enriched, 1);
});
test('missing DB, invalid rows, aborted reads and exact job cancellation fail honestly', async () => {
  vi.mocked(getClient).mockClear(); await assert.rejects(sqlCandidateLoader()(input), SearchUnavailable); assert.equal(vi.mocked(getClient).mock.calls.length, 1);
  await assert.rejects(sqlCandidateLoader(() => ({ unsafe: async () => [{}] }))(input), SearchUnavailable);
  for (const unsafe of [async () => [{}], async () => { throw new Error('private database details'); }]) {
    const broken = createRuntime({ env: {}, dependencies: { listings: [], loadCandidates: sqlCandidateLoader(() => ({ unsafe })), enrich } });
    const response = await broken.search(http(input), undefined); assert.equal(response.status, 503); assert.ok(!JSON.stringify(await response.json()).includes('private'));
  }
  const controller = new AbortController(); let finish: (rows: unknown[]) => void = () => {};
  const load = sqlCandidateLoader(() => ({ unsafe: () => new Promise<unknown[]>(resolve => { finish = resolve; }) }));
  const pending = load(input, controller.signal); controller.abort(); await assert.rejects(pending, SearchUnavailable);
  let retried = 0; const retry = sqlCandidateLoader(() => ({ unsafe: async () => { retried++; return []; } }));
  await assert.rejects(retry(input), SearchUnavailable); assert.equal(retried, 0);
  finish([]); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await retry(input), []); assert.equal(retried, 1);
  const api = createRuntime({ env: {}, dependencies: { listings: [], loadCandidates: load, enrich } });
  const response = await api.search(http({ ...input, intent: { ...travelIntent, numericExtreme: { field: 'travel', direction: 'min', percentage: 5, minimumCount: 10, targetId: travelIntent.travelTargets[0].id } } }), undefined);
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'pending'); api.jobs.dispose(); finish([]);
});
