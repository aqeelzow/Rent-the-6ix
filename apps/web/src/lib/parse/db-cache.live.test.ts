import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { databaseIntentCache, parseCacheWrite } from './db-cache';
import { ParseService, fallbackParse } from './index';
import { createRuntime } from '../api/runtime';

// Opt in: RUN_LIVE_PARSE_CACHE=1 pnpm --filter web exec vitest run src/lib/parse/db-cache.live.test.ts
// Uses the ignored web .env.local; validates PostgreSQL persistence with a controlled provider, not Gemini availability.
test.skipIf(process.env.RUN_LIVE_PARSE_CACHE !== '1')('live ai_cache cross-runtime roundtrip, privacy, expiry and cleanup (controlled provider)', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const keys = new Set<string>();
  let providerCalls = 0;
  const prompt = 'under $2500, 10 min walk to Union Station';
  const namespace = `live-parse-cache-${randomUUID()}`;
  const client = () => ({ unsafe: async (statement: string, parameters: (string | number)[]) => {
    if (statement === parseCacheWrite) keys.add(String(parameters[0]));
    return await sql.unsafe(statement, parameters);
  } });
  const make = () => createRuntime({ env: { SEARCH_FIXTURES: '1', AI_PROVIDER: 'none' }, parser: new ParseService({
    cacheNamespace: namespace,
    intentCache: databaseIntentCache(client, 1000),
    provider: { generateStructured: async <T>() => { providerCalls++; return fallbackParse(prompt) as T; }, generateText: async () => '' },
  }) });
  const parse = async () => {
    const response = await make().parse(new Request('http://localhost/api/search/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) }), undefined);
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const first = await parse(); const second = await parse();
    assert.deepEqual(second, first); assert.equal(first.parser, 'gemini'); assert.equal(providerCalls, 1);
    assert.equal(keys.size, 1);
    const [row] = await sql`SELECT route, payload, expires_at > now() AS fresh FROM ai_cache WHERE key = ${[...keys][0]}`;
    assert.equal(row.route, 'search.parse'); assert.equal(row.fresh, true);
    const stored = JSON.stringify(row.payload);
    for (const fragment of [prompt, 'Union Station', 'under $2500', 'known_place']) assert.equal(stored.includes(fragment), false);
    assert.equal(row.payload.intent.rawPrompt, ''); assert.deepEqual(row.payload.intent.fieldSources, {});
    await sql`UPDATE ai_cache SET expires_at = now() - interval '1 second' WHERE key = ${[...keys][0]} AND route = 'search.parse'`;
    await parse(); assert.equal(providerCalls, 2);
    console.info(JSON.stringify({ feature: 'P1.24', database: 'live', provider: 'controlled (not Gemini)', crossRuntimeHit: true, expiredMiss: true, rawPromptAbsent: true }));
  } finally {
    try { if (keys.size) await sql`DELETE FROM ai_cache WHERE key = ANY(${[...keys]}::text[]) AND route = 'search.parse'`; }
    finally { await sql.end({ timeout: 2 }); }
  }
}, 20000);
