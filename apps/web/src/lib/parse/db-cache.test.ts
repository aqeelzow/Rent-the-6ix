import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { databaseIntentCache, parseCacheRead, parseCacheWrite } from './db-cache';
import { ParseService, fallbackParse, DestinationResolver } from './index';
import { AIUnavailable } from '../ai';

function database() {
  const rows = new Map<string, { payload: unknown; expires: number }>();
  const calls: { statement: string; parameters: (string | number)[] }[] = [];
  return { rows, calls, client: () => ({ unsafe: async (statement: string, parameters: (string | number)[]) => {
    calls.push({ statement, parameters });
    const key = String(parameters[0]);
    if (statement === parseCacheWrite) { rows.set(key, { payload: JSON.parse(String(parameters[2])), expires: Date.now() + 300000 }); return []; }
    assert.equal(statement, parseCacheRead);
    const row = rows.get(key);
    return row && row.expires > Date.now() ? [{ payload: row.payload }] : [];
  } }) };
}
const provider = (prompt: string, counter: { calls: number }) => ({ generateStructured: async <T>() => { counter.calls++; return fallbackParse(prompt) as T; }, generateText: async () => '' });
test('new services reuse DB parses without storing prompt/evidence or resolved destinations', async () => {
  const db = database(); const counter = { calls: 0 };
  const prompt = '10 min walk to Union Station, under $2500';
  const make = () => new ParseService({ provider: provider(prompt, counter), intentCache: databaseIntentCache(db.client) });
  const first = await make().parse({ prompt }, 'ip');
  const second = await make().parse({ prompt }, 'ip');
  assert.deepEqual(second, first); assert.equal(counter.calls, 1);
  assert.equal(first.destinations[0].resolution.status, 'resolved');
  const serialized = JSON.stringify([...db.rows.values()]);
  for (const value of [prompt, 'Union Station', 'under $2500', '10 min walk', 'known_place']) assert.equal(serialized.includes(value), false, value);
  const parameters = db.calls.find(call => call.statement === parseCacheWrite)!.parameters;
  assert.match(String(parameters[0]), /^[0-9a-f]{64}$/); assert.equal(parameters[1], 'search.parse');
  const intent = second.intent; intent.criteria.rent!.value.max = 1;
  assert.equal((await make().parse({ prompt }, 'ip')).intent.criteria.rent?.value.max, 2500);
});
test('unavailable resolution is retried on DB hit; fallback failures are never persisted', async () => {
  const db = database(); const counter = { calls: 0 }; let resolved = false;
  const prompt = '10 min walk to an unknown place';
  const resolver = new DestinationResolver({ addressLookup: async query => resolved ? { status: 'resolved', query, destination: { id: 'lookup', label: 'Now available', resolved: { lng: -79.4, lat: 43.7, source: 'address_points' } } } : undefined });
  const make = () => new ParseService({ resolver, provider: provider(prompt, counter), intentCache: databaseIntentCache(db.client) });
  assert.equal((await make().parse({ prompt }, 'ip')).destinations[0].resolution.status, 'unavailable');
  resolved = true;
  assert.equal((await make().parse({ prompt }, 'ip')).destinations[0].resolution.status, 'resolved'); assert.equal(counter.calls, 1);
  const busy = new ParseService({ intentCache: databaseIntentCache(db.client), provider: { generateStructured: async () => { throw new AIUnavailable('busy', 429); }, generateText: async () => '' } });
  const count = db.rows.size;
  assert.equal((await busy.parse({ prompt: 'under $2100' }, 'ip')).parser, 'fallback');
  assert.equal(db.rows.size, count);
});
test('expiry, model/date namespaces and malformed payloads miss safely', async () => {
  const db = database(); const counter = { calls: 0 }; const prompt = 'under $2500';
  const make = (namespace = 'model-a', day = '2026-10-17') => new ParseService({ cacheNamespace: namespace, now: () => new Date(day), provider: provider(prompt, counter), intentCache: databaseIntentCache(db.client) });
  await make().parse({ prompt }, 'ip');
  for (const row of db.rows.values()) row.expires = 0;
  await make().parse({ prompt }, 'ip'); assert.equal(counter.calls, 2);
  await make('model-b').parse({ prompt }, 'ip');
  await make('model-a', '2026-10-18').parse({ prompt }, 'ip'); assert.equal(counter.calls, 4);
  const row = [...db.rows.values()][0]; row.payload = { invalid: true };
  await make().parse({ prompt }, 'ip'); assert.equal(counter.calls, 5);
  const payload = [...db.rows.values()][0].payload as { sources: Record<string, [number, number]> };
  payload.sources['criteria.rent'] = [0, prompt.length + 10];
  await make().parse({ prompt }, 'ip'); assert.equal(counter.calls, 6);
});
test('ungrounded labels and generated dropped text skip persistence, but response stays complete', async () => {
  const db = database();
  for (const kind of ['label', 'drop'] as const) {
    const prompt = '10 min walk to Union Station'; const intent = fallbackParse(prompt);
    if (kind === 'label') intent.travelTargets[0].label = 'Generated destination label';
    else intent.droppedRequests.push({ phrase: 'arbitrary phone 1234', reason: 'Generated clarification' });
    const service = new ParseService({ intentCache: databaseIntentCache(db.client), provider: { generateStructured: async <T>() => structuredClone(intent) as T, generateText: async () => '' } });
    const result = await service.parse({ prompt }, 'ip');
    assert.equal(result.parser, 'gemini'); assert.equal(db.rows.size, 0);
    if (kind === 'drop') assert.equal(result.intent.droppedRequests.length, 1);
  }
});
test('DB failures and never-settling operations respect a bounded optional cache budget', async () => {
  const bad = databaseIntentCache(() => { throw new Error('do not leak'); });
  assert.equal(await bad.get('hash', 'prompt'), undefined); await bad.set('hash', 'under $2500', fallbackParse('under $2500'));
  vi.useFakeTimers();
  try {
    let calls = 0; let finish: (rows: unknown) => void = () => {};
    const cache = databaseIntentCache(() => ({ unsafe: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }), 150);
    const pending = cache.get('hash', 'prompt'); await vi.advanceTimersByTimeAsync(150);
    assert.equal(await pending, undefined);
    assert.equal(await cache.get('another', 'prompt'), undefined); assert.equal(calls, 1);
    finish([]); await Promise.resolve(); await Promise.resolve();
    const next = cache.get('hash', 'prompt'); await vi.advanceTimersByTimeAsync(150); await next;
    assert.equal(calls, 2);
  } finally { vi.useRealTimers(); }
});

test('runtime enables DB cache only for live Gemini configuration', async () => {
  const cacheModule = await import('./db-cache');
  const { createRuntime } = await import('../api/runtime');
  const factory = vi.spyOn(cacheModule, 'databaseIntentCache').mockReturnValue({ get: async () => undefined, set: async () => {} });
  try {
    for (const env of [
      { DATABASE_URL: 'configured', AI_PROVIDER: 'none' },
      { DATABASE_URL: 'configured', AI_PROVIDER: 'gemini', SEARCH_FIXTURES: '1' },
      { AI_PROVIDER: 'gemini' },
      { DATABASE_URL: 'configured' },
    ]) createRuntime({ env });
    assert.equal(factory.mock.calls.length, 0);
    createRuntime({ env: { DATABASE_URL: 'configured', AI_PROVIDER: 'gemini' } });
    assert.equal(factory.mock.calls.length, 1);
  } finally { factory.mockRestore(); }
});
