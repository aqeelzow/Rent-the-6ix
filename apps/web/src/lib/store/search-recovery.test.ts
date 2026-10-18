import assert from 'node:assert/strict';
import { test } from 'vitest';
import { baseIntent, searchFixture } from '@rentthe6ix/shared/fixtures';
import { needsReinterpretation, LAST_SEARCH_KEY, readLastSearch, writeLastSearch } from './persist';
import { parseAndSearch, restoreSearch, runSearch } from './actions';
import { createAppStore } from './store';
import { ParseService } from '../parse';

const prompt = 'near the cn tower';
const failed = {
  ...structuredClone(baseIntent), rawPrompt: prompt,
  droppedRequests: [{ phrase: prompt, reason: 'Basic parser could not identify supported constraints; edit filters or clarify.' }],
};

test('a previously saved failed CN Tower interpretation is parsed again and reaches search with its location', async () => {
  const parsed = await new ParseService().parse({ prompt }, 'test');
  const store = createAppStore();
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url) === '/api/search/parse') return Response.json(parsed);
    assert.equal(String(url), '/api/listings/search');
    const sent = JSON.parse(String(options?.body));
    assert.equal(sent.intent.travelTargets[0].resolved.source, 'known_place');
    assert.equal(sent.hideUnconfirmed, true);
    return Response.json(searchFixture);
  };
  await restoreSearch({ intent: failed, hideUnconfirmed: true }, { store, fetch });
  assert.deepEqual(calls, ['/api/search/parse', '/api/listings/search']);
  assert.equal(store.getState().status, 'ready');
  assert.equal(store.getState().intent?.travelTargets.length, 1);
  assert.deepEqual(store.getState().intent?.droppedRequests, []);
});

test('failed interpretations are not persisted over a usable last search, and old records remain recoverable', () => {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() { return items.size; },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: key => { items.delete(key); },
    clear: () => items.clear(),
  };
  const usable = { ...baseIntent, rawPrompt: 'under $2500', criteria: { rent: { value: { max: 2500 }, hard: true } } };
  writeLastSearch({ intent: usable, hideUnconfirmed: false }, storage);
  writeLastSearch({ intent: failed, hideUnconfirmed: false }, storage);
  assert.deepEqual(readLastSearch(storage)?.intent, usable);
  storage.setItem(LAST_SEARCH_KEY, JSON.stringify({ intent: failed, hideUnconfirmed: false, savedAt: new Date().toISOString() }));
  assert.equal(needsReinterpretation(readLastSearch(storage)!.intent), true);
});

test('renter edits and partially understood requests are preserved instead of being reparsed', async () => {
  const edited = { ...failed, criteria: { rent: { value: { max: 2500 }, hard: true } }, fieldSources: { 'criteria.rent': { source: 'user' as const } } };
  assert.equal(needsReinterpretation(failed), true);
  assert.equal(needsReinterpretation(edited), false);
  assert.equal(needsReinterpretation({ ...failed, droppedRequests: [{ phrase: 'quiet', reason: 'Clarify this preference.' }] }), false);
  const store = createAppStore();
  await restoreSearch({ intent: edited, hideUnconfirmed: false }, { store, fetch: async (url, options) => {
    assert.equal(String(url), '/api/listings/search');
    assert.deepEqual(JSON.parse(String(options?.body)).intent, edited);
    return Response.json(searchFixture);
  } });
  assert.deepEqual(store.getState().intent, edited);
});

test('a completely unrecognized request cannot run a citywide search or retain unrelated results', async () => {
  const store = createAppStore();
  store.setState({ results: searchFixture.status === 'completed' ? searchFixture.results : [], eligibleCount: 50, selectedListingId: 'old' });
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async url => {
    calls.push(String(url));
    assert.equal(String(url), '/api/search/parse');
    return Response.json({ intent: failed, parser: 'fallback', destinations: [] });
  };
  await parseAndSearch(prompt, { store, fetch });
  await runSearch({ store, fetch });
  assert.deepEqual(calls, ['/api/search/parse']);
  assert.equal(store.getState().status, 'idle');
  assert.deepEqual(store.getState().results, []);
  assert.equal(store.getState().eligibleCount, 0);
  assert.equal(store.getState().selectedListingId, null);
  assert.equal(store.getState().busySince, null);
});

test('old generic-park interpretations of named parks are reparsed while generic requests and renter edits are retained', async () => {
  const mistaken = {
    ...structuredClone(baseIntent), rawPrompt: 'near high park',
    travelTargets: [{ id: 'target-1', kind: 'amenity' as const, label: 'park', category: 'park' as const, mode: 'walk' as const, hard: false }],
    fieldSources: { 'travelTargets.target-1': { source: 'ai_prompt' as const, phrase: 'park' } },
  };
  assert.equal(needsReinterpretation(mistaken), true);
  assert.equal(needsReinterpretation({ ...mistaken, rawPrompt: 'near a park' }), false);
  assert.equal(needsReinterpretation({ ...mistaken, fieldSources: { 'travelTargets.target-1': { source: 'user' } } }), false);
  const corrected = {
    ...mistaken,
    travelTargets: [{ id: 'target-1', kind: 'place' as const, label: 'high park', query: 'high park', mode: 'walk' as const, hard: false, resolved: { lng: -79.4, lat: 43.65, source: 'maptiler' as const } }],
  };
  assert.equal(needsReinterpretation(corrected), false);
  assert.equal(needsReinterpretation({ ...corrected, travelTargets: [...corrected.travelTargets, mistaken.travelTargets[0]] }), false);
  const calls: string[] = [];
  await restoreSearch({ intent: mistaken, hideUnconfirmed: false }, { store: createAppStore(), fetch: async (url, options) => {
    calls.push(String(url));
    if (String(url) === '/api/search/parse') return Response.json({ intent: corrected, destinations: [], parser: 'fallback' });
    assert.equal(String(url), '/api/listings/search');
    assert.equal(JSON.parse(String(options?.body)).intent.travelTargets[0].query, 'high park');
    return Response.json(searchFixture);
  } });
  assert.deepEqual(calls, ['/api/search/parse', '/api/listings/search']);
});
