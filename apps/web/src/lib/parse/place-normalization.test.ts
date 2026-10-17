import assert from 'node:assert/strict';
import { test } from 'vitest';
import { baseIntent } from '../../../../../packages/shared/fixtures/index';
import { TravelTargetSchema } from '../../../../../packages/shared/schemas/index';
import { GeminiProvider, providerFromEnv } from '../ai';
import { databaseIntentCache } from './db-cache';
import { DestinationResolver, ParseService } from './index';
import { placePins } from '../../components/map/map-data';

const prompt = '2 bedrooms under $2800, within 20 min walk to ROM';
const interpretation = () => ({
  ...structuredClone(baseIntent), rawPrompt: prompt,
  travelTargets: [{ id: 'target-1', kind: 'place' as const, label: 'ROM', query: 'ROM', normalizedQuery: 'Royal Ontario Museum', mode: 'walk' as const, maxMinutes: 20, hard: true,
    resolved: { lng: 1, lat: 1, source: 'known_place' as const } }],
  fieldSources: { 'travelTargets.target-1': { source: 'ai_prompt' as const, phrase: 'ROM' } },
});
const feature = (id: string) => ({ id, place_name: `Royal Ontario Museum ${id}`, relevance: 1, place_type: ['poi'], center: [-79.394, 43.667] });

test('CN Tower resolves to a map pin without ambiguous geocoder attractions', async () => {
  for (const query of ['CN Tower', 'the CN Tower']) {
    const rawPrompt = `near ${query}`;
    const parser = new ParseService({
      provider: new GeminiProvider({ apiKey: 'test', model: 'test', fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        ...structuredClone(baseIntent), rawPrompt,
        travelTargets: [{ id: 'target-1', kind: 'place', label: query, query, mode: 'walk', hard: false }],
        fieldSources: { 'travelTargets.target-1': { source: 'ai_prompt', phrase: query } },
      }) }] } }] }) }),
      resolver: new DestinationResolver(),
    });
    const result = await parser.parse({ prompt: rawPrompt }, 'cn-tower-regression');
    assert.equal(result.parser, 'gemini');
    assert.equal(result.destinations[0].resolution.status, 'resolved');
    const pins = placePins(result.intent.travelTargets);
    assert.equal(pins.length, 1);
    assert.equal(pins[0].label, query);
    assert.ok(Math.abs(pins[0].lng + 79.3871) < 0.001);
    assert.ok(Math.abs(pins[0].lat - 43.6426) < 0.001);
  }
});

test('canonical campus labels and bare UofT resolve to the same known point without a geocoder', async () => {
  const resolver = new DestinationResolver();
  for (const query of ['uoft', 'UofT St. George campus', 'UofT St. George campus representative point']) {
    const result = await resolver.resolve(query);
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') assert.equal(result.destination.id, 'uoft-st-george');
  }
  const specific = await resolver.resolve('UofT Scarborough campus');
  assert.equal(specific.status, 'resolved');
  if (specific.status === 'resolved') assert.equal(specific.destination.id, 'uoft-scarborough');
});

test('Gemini normalization reaches geocoding while original evidence survives and model coordinates are discarded', async () => {
  const parser = new ParseService({
    provider: new GeminiProvider({ apiKey: 'test', model: 'test', fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(interpretation()) }] } }] }) }),
    resolver: new DestinationResolver({ maptilerKey: 'test', fetch: async url => {
      assert.equal(decodeURIComponent(new URL(String(url)).pathname), '/geocoding/Royal Ontario Museum.json');
      assert.ok(new URL(String(url)).searchParams.get('types')?.split(',').includes('poi'));
      return Response.json({ features: [feature('museum')] });
    } }),
  });
  const result = await parser.parse({ prompt }, 'test');
  assert.equal(result.parser, 'gemini');
  const target = result.intent.travelTargets[0];
  assert.equal(target.query, 'ROM');
  assert.equal(result.intent.fieldSources['travelTargets.target-1'].phrase, 'ROM');
  assert.equal(target.label, 'Royal Ontario Museum museum');
  assert.equal(target.resolved?.source, 'maptiler');
  assert.equal(target.resolved?.lng, -79.394);
  assert.equal(result.destinations[0].resolution.query, 'ROM');
});

test('normalized names retain campus ambiguity and cannot override known original places', async () => {
  // The picker mode, because a bare university resolves to its main campus by default (parse.test.ts).
  const resolver = new DestinationResolver({ preferPrimaryCampus: false });
  for (const [original, hint] of [['University of Toronto', 'UofT St. George'], ['the university', 'University of Toronto']]) {
    const result = await resolver.resolve(original, hint);
    assert.equal(result.status, 'ambiguous');
    if (result.status === 'ambiguous') assert.equal(result.choices.length, 3);
  }
  const known = await resolver.resolve('Union Station', 'Eaton Centre');
  assert.equal(known.status, 'resolved');
  if (known.status === 'resolved') assert.equal(known.destination.id, 'union-station');
});

test('normalized geocoder results preserve multiple choices and the original query', async () => {
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [feature('east'), { ...feature('west'), center: [-79.5, 43.667] }] }) });
  const result = await resolver.resolve('ROM', 'Royal Ontario Museum');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.query, 'ROM');
});

test('strong fuzzy station matches in the same area resolve to the first ranked representative point', async () => {
  const north = { id: 'north', place_name: 'Queen Station North area Concourse', relevance: 0.964286, place_type: ['address'], center: [-79.379822, 43.653594] };
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [
    north,
    { ...north, id: 'northbound', center: [-79.379055, 43.652473] },
    { ...north, id: 'southbound', center: [-79.379526, 43.652383] },
    { ...north, id: 'unrelated', relevance: 0.656667, center: [-79.305038, 43.669178] },
  ] }) });
  const result = await resolver.resolve('queens station');
  assert.equal(result.status, 'resolved');
  assert.equal(result.query, 'queens station');
  if (result.status === 'resolved') {
    assert.equal(result.destination.id, 'north');
    assert.equal(result.destination.resolved.lng, north.center[0]);
    assert.equal(result.destination.resolved.representativePoint, true);
  }
});

test('nearby exact matches resolve together, but separated fuzzy matches remain ambiguous', async () => {
  const nearby = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [feature('entrance'), { ...feature('tickets'), center: [-79.3945, 43.6675] }] }) });
  const resolved = await nearby.resolve('museum');
  assert.equal(resolved.status, 'resolved');
  if (resolved.status === 'resolved') assert.equal(resolved.destination.id, 'entrance');
  const distant = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [
    { ...feature('east'), relevance: 0.96 },
    { ...feature('west'), relevance: 0.95, center: [-79.5, 43.667] },
  ] }) });
  assert.equal((await distant.resolve('museum')).status, 'ambiguous');
});

test('exact matches take precedence and weak or unscored results cannot become pins', async () => {
  const exact = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [
    { ...feature('fuzzy'), relevance: 0.96, center: [-79.5, 43.667] }, feature('exact'),
  ] }) });
  const resolved = await exact.resolve('museum');
  assert.equal(resolved.status, 'resolved');
  if (resolved.status === 'resolved') assert.equal(resolved.destination.id, 'exact');
  for (const relevance of [0.89, undefined]) {
    const weak = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [{ ...feature('weak'), relevance }] }) });
    assert.equal((await weak.resolve('museum')).status, 'unavailable');
  }
});

test('normalization needs an evidenced original place and never enters persistent parse storage', async () => {
  let writes = 0;
  const input = interpretation();
  await databaseIntentCache(() => ({ unsafe: async () => { writes++; return []; } })).set('key', prompt, input);
  assert.equal(writes, 0);
  assert.equal(TravelTargetSchema.safeParse({ ...input.travelTargets[0], query: undefined, resolved: undefined }).success, false);
  assert.equal(TravelTargetSchema.safeParse({ id: 'park', kind: 'amenity', label: 'Park', category: 'park', mode: 'walk', hard: false, normalizedQuery: 'High Park' }).success, false);
  const invented = interpretation(); invented.travelTargets[0].query = 'invented place';
  const parser = new ParseService({ provider: { generateStructured: async <T>() => invented as T, generateText: async () => '' } });
  const result = await parser.parse({ prompt }, 'test');
  assert.equal(result.parser, 'fallback');
  assert.ok(result.intent.travelTargets.every(target => !target.normalizedQuery));
});

test.skipIf(process.env.RUN_LIVE_PLACE_NORMALIZATION !== '1')('live Gemini extracts a new nickname and MapTiler verifies its location', async () => {
  process.loadEnvFile('.env.local');
  const parser = new ParseService({ provider: providerFromEnv(), resolver: new DestinationResolver({ maptilerKey: process.env.NEXT_PUBLIC_MAPTILER_KEY }) });
  const result = await parser.parse({ prompt }, 'live-place-normalization');
  assert.equal(result.parser, 'gemini', result.notice);
  const target = result.intent.travelTargets.find(target => target.query === 'ROM');
  assert.ok(target?.normalizedQuery);
  assert.match(target.normalizedQuery, /Royal Ontario Museum/i);
  assert.equal(target.resolved?.source, 'maptiler');
}, 10000);

test.skipIf(process.env.RUN_LIVE_MAPTILER_NORMALIZATION !== '1')('live MapTiler can verify a normalized public place name independently of Gemini', async () => {
  process.loadEnvFile('.env.local');
  assert.ok(process.env.NEXT_PUBLIC_MAPTILER_KEY);
  const result = await new DestinationResolver({ maptilerKey: process.env.NEXT_PUBLIC_MAPTILER_KEY }).resolve('ROM', 'Royal Ontario Museum');
  assert.notEqual(result.status, 'unavailable', result.status === 'unavailable' ? result.reason : undefined);
  const choices = result.status === 'resolved' ? [result.destination] : result.status === 'ambiguous' ? result.choices : [];
  assert.ok(choices.some(choice => /Royal Ontario Museum/i.test(choice.label) && Math.abs(choice.resolved.lng + 79.394) < 0.01 && Math.abs(choice.resolved.lat - 43.667) < 0.01));
}, 5000);
