import assert from 'node:assert/strict';
import { test } from 'vitest';
import { baseIntent } from '../../../../../packages/shared/fixtures/index';
import { TravelTargetSchema } from '../../../../../packages/shared/schemas/index';
import { GeminiProvider, providerFromEnv } from '../ai';
import { databaseIntentCache } from './db-cache';
import { DestinationResolver, ParseService } from './index';

const prompt = '2 bedrooms under $2800, within 20 min walk to ROM';
const interpretation = () => ({
  ...structuredClone(baseIntent), rawPrompt: prompt,
  travelTargets: [{ id: 'target-1', kind: 'place' as const, label: 'ROM', query: 'ROM', normalizedQuery: 'Royal Ontario Museum', mode: 'walk' as const, maxMinutes: 20, hard: true,
    resolved: { lng: 1, lat: 1, source: 'known_place' as const } }],
  fieldSources: { 'travelTargets.target-1': { source: 'ai_prompt' as const, phrase: 'ROM' } },
});
const feature = (id: string) => ({ id, place_name: `Royal Ontario Museum ${id}`, relevance: 1, place_type: ['poi'], center: [-79.394, 43.667] });

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
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [feature('east'), feature('west')] }) });
  const result = await resolver.resolve('ROM', 'Royal Ontario Museum');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.query, 'ROM');
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
