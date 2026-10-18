import assert from 'node:assert/strict';
import { test } from 'vitest';
import { baseIntent, searchFixture } from '@rentthe6ix/shared/fixtures';
import type { DestinationResolution, SearchIntent } from './types';
import { createAppStore } from './store';
import { parseAndSearch, restoreSearch, runSearch } from './actions';
import { chooseDestination } from '../../components/search/filters';
import { DestinationResolver } from '../parse/resolve';

const choices = [
  { id: 'spadina', label: 'The Well, 16 Spadina Avenue', resolved: { lng: -79.3944, lat: 43.6433, source: 'maptiler' as const, representativePoint: true, label: 'The Well, 16 Spadina Avenue representative point' } },
  { id: 'downtown', label: 'The Well, Downtown', resolved: { lng: -79.3961, lat: 43.6429, source: 'maptiler' as const, representativePoint: true, label: 'The Well, Downtown representative point' } },
];
const resolution: DestinationResolution = { status: 'ambiguous', query: 'the well', choices };
const intent: SearchIntent = {
  ...structuredClone(baseIntent), rawPrompt: 'under $2500 near the well',
  criteria: { rent: { value: { max: 2500 }, hard: true } },
  travelTargets: [{ id: 'well', kind: 'place', label: 'the well', query: 'the well', normalizedQuery: 'The Well, Toronto', mode: 'walk', maxMinutes: 15, hard: true }],
};

test('parsed POI choices pause listings, survive retries, and search with the selected location', async () => {
  const store = createAppStore();
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url) === '/api/search/parse') return Response.json({ intent, parser: 'gemini', destinations: [{ targetId: 'well', resolution }] });
    assert.equal(String(url), '/api/listings/search');
    const sent = JSON.parse(String(init?.body)).intent;
    assert.deepEqual(sent.criteria, intent.criteria);
    assert.deepEqual(sent.travelTargets[0], { ...intent.travelTargets[0], label: choices[1].label, resolved: choices[1].resolved });
    assert.equal(sent.fieldSources['travelTargets.well'].source, 'user');
    return Response.json(searchFixture);
  };
  await parseAndSearch(intent.rawPrompt, { store, fetch });
  assert.deepEqual(calls, ['/api/search/parse']);
  assert.equal(store.getState().status, 'choosing');
  assert.equal(store.getState().busySince, null);
  assert.equal(store.getState().intent?.travelTargets[0].resolved, undefined);
  assert.deepEqual(store.getState().destinations[0].resolution, resolution);
  await runSearch({ store, fetch });
  assert.deepEqual(calls, ['/api/search/parse']);
  store.getState().updateIntent(current => chooseDestination(current, 'well', choices[1]));
  await runSearch({ store, fetch });
  assert.deepEqual(calls, ['/api/search/parse', '/api/listings/search']);
  assert.equal(store.getState().status, 'ready');
});

test('every ambiguous destination needs a selection or removal before listings are searched', async () => {
  const store = createAppStore();
  store.setState({
    intent: { ...intent, travelTargets: [intent.travelTargets[0], { ...intent.travelTargets[0], id: 'second' }] },
    destinations: [{ targetId: 'well', resolution }, { targetId: 'second', resolution }],
    results: searchFixture.status === 'completed' ? searchFixture.results : [],
    eligibleCount: 50, selectedListingId: 'old', hoveredListingId: 'old',
  });
  let searches = 0;
  const fetch: typeof globalThis.fetch = async url => {
    assert.equal(String(url), '/api/listings/search');
    searches++;
    return Response.json(searchFixture);
  };
  await runSearch({ store, fetch });
  assert.equal(store.getState().status, 'choosing');
  assert.deepEqual(store.getState().results, []);
  assert.equal(store.getState().selectedListingId, null);
  assert.equal(store.getState().hoveredListingId, null);
  store.getState().updateIntent(current => chooseDestination(current, 'well', choices[0]));
  await runSearch({ store, fetch });
  assert.equal(store.getState().status, 'choosing');
  assert.equal(searches, 0);
  store.getState().updateIntent(current => ({ ...current, travelTargets: current.travelTargets.filter(target => target.id !== 'second') }));
  await runSearch({ store, fetch });
  assert.equal(searches, 1);
  assert.equal(store.getState().status, 'ready');
});

test('a restored unresolved place also pauses when its lookup finds several candidates', async () => {
  const store = createAppStore();
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async url => {
    calls.push(String(url));
    assert.match(String(url), /^\/api\/geo\/resolve\?q=the%20well$/);
    return Response.json(resolution);
  };
  await restoreSearch({ intent, hideUnconfirmed: false }, { store, fetch });
  assert.equal(store.getState().status, 'choosing');
  assert.equal(store.getState().destinations[0].resolution.status, 'ambiguous');
  await runSearch({ store, fetch });
  assert.equal(calls.length, 1);
});

test('one lower-score POI suggestion passes browser validation and waits for explicit confirmation', async () => {
  const store = createAppStore();
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [
    { id: 'spadina', text: 'The Well', place_name: choices[0].label, relevance: 0.75, place_type: ['poi'], center: [-79.3944, 43.6433] },
  ] }) });
  const suggestion = await resolver.resolve('the well');
  let searches = 0;
  const fetch: typeof globalThis.fetch = async url => {
    if (String(url) === '/api/search/parse') return Response.json({ intent, parser: 'gemini', destinations: [{ targetId: 'well', resolution: suggestion }] });
    assert.equal(String(url), '/api/listings/search');
    searches++;
    return Response.json(searchFixture);
  };
  await parseAndSearch(intent.rawPrompt, { store, fetch });
  assert.equal(store.getState().status, 'choosing');
  assert.equal(searches, 0);
  assert.equal(suggestion.status, 'ambiguous');
  if (suggestion.status !== 'ambiguous') throw new Error('Expected confirmation choice');
  assert.equal(suggestion.choices.length, 1);
  store.getState().updateIntent(current => chooseDestination(current, 'well', suggestion.choices[0]));
  await runSearch({ store, fetch });
  assert.equal(searches, 1);
  assert.equal(store.getState().status, 'ready');
});
