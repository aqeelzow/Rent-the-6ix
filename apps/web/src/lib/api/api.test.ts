import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRuntime, fixtureDependencies } from './runtime';
import { SearchJobs } from './jobs';
import { jsonRoute } from './json-route';
import { IpLimiter, ParseService, fallbackParse } from '../parse/index';
import { GeminiProvider } from '../ai/index';
import { baseIntent, travelIntent, sampleListings } from '../../../../../packages/shared/fixtures/index';
import { SearchResponseSchema, DetailResponseSchema, ParseResponseSchema } from '../../../../../packages/shared/schemas/index';
import { scoreListing } from '../../../../../packages/shared/engine/score';
const request = (path: string, body?: unknown) => new Request(`http://localhost/api/${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const exact = { intent: { ...travelIntent, numericExtreme: { field: 'travel' as const, direction: 'min' as const, percentage: 5, minimumCount: 10, targetId: 'campus' } }, hideUnconfirmed: false };
test('request boundary errors, unknowns, streamed limit, paths, queries, sanitized server errors', async () => {
  const api = createRuntime({ env: { SEARCH_FIXTURES: '1' } });
  for (const body of [{ prompt: '' }, { prompt: 'hi', unexpected: 1 }]) assert.equal((await api.parse(request('search/parse', body), undefined)).status, 422);
  for (const body of ['{', ' '.repeat(65537)]) assert.equal((await api.parse(new Request('http://localhost', { method: 'POST', body }), undefined)).status, 422);
  assert.equal((await api.search(request('listings/search', { intent: { ...baseIntent, numericExtreme: [] } }), undefined)).status, 422);
  for (const path of ['geo/resolve', 'geo/resolve?q=a&q=b', 'geo/resolve?q=x&extra=1', `geo/resolve?q=${'x'.repeat(501)}`]) assert.equal((await api.resolve(request(path), undefined)).status, 422);
  assert.equal((await api.detail(request('listings/x?intent={}'), context('invalid'))).status, 422);
  assert.equal((await api.detail(request('listings/x?intent={'), context(sampleListings[0].id))).status, 422);
  assert.equal((await api.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(baseIntent))), context('00000000-0000-4000-8000-999999999999'))).status, 404);
  assert.equal((await api.poll(request('jobs/x'), { params: Promise.resolve({ token: 'invalid' }) })).status, 422);
  const broken = jsonRoute({ name: 'test' }, async () => { throw Error('SECRET prompt'); });
  const response = await broken(request('test'), undefined); assert.equal(response.status, 500); assert.ok(!JSON.stringify(await response.json()).includes('SECRET'));
});
test('safe anonymous quotas ignore forged forwarding headers; start and poll quotas enforce 429', async () => {
  const api = createRuntime({ env: { SEARCH_FIXTURES: '1' }, limiter: new IpLimiter(1), pollLimiter: new IpLimiter(1) });
  assert.equal((await api.resolve(request('geo/resolve?q=Union%20Station'), undefined)).status, 200);
  const forged = new Request('http://localhost/api/geo/resolve?q=Union%20Station', { headers: { 'x-forwarded-for': 'new-ip' } });
  const limited = await api.resolve(forged, undefined); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  const token = 'a'.repeat(43), ctx = { params: Promise.resolve({ token }) };
  assert.equal((await api.poll(request('jobs'), ctx)).status, 410); assert.equal((await api.poll(request('jobs'), ctx)).status, 429);
  const starts = createRuntime({ env: { SEARCH_FIXTURES: '1' }, startLimiter: new IpLimiter(1) });
  assert.equal((await starts.search(request('listings/search', exact), undefined)).status, 200);
  assert.equal((await starts.search(request('listings/search', exact), undefined)).status, 429); starts.jobs.dispose();
});
test('default listing dependencies unavailable; parsing/resolution work; fixture search/detail preserve scores and distance labels', async () => {
  const api = createRuntime({ env: {} });
  assert.equal((await api.search(request('listings/search', { intent: baseIntent }), undefined)).status, 503);
  assert.equal((await api.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(baseIntent))), context(sampleListings[0].id))).status, 503);
  assert.equal((await api.parse(request('search/parse', { prompt: 'cheapest' }), undefined)).status, 200);
  assert.equal((await api.resolve(request('geo/resolve?q=University%20of%20Toronto'), undefined)).status, 200);
  const fixtures = createRuntime({ env: { SEARCH_FIXTURES: '1' } });
  const response = await fixtures.search(request('listings/search', { intent: travelIntent }), undefined);
  const search = SearchResponseSchema.parse(await response.json()); assert.equal(search.status, 'completed'); if (search.status !== 'completed') return;
  assert.equal(search.results.length, 8); assert.ok(search.results.every(r => r.listing.dataStatus === 'demo' && r.travel.every(t => t.minutes === null && t.method === 'straight_line')));
  const intent = { ...travelIntent, rawPrompt: '', fieldSources: {}, droppedRequests: [] };
  const detail = DetailResponseSchema.parse(await (await fixtures.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(intent))), context(search.results[0].listing.id))).json());
  assert.deepEqual(detail.matchScore, search.results[0].matchScore); assert.deepEqual(detail.travel, search.results[0].travel);
  assert.equal((await fixtures.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(travelIntent))), context(search.results[0].listing.id))).status, 422);
  const scalar = SearchResponseSchema.parse(await (await fixtures.search(request('listings/search', { intent: { ...baseIntent, numericExtreme: { field: 'rent', direction: 'min', percentage: 5 } } }), undefined)).json()); assert.equal(scalar.status, 'completed');
});
const prompts = [
  "I'm looking for houses or apartments around the university of toronto. Should be within 10 minutes biking distance. Around 3-5k per",
  "I work at TD Canada on bay st and queens st w. I'm looking for a place to commute, bike, or walk to work, and it should take no longer than 10 minutes.",
  "I'm on a budget. I wanna live in downtown at the cheapest cost",
  'Room or studio near York University under $1,300, close to the subway, furnished.',
  'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.',
  '3 bedrooms in Scarborough under $3,200, near a public school and a park, parking.',
];
test('all six acceptance prompts traverse fallback and mocked Gemini APIs, with search/detail consistency', async () => {
  for (const gemini of [false, true]) {
    const provider = new GeminiProvider({ apiKey: 'mock', model: 'mock', fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)), prompt = JSON.parse(body.contents[0].parts[0].text).userText;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(fallbackParse(prompt)) }] } }] });
    } });
    const api = createRuntime({ env: { SEARCH_FIXTURES: '1' }, ...(gemini ? { parser: new ParseService({ provider }) } : {}) });
    for (const prompt of prompts) {
      const parsed = ParseResponseSchema.parse(await (await api.parse(request('search/parse', { prompt }), undefined)).json()); assert.equal(parsed.parser, gemini ? 'gemini' : 'fallback');
      const result = SearchResponseSchema.parse(await (await api.search(request('listings/search', { intent: parsed.intent }), undefined)).json()); assert.equal(result.status, 'completed');
      if (result.status === 'completed' && (prompt === prompts[3] || prompt === prompts[5])) {
        assert.ok(result.results.length > 0, 'Representative student/family searches must return fixtures');
        const homes = result.results.map(r => r.listing);
        if (prompt === prompts[3]) assert.ok(homes.some(l => l.bedrooms === 0 && l.furnished === 'yes' && l.monthlyRentCad < 1300));
        else assert.ok(homes.some(l => l.bedrooms === 3 && l.parking === 'yes' && l.monthlyRentCad < 3200 && l.location.lng >= -79.30));
      }
      if (result.status === 'completed') for (const row of result.results.slice(0, 1)) {
        const intent = { ...parsed.intent, rawPrompt: '', fieldSources: {}, droppedRequests: [] };
        const detail = DetailResponseSchema.parse(await (await api.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(intent))), context(row.listing.id))).json()); assert.deepEqual(detail.matchScore, row.matchScore);
      }
    }
    const resolved = await (await api.resolve(request('geo/resolve?q=UofT%20St.%20George'), undefined)).json(); assert.equal(resolved.status, 'resolved'); assert.equal(resolved.destination.resolved.representativePoint, true);
  }
});
test('async API completion, incomplete routing, terminal consumption, unknown/restarted tokens', async () => {
  for (const complete of [false, true]) {
    const dependencies = { ...fixtureDependencies, ...(complete ? { routeTimes: async (origins: typeof sampleListings, targets: typeof travelIntent.travelTargets, mode: 'walk' | 'bike' | 'drive' | 'transit') => origins.flatMap(l => targets.map(t => ({ listingId: l.id, targetId: t.id, mode, distanceM: 100, minutes: 5, method: 'otp' as const, computedAt: l.lastSeenAt, poiId: null }))) } : {}) };
    const api = createRuntime({ env: {}, dependencies });
    const pending = SearchResponseSchema.parse(await (await api.search(request('listings/search', exact), undefined)).json()); assert.equal(pending.status, 'pending'); if (pending.status !== 'pending') return;
    assert.equal(pending.jobToken.length, 43); assert.ok(!pending.jobToken.includes('campus')); await tick();
    const ctx = { params: Promise.resolve({ token: pending.jobToken }) };
    const result = SearchResponseSchema.parse(await (await api.poll(request('jobs'), ctx)).json()); assert.equal(result.status, complete ? 'completed' : 'unavailable');
    assert.equal((await api.poll(request('jobs'), ctx)).status, 410);
    const fresh = createRuntime({ env: {} }); assert.equal((await fresh.poll(request('jobs'), ctx)).status, 410); api.jobs.dispose();
  }
});
test('ordinary routing and detail share validated actual travel/score, ignoring other listing rows', async () => {
  const api = createRuntime({ env: {}, dependencies: { ...fixtureDependencies,
    enrich: async (listing, intent) => ({ ...await fixtureDependencies.enrich(listing, intent), travel: [{ listingId: sampleListings[7].id, targetId: 'wrong', mode: 'bike', minutes: 99, method: 'otp', distanceM: 100, computedAt: listing.lastSeenAt, poiId: null }] }),
    routeTimes: async (origins, targets, mode) => origins.flatMap(l => targets.map(t => ({ listingId: l.id, targetId: t.id, mode, minutes: mode === 'walk' ? 8 : 5, distanceM: 100, method: 'otp', computedAt: l.lastSeenAt, poiId: null }))),
  } });
  const result = SearchResponseSchema.parse(await (await api.search(request('listings/search', { intent: travelIntent }), undefined)).json()); assert.equal(result.status, 'completed'); if (result.status !== 'completed') return;
  const row = result.results.find(r => r.listing.id === sampleListings[0].id)!;
  const intent = { ...travelIntent, rawPrompt: '', fieldSources: {}, droppedRequests: [] };
  const detail = DetailResponseSchema.parse(await (await api.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(intent))), context(row.listing.id))).json());
  assert.ok(detail.travel.every(t => t.listingId === row.listing.id && t.minutes !== null)); assert.deepEqual(detail.travel, row.travel); assert.deepEqual(detail.matchScore, row.matchScore);
  const failedIntent = { ...intent, criteria: { bedrooms: { value: { min: 99 }, hard: true } }, travelTargets: intent.travelTargets.map(t => ({ ...t, maxMinutes: 1 })) };
  const failed = DetailResponseSchema.parse(await (await api.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(failedIntent))), context(sampleListings[1].id))).json());
  assert.ok(failed.travel.every(t => t.minutes !== null)); assert.deepEqual(failed.matchScore, scoreListing(failed.listing, failedIntent, { ...await fixtureDependencies.enrich(failed.listing, failedIntent), travel: failed.travel }));
  const stale = { ...sampleListings[0], status: 'stale' as const };
  const duplicate = { ...sampleListings[1], duplicateOf: stale.id };
  const staleApi = createRuntime({ dependencies: { ...fixtureDependencies, listings: [stale, duplicate], routeTimes: async (origins, targets, mode) => origins.flatMap(l => { assert.equal(l.status, 'stale'); return targets.map(t => ({ listingId: l.id, targetId: t.id, mode, minutes: 5, distanceM: 100, method: 'otp', computedAt: l.lastSeenAt, poiId: null })); }) } });
  const staleDetail = DetailResponseSchema.parse(await (await staleApi.detail(request('listings/x?intent='+encodeURIComponent(JSON.stringify(intent))), context(stale.id))).json());
  assert.equal(staleDetail.listing.status, 'stale'); assert.ok(staleDetail.travel.every(t => t.minutes === 5)); assert.deepEqual(staleDetail.duplicates, [duplicate]);
});
test('bounded jobs pending/capacity/failure/timeout abort/expiry without polling/restart', async () => {
  const jobs = new SearchJobs({ capacity: 1, executionMs: 10, ttlMs: 25 }); let signal: AbortSignal | undefined;
  const pending = jobs.start(async abort => { signal = abort; return new Promise(() => {}); }); assert.equal(pending.status, 'pending'); if (pending.status !== 'pending') return;
  assert.equal(jobs.poll(pending.jobToken).status, 'pending'); assert.equal(jobs.start(async () => { throw Error('unreachable'); }).status, 'unavailable');
  await new Promise(resolve => setTimeout(resolve, 15)); const result = jobs.poll(pending.jobToken); assert.equal(result.status, 'unavailable'); if (result.status === 'unavailable') assert.equal(result.reason, 'timeout'); assert.equal(signal?.aborted, true);
  const failed = jobs.start(async () => { throw Error('secret payload'); }); await tick(); if (failed.status === 'pending') assert.equal(jobs.poll(failed.jobToken).status, 'unavailable');
  const expired = jobs.start(async () => ({ status: 'completed', results: [], eligibleCount: 0, notices: [] })); await new Promise(resolve => setTimeout(resolve, 35));
  if (expired.status === 'pending') assert.throws(() => jobs.poll(expired.jobToken), /expired/);
  const next = jobs.start(async () => new Promise(() => {})); assert.equal(next.status, 'pending'); jobs.dispose(); if (next.status === 'pending') assert.throws(() => jobs.poll(next.jobToken), /expired/);
});
