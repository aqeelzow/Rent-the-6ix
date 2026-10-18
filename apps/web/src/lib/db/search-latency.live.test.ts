import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createRuntime } from '../api/runtime';
import { sqlSearchDependencies } from './candidates-context';
import { clearValuationCache } from './valuation';
import { SearchResponseSchema } from '../../../../../packages/shared/schemas/index';

// Read-only latency probe against the real database:
// RUN_LIVE_SEARCH_LATENCY=1 pnpm --filter web exec vitest run src/lib/db/search-latency.live.test.ts
test.skipIf(process.env.RUN_LIVE_SEARCH_LATENCY !== '1')('ordinary search latency: cold, warm, cached response', async () => {
  if (!process.env.DATABASE_URL) { try { process.loadEnvFile('../../.env.local'); } catch { /* the repo-root file is the only local env */ } }
  assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 10, idle_timeout: 300, onnotice: () => {} });
  const deps = sqlSearchDependencies(() => sql);
  const prompt = 'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.';
  const post = (body: unknown) => new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const cold = createRuntime({ env: process.env, dependencies: deps, identity: () => 'latency-probe' });
    const parseStart = performance.now();
    const parsed = await (await cold.parse(post({ prompt }), undefined)).json();
    const parseMs = Math.round(performance.now() - parseStart);
    const body = { intent: { ...parsed.intent, rawPrompt: '', fieldSources: {}, droppedRequests: [] }, hideUnconfirmed: false };

    clearValuationCache();
    let start = performance.now();
    const first = SearchResponseSchema.parse(await (await cold.search(post(body), undefined)).json());
    const coldMs = Math.round(performance.now() - start);
    const firstBytes = JSON.stringify(first).length;

    // New runtime (fresh response cache), same process: valuations are now in the 6 h cache.
    const warmRuntime = createRuntime({ env: process.env, dependencies: deps, identity: () => 'latency-probe' });
    start = performance.now();
    const second = SearchResponseSchema.parse(await (await warmRuntime.search(post(body), undefined)).json());
    const warmMs = Math.round(performance.now() - start);

    // Same runtime again: the short-lived response cache answers.
    start = performance.now();
    const third = SearchResponseSchema.parse(await (await warmRuntime.search(post(body), undefined)).json());
    const cachedMs = Math.round(performance.now() - start);

    assert.equal(first.status, 'completed');
    assert.ok(first.status === 'completed' && second.status === 'completed' && third.status === 'completed');
    const record = {
      scope: 'Read-only live ordinary search through B runtime + C owner SQL; no HTTP/serialization',
      parser: parsed.parser, parseMs, results: first.results.length, eligibleCount: first.eligibleCount,
      coldMs, warmMs, cachedMs, responseBytes: firstBytes,
      comparablesPerResult: Math.max(...first.results.map(result => result.valuation.comparables.length)),
      sameResultCounts: first.results.length === second.results.length && second.results.length === third.results.length,
    };
    process.stdout.write(JSON.stringify(record) + '\n');
  } finally { clearValuationCache(); await sql.end({ timeout: 2 }); }
}, 120000);
