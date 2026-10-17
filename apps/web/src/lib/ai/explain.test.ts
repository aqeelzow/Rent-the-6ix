import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { detailFixture, baseIntent } from '../../../../../packages/shared/fixtures/index';
import { ExplanationService, explanationFacts, validExplanation } from './explain';
import { databaseExplanationCache } from './explain-cache';
import { createRuntime } from '../api/runtime';
import type { AIProvider } from './index';
import postgres from 'postgres';
import { sqlSearchDependencies } from '../db/candidates-context';

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string, body: unknown) => new Request(`http://localhost/api/listings/${id}/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('explain accepts grounded text, caches it and rejects invented numbers or safety claims', async () => {
  const facts = explanationFacts(detailFixture);
  assert.equal(facts.safety, null);
  assert.ok(!JSON.stringify(facts).includes(detailFixture.listing.excerpt));
  assert.equal(validExplanation('The score reflects the shown factors. Verify the listing with its source.', facts), true);
  assert.equal(validExplanation('The score reflects 1.5 recorded points. Check the listing. Confirm availability.', { ...facts, score: 1.5 }), true);
  assert.equal(validExplanation('The rent is 999999 dollars. Verify the listing.', facts), false);
  assert.equal(validExplanation('This is a safe neighbourhood. Verify the listing.', facts), false);
  for (const word of ['safest', 'sketchy', 'risky']) assert.equal(validExplanation(`This area is ${word}. Verify the listing.`, facts), false);
  const withSafety = { ...facts, safety: { relativeRate: 1.2, years: [2025] } };
  assert.equal(validExplanation('The neighbourhood has a low crime rate. Verify the listing.', withSafety), false);
  assert.equal(validExplanation('Police-reported neighbourhood rates are area-wide. Verify the listing.', withSafety), true);
  let calls = 0;
  const provider: AIProvider = { generateStructured: async () => { throw Error('unused'); }, generateText: async () => { calls++; return 'The score reflects the shown factors. Verify the listing with its source.'; } };
  const service = new ExplanationService(provider);
  assert.equal((await service.explain(detailFixture)).source, 'gemini');
  assert.equal((await service.explain(detailFixture)).source, 'gemini');
  assert.equal(calls, 1);
});

test('explain route uses computed detail, redacted intent, quota and a template when AI fails', async () => {
  const api = createRuntime({ env: { SEARCH_FIXTURES: '1' }, explainProvider: { generateStructured: async () => { throw Error('unused'); }, generateText: async () => { throw Error('offline'); } } });
  const id = detailFixture.listing.id;
  const result = await api.explain(request(id, { intent: baseIntent }), context(id));
  assert.equal(result.status, 200);
  const body = await result.json() as { explanation: string; source: string };
  assert.equal(body.source, 'template');
  assert.match(body.explanation, /scores \d+ out of 100/);
  assert.equal((await api.explain(request(id, { intent: { ...baseIntent, rawPrompt: 'secret' } }), context(id))).status, 422);
  assert.equal((await api.explain(request('bad', {}), context('bad'))).status, 422);
  assert.equal((await api.explain(request('00000000-0000-4000-8000-999999999999', {}), context('00000000-0000-4000-8000-999999999999'))).status, 404);
});

test.skipIf(process.env.RUN_LIVE_EXPLAIN !== '1')('live DB listing produces a grounded explanation', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5, onnotice: () => {} });
  const api = createRuntime({ env: {}, dependencies: sqlSearchDependencies(() => sql) });
  try {
    const [row] = await sql`SELECT id FROM listings WHERE status = 'active' AND duplicate_of IS NULL ORDER BY last_seen_at DESC LIMIT 1`;
    assert.ok(row);
    const id = String(row.id);
    const response = await api.explain(request(id, {}), context(id));
    assert.equal(response.status, 200);
    const body = await response.json() as { explanation: string; source: string };
    assert.equal(body.source, 'template');
    assert.match(body.explanation, /^This listing scores \d+ out of 100/);
  } finally { api.jobs.dispose(); await sql.end({ timeout: 2 }); }
}, 30000);

test.skipIf(process.env.RUN_LIVE_EXPLAIN_CACHE !== '1')('validated explanation survives a new runtime in ai_cache and changes with facts', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const keys = new Set<string>();
  const client = () => ({ unsafe: async (statement: string, parameters: string[]) => {
    if (statement.startsWith('INSERT INTO ai_cache')) keys.add(parameters[0]);
    return sql.unsafe(statement, parameters);
  } });
  const cache = databaseExplanationCache(client, 1000);
  const namespace = `live-explain-${randomUUID()}`;
  let calls = 0;
  const provider: AIProvider = { generateStructured: async () => { throw Error('unused'); }, generateText: async () => { calls++; return 'The score reflects the shown factors. Verify the listing with its source.'; } };
  try {
    assert.equal((await new ExplanationService(provider, namespace, cache).explain(detailFixture)).source, 'gemini');
    assert.equal((await new ExplanationService(provider, namespace, cache).explain(detailFixture)).source, 'gemini');
    assert.equal(calls, 1);
    const changed = { ...detailFixture, matchScore: { ...detailFixture.matchScore, total: detailFixture.matchScore.total - 1 } };
    await new ExplanationService(provider, namespace, cache).explain(changed);
    assert.equal(calls, 2);
    const [row] = await sql`SELECT route, payload FROM ai_cache WHERE key = ${[...keys][0]}`;
    assert.equal(row.route, 'listings.explain');
    assert.deepEqual(row.payload, { explanation: 'The score reflects the shown factors. Verify the listing with its source.' });
    assert.equal(JSON.stringify(row.payload).includes(detailFixture.listing.excerpt), false);
  } finally {
    try { if (keys.size) await sql`DELETE FROM ai_cache WHERE key = ANY(${[...keys]}::text[]) AND route = 'listings.explain'`; }
    finally { await sql.end({ timeout: 2 }); }
  }
}, 20000);
