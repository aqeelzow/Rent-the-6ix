import assert from 'node:assert/strict';
import postgres from 'postgres';

const base = process.env.SEARCH_BASE_URL ?? 'http://127.0.0.1:3040';
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
const measurements = [];
async function call(path, body, expected = 200) {
  const start = performance.now();
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  measurements.push({ path: path.split('?')[0].replace(/jobs\/[A-Za-z0-9_-]+$/, 'jobs/:token').replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, ':id'), ms: Math.round(performance.now() - start), status: response.status });
  return data;
}
try {
  const parsed = await call('/api/search/parse', { prompt: 'cheapest downtown apartment under $3000 with 2 bedrooms' });
  assert.deepEqual(parsed.intent.criteria.rent.value, { max: 3000 });
  assert.deepEqual(parsed.intent.criteria.bedrooms.value, { min: 2, max: 2 });
  assert.equal(parsed.intent.sortBy, 'lowest_rent');
  const intent = { ...parsed.intent, rawPrompt: '', fieldSources: {}, droppedRequests: [] };
  const request = { intent, hideUnconfirmed: true };
  // Independent SQL oracle for these known fields and the documented configured Downtown box.
  const expected = await sql`select id, monthly_rent_cad as rent from listings where status='active' and duplicate_of is null and monthly_rent_cad<=3000 and bedrooms=2 and unit_type='apartment' and rent_is_per_room=false and ST_X(location::geometry) between -79.425 and -79.345 and ST_Y(location::geometry) between 43.635 and 43.675 order by monthly_rent_cad,last_seen_at desc,id`;
  assert.ok(expected.length > 0);
  const results = await call('/api/listings/search', request);
  assert.equal(results.status, 'completed');
  assert.equal(results.eligibleCount, expected.length);
  assert.equal(results.results.length, Math.min(500, expected.length));
  assert.equal(results.results[0].listing.monthlyRentCad, expected[0].rent);
  assert.ok(results.results.every((row, i, rows) => row.listing.dataStatus === 'live' && row.listing.bedrooms === 2 && row.listing.unitType === 'apartment' && (!i || rows[i-1].listing.monthlyRentCad<=row.listing.monthlyRentCad)));
  const warm = await call('/api/listings/search', request);
  assert.deepEqual(warm, results);
  const percentile = await call('/api/listings/search', { ...request, intent: { ...intent, numericExtreme: { field: 'rent', direction: 'min', percentage: 5 } } });
  const count = Math.min(expected.length, Math.max(10, Math.ceil(expected.length * .05)));
  assert.equal(percentile.eligibleCount, expected.length);
  assert.equal(percentile.results.length, count);
  const cutoff = expected[count-1].rent;
  assert.ok(percentile.results.every(row => row.listing.monthlyRentCad <= cutoff));
  const row = results.results[0];
  const detail = await call(`/api/listings/${row.listing.id}?intent=${encodeURIComponent(JSON.stringify(intent))}`);
  assert.deepEqual(detail.listing, row.listing);
  assert.deepEqual(detail.valuation, row.valuation);
  assert.deepEqual(detail.matchScore, row.matchScore);
  assert.deepEqual(detail.areas, []);
  await call(`/api/listings/00000000-0000-4000-8000-000000000000?intent=${encodeURIComponent(JSON.stringify(intent))}`, undefined, 404);
  await call('/api/listings/search', {}, 422);
  const narrow = { ...request, intent: { ...intent, criteria: { ...intent.criteria, rent: { value: { max: expected[0].rent }, hard: true } } } };
  const overlap = await Promise.all([call('/api/listings/search', narrow), call('/api/listings/search', narrow)]);
  assert.ok(overlap.every(data => data.status === 'completed' && data.results.length));
  const [known] = await sql`select monthly_rent_cad rent, bedrooms, sqft, year_built, unit_type from listings where status='active' and duplicate_of is null and rent_is_per_room=false and bedrooms is not null and sqft is not null and year_built is not null and unit_type is not null and unit_type<>'room' and air_conditioning in ('central','yes') order by monthly_rent_cad limit 1`;
  assert.ok(known, 'A real row with known static fields is required');
  const staticExpected = await sql`select id from listings where status='active' and duplicate_of is null and rent_is_per_room=false and monthly_rent_cad=${known.rent} and bedrooms=${known.bedrooms} and sqft>=${known.sqft} and year_built>=${known.year_built} and unit_type=${known.unit_type} and air_conditioning in ('central','yes')`;
  const staticFields = await call('/api/listings/search', { hideUnconfirmed: true, intent: { ...intent, areas: [], criteria: {
    rent: { value: { min: known.rent, max: known.rent }, hard: true }, bedrooms: { value: { min: known.bedrooms, max: known.bedrooms }, hard: true },
    sizeSqft: { value: { min: known.sqft }, hard: true }, buildingAge: { value: { builtAfter: known.year_built }, hard: true },
    unitTypes: { value: [known.unit_type], hard: true }, airConditioning: { value: 'any', hard: true },
  } } });
  assert.equal(staticFields.eligibleCount, staticExpected.length);
  assert.deepEqual(new Set(staticFields.results.map(row => row.listing.id)), new Set(staticExpected.map(row => row.id)));
  const fairness = await call('/api/listings/search', { ...narrow, intent: { ...narrow.intent, criteria: { ...narrow.intent.criteria, priceFairness: { value: ['underpriced'], hard: true } } } });
  assert.equal(fairness.status, 'completed');
  assert.ok(fairness.results.length > 0 && fairness.results.every(row => row.valuation.priceLabel === 'underpriced'));
  const travelIntent = { ...narrow.intent, numericExtreme: { field: 'travel', direction: 'min', percentage: 5, targetId: 'union' }, travelTargets: [{ id: 'union', kind: 'place', label: 'Union Station', query: 'Union Station', mode: 'walk', hard: false, resolved: { lng: -79.3806, lat: 43.6453, label: 'Union Station', source: 'known_place' } }] };
  const job = await call('/api/listings/search', { ...narrow, intent: travelIntent });
  assert.equal(job.status, 'pending');
  let terminal;
  for (let attempt = 0; attempt < 50; attempt++) {
    terminal = await call(job.pollUrl);
    if (terminal.status !== 'pending') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(terminal.status, 'unavailable');
  assert.equal(terminal.reason, 'routing_incomplete');
  await call(job.pollUrl, undefined, 410);
  console.log(JSON.stringify({ parser: parsed.parser, eligible: expected.length, returned: results.results.length, percentile: count, liveDetail: true, overlappingSearches: true, staticSizeAgeTypeAc: true, hardFairness: true, asyncJobs: true, measurements }, null, 2));
} finally { await sql.end({ timeout: 1 }); }
