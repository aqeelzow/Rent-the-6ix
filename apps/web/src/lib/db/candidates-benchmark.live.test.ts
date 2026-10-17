import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { benchmarkFor, type BenchmarkRow } from '../../../../../packages/shared/engine/benchmark';
import { baseIntent } from '../../../../../packages/shared/fixtures/index';
import { DetailResponseSchema, SearchResponseSchema, type Listing } from '../../../../../packages/shared/schemas/index';
import { createRuntime } from '../api/runtime';
import { sqlSearchDependencies } from './candidates-context';
import { clearValuationCache, listingContext } from './valuation';

// Read-only, bounded real-listing sample; RUN_LIVE_SEARCH_BENCHMARK=1 pnpm --filter web exec vitest run src/lib/db/candidates-benchmark.live.test.ts
test.skipIf(process.env.RUN_LIVE_SEARCH_BENCHMARK !== '1')('live search and detail preserve C asking-rent benchmarks without changing valuation', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5, onnotice: () => {} });
  const dependencies = sqlSearchDependencies(() => sql);
  const api = createRuntime({ env: {}, dependencies });
  try {
    const rows = await sql`SELECT id, key, value_cad::float8 AS "valueCad", period, source_id AS "sourceId", unit, sample FROM benchmarks WHERE kind = 'rent' AND value_cad IS NOT NULL`;
    assert.ok(rows.length > 0);
    const benchmarks = rows as unknown as BenchmarkRow[];
    assert.ok(rows.some(row => row.key.basis === 'asking'));
    assert.ok(rows.some(row => row.key.basis === 'paid'), 'paid-rent rows must be present to exercise their exclusion');
    const facts = await sql`SELECT DISTINCT ON (sample_kind) id, unit_type, bedrooms,
      CASE WHEN unit_type = 'room' THEN 'room' WHEN bedrooms IS NULL THEN 'unknown-bedrooms'
        WHEN unit_type IN ('house', 'townhouse') AND bedrooms >= 3 THEN 'house-3plus'
        WHEN unit_type = 'apartment' AND bedrooms = 2 THEN 'apartment-2' END AS sample_kind
      FROM listings WHERE status = 'active' AND duplicate_of IS NULL
        AND (unit_type = 'room' OR bedrooms IS NULL OR (unit_type IN ('house', 'townhouse') AND bedrooms >= 3) OR (unit_type = 'apartment' AND bedrooms = 2))
      ORDER BY sample_kind, last_seen_at DESC, id`;
    assert.deepEqual(facts.map(row => row.sample_kind).sort(), ['apartment-2', 'house-3plus', 'room', 'unknown-bedrooms']);
    const listings: Listing[] = [];
    const expected = new Map<string, ReturnType<typeof benchmarkFor>>();
    let valued = 0;
    for (const fact of facts) {
      const listing = await dependencies.loadListing!(String(fact.id));
      assert.ok(listing);
      assert.equal(listing.unitType, fact.unit_type); assert.equal(listing.bedrooms, fact.bedrooms);
      const benchmark = benchmarkFor({ unitType: fact.unit_type, bedrooms: fact.bedrooms }, benchmarks);
      expected.set(listing.id, benchmark); listings.push(listing);
      if (fact.sample_kind === 'unknown-bedrooms') assert.equal(benchmark, null);
      else {
        assert.ok(benchmark);
        const matched = rows.filter(row => row.key.basis === 'asking' && row.valueCad === benchmark.valueCad && row.period === benchmark.period && row.sourceId === benchmark.sourceId);
        assert.ok(matched.length > 0); assert.ok(matched.every(row => row.unit === 'CAD/month' && row.sample === false));
        assert.match(benchmark.label, /asking rent/); assert.doesNotMatch(benchmark.label, /paid/);
      }
      const now = new Date();
      clearValuationCache();
      const withBenchmark = await listingContext(sql, listing, now);
      clearValuationCache();
      const withoutBenchmark = await listingContext(sql, listing, now, null);
      assert.deepEqual(withBenchmark.valuation.benchmark, benchmark);
      assert.deepEqual({ ...withBenchmark.valuation, benchmark: null }, withoutBenchmark.valuation);
      assert.deepEqual(withBenchmark.caveats, withoutBenchmark.caveats);
      if (withBenchmark.valuation.status === 'ok') valued++;
      clearValuationCache();
    }
    assert.ok(valued > 0, 'must compare actual estimates/confidence, not only insufficient-data results');
    // Exercise the real SQL loader, then bound this context-propagation test to the four owner-mapped listings.
    const loaded = await dependencies.loadCandidates!({ intent: baseIntent, hideUnconfirmed: false });
    for (const listing of listings) assert.ok(loaded.some(candidate => candidate.id === listing.id));
    dependencies.loadCandidates = async () => listings;
    const response = await api.search(new Request('http://localhost/api/listings/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: baseIntent, hideUnconfirmed: false }) }), undefined);
    assert.equal(response.status, 200);
    const search = SearchResponseSchema.parse(await response.json());
    assert.ok(search.status === 'completed');
    assert.equal(search.results.length, listings.length);
    for (const result of search.results) {
      assert.deepEqual(result.valuation.benchmark, expected.get(result.listing.id));
      const id = result.listing.id;
      const detailResponse = await api.detail(new Request(`http://localhost/api/listings/${id}?intent=${encodeURIComponent(JSON.stringify(baseIntent))}`), { params: Promise.resolve({ id }) });
      assert.equal(detailResponse.status, 200);
      const detail = DetailResponseSchema.parse(await detailResponse.json());
      assert.deepEqual(detail.valuation.benchmark, result.valuation.benchmark);
      assert.deepEqual(detail.valuation, result.valuation);
    }
    console.info(JSON.stringify({ feature: 'P2.3 benchmark consumption', database: 'live', rentRows: rows.length, sampledListings: listings.length, actualValuations: valued, askingOnly: true, searchDetailEqual: true, valuationUnchanged: true }));
  } finally { clearValuationCache(); api.jobs.dispose(); await sql.end({ timeout: 2 }); }
}, 60000);
