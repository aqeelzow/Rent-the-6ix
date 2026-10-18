import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DestinationResolutionSchema } from '../../../../../packages/shared/schemas/index';
import { DestinationResolver } from './resolve';

const well = { id: 'well', text: 'The Well', place_name: 'The Well, 16 Spadina Avenue, Toronto', relevance: 0.745926, place_type: ['poi'], center: [-79.3944, 43.6433] };

test('a failed normalization retries the exact original once, retains its qualifiers, and caches the result', async () => {
  const calls: string[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];
  let addressLookups = 0;
  const resolver = new DestinationResolver({
    maptilerKey: 'test', addressLookup: async () => { addressLookups++; return undefined; },
    fetch: async (url, options) => {
      const parsed = new URL(String(url));
      calls.push(decodeURIComponent(parsed.pathname));
      signals.push(options?.signal);
      assert.equal(parsed.searchParams.get('bbox'), '-79.65,43.58,-79.1,43.87');
      assert.equal(parsed.searchParams.get('country'), 'ca');
      return Response.json({ features: calls.length === 1 ? [] : [{ ...well, relevance: 1 }] });
    },
  });
  const query = 'The Well on Wellington Street';
  const result = await resolver.resolve(query, 'Unhelpful normalization, Toronto');
  assert.equal(result.status, 'resolved');
  assert.equal(result.query, query);
  assert.deepEqual(calls, ['/geocoding/Unhelpful normalization, Toronto.json', '/geocoding/The Well on Wellington Street.json']);
  assert.equal(signals[0], signals[1]);
  assert.equal(addressLookups, 1);
  assert.deepEqual(await resolver.resolve(query, 'Unhelpful normalization, Toronto'), result);
  assert.equal(calls.length, 2);
});

test('a lower-score exact POI name is a confirmation choice, never an automatic pin', async () => {
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [
    well,
    { ...well, id: 'bar', text: 'The Well Bar Restaurant', place_name: 'The Well Bar Restaurant, Queen Street West, Toronto', relevance: 0.77 },
    { ...well, id: 'weld', text: 'The Weld Building', relevance: 0.75 },
  ] }) });
  const result = DestinationResolutionSchema.parse(await resolver.resolve('the well'));
  assert.equal(result.status, 'ambiguous');
  if (result.status === 'ambiguous') assert.deepEqual(result.choices.map(choice => choice.id), ['well']);
});

test('exact POI names outrank high-scoring similarly named businesses across both searches', async () => {
  let calls = 0;
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => {
    calls++;
    return Response.json({ features: [
      { ...well, relevance: calls === 1 ? 0.745926 : 1 },
      { ...well, id: 'bar', text: 'The Well Bar Restaurant', place_name: 'The Well Bar Restaurant, Queen Street West, Toronto', relevance: 1 },
      { ...well, id: 'wellington', text: 'The Wellington', relevance: 1 },
      { ...well, id: 'wellesdale', text: 'The Wellesdale', relevance: 1 },
    ] });
  } });
  const result = await resolver.resolve('the well', 'The Well, Wellington Street, Toronto');
  assert.equal(calls, 2);
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') assert.equal(result.destination.id, 'well');
});

test('original wording can recover strong matches before offering lower-score normalized candidates', async () => {
  let calls = 0;
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => {
    calls++;
    return Response.json({ features: [{ ...well, relevance: calls === 1 ? 0.745926 : 1 }] });
  } });
  const result = await resolver.resolve('the well', 'The Well, Wellington Street, Toronto');
  assert.equal(calls, 2);
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') assert.equal(result.destination.id, 'well');
});

test('suggestions survive an empty or failed retry, and duplicate POIs do not create extra choices', async () => {
  for (const retry of ['empty', 'duplicate', 'http', 'network', 'malformed']) {
    let calls = 0;
    const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => {
      calls++;
      if (calls === 1) return Response.json({ features: [well] });
      if (retry === 'http') return new Response('', { status: 503 });
      if (retry === 'network') throw new Error('network');
      if (retry === 'malformed') return Response.json({ features: [{ ...well, center: [900, 0] }] });
      return Response.json({ features: retry === 'duplicate' ? [well] : [] });
    } });
    const result = await resolver.resolve('the well', 'The Well, Wellington Street, Toronto');
    assert.equal(calls, 2);
    assert.equal(result.status, 'ambiguous');
    if (result.status === 'ambiguous') assert.equal(result.choices.length, 1);
  }
});

test('weak names, unsupported types, explicit qualifiers, missing scores and locations outside Toronto cannot become suggestions', async () => {
  for (const [query, features] of [
    ['the well', [{ ...well, relevance: 0.69 }]],
    ['the well', [{ ...well, relevance: undefined }]],
    ['the well', [{ ...well, place_type: ['road'] }]],
    ['the well', [{ ...well, text: undefined, place_name: 'The Well Bar Restaurant, Toronto' }]],
    ['the well', [{ ...well, text: undefined, place_name: 'Wellington Street, Toronto' }]],
    ['The Well on Wellington Street', [well]],
    ['The Well, Ottawa', [well]],
    ['the well', [{ ...well, relevance: 1, center: [-75.7, 45.4] }]],
  ] as const) {
    const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features }) });
    assert.equal((await resolver.resolve(query)).status, 'unavailable', query);
  }
});

test('lower-score POI labels can match without text metadata, while stronger alternatives still need a choice', async () => {
  for (const text of [well.text, undefined]) {
    const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [
      { ...well, text }, { ...well, id: 'second', relevance: 0.95 },
    ] }) });
    const result = await resolver.resolve('The Well, Toronto');
    assert.equal(result.status, 'ambiguous');
    if (result.status === 'ambiguous') assert.deepEqual(result.choices.map(choice => choice.id), ['second', 'well']);
  }
});

test('identical query text and strong first responses do not trigger retries', async () => {
  for (const normalizedQuery of [undefined, 'THE WELL', 'The Well, Toronto']) {
    let calls = 0;
    const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => {
      calls++;
      return Response.json({ features: [{ ...well, relevance: normalizedQuery === 'The Well, Toronto' ? 1 : 0.75 }] });
    } });
    assert.equal((await resolver.resolve('the well', normalizedQuery)).status, normalizedQuery === 'The Well, Toronto' ? 'resolved' : 'ambiguous');
    assert.equal(calls, 1);
  }
});

test('failed geocoding makes at most two calls and shares one deadline across both', async () => {
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  const resolver = new DestinationResolver({ maptilerKey: 'test', timeoutMs: 15, fetch: async (_url, options) => {
    calls++;
    signal = options?.signal;
    if (calls === 1) return Response.json({ features: [] });
    return new Promise(() => {});
  } });
  const result = await resolver.resolve('unmatched original', 'unmatched normalization');
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') assert.equal(result.reason, 'Destination lookup timed out.');
  assert.equal(calls, 2);
  assert.equal(signal?.aborted, true);
});

test('malformed candidate identities fail gracefully before conversion to destination choices', async () => {
  for (const feature of [{ ...well, id: '' }, { ...well, place_name: ' ' }]) {
    const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [feature] }) });
    assert.equal((await resolver.resolve('the well')).status, 'unavailable');
  }
});
