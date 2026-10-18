import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fallbackParse, ParseService, DestinationResolver } from './index';
import { namedParkMentions } from './named-parks';
import { baseIntent } from '../../../../../packages/shared/fixtures/index';

test('named parks retain their full names and offsets without consuming nearby rental requirements', () => {
  for (const [prompt, name] of [
    ['near high park', 'high park'],
    ['High Park', 'High Park'],
    ['a studio near the High Park under $2500', 'High Park'],
    ['close to Trinity Bellwoods Park, with parking', 'Trinity Bellwoods Park'],
    ["within 10 minutes of Queen's Park", "Queen's Park"],
    ['around Riverdale Park East', 'Riverdale Park East'],
    ['near Rouge National Urban Park', 'Rouge National Urban Park'],
    ['near High Park Station', 'High Park Station'],
  ]) {
    const matches = namedParkMentions(prompt);
    assert.equal(matches.length, 1, prompt);
    assert.equal(matches[0].phrase, name, prompt);
    assert.equal(prompt.slice(matches[0].index, matches[0].index + name.length), name);
    const intent = fallbackParse(prompt);
    assert.deepEqual(intent.travelTargets.map(target => [target.kind, target.query]), [['place', name]], prompt);
    assert.equal(intent.fieldSources[`travelTargets.${intent.travelTargets[0].id}`].phrase, name);
  }
});

test('generic park requests remain amenity filters', () => {
  for (const prompt of ['near a park', 'near parks', 'nearby park', 'near the nearest park', 'near a public park', 'near large park', 'near any park', 'near the park', 'near a dog-friendly park']) {
    assert.deepEqual(namedParkMentions(prompt), [], prompt);
    const intent = fallbackParse(prompt);
    assert.equal(intent.travelTargets.length, 1, prompt);
    assert.equal(intent.travelTargets[0].kind, 'amenity');
    assert.equal(intent.travelTargets[0].category, 'park');
    assert.equal(intent.travelTargets[0].mode, 'walk');
  }
});

test('named parks coexist with generic amenities and keep their separate time limits', () => {
  const both = fallbackParse('under $2500 near High Park and a park and a school');
  assert.deepEqual(both.travelTargets.map(target => target.query ?? target.category), ['High Park', 'school', 'park']);
  assert.equal(both.criteria.rent?.value.max, 2500);
  const timed = fallbackParse('10 min walk to High Park and 20 min bike to Riverdale Park East');
  assert.deepEqual(timed.travelTargets.map(target => [target.query, target.mode, target.maxMinutes, target.hard]), [
    ['High Park', 'walk', 10, true], ['Riverdale Park East', 'bike', 20, true],
  ]);
});

test('disabled AI and AI that reduces a named park to an amenity both resolve the named place instead', async () => {
  const prompt = 'near high park under $2500';
  const mistaken = {
    ...structuredClone(baseIntent), rawPrompt: prompt,
    travelTargets: [{ id: 'target-1', kind: 'amenity', label: 'park', category: 'park', mode: 'walk', hard: false }],
    fieldSources: { 'travelTargets.target-1': { source: 'ai_prompt', phrase: 'park' } },
  };
  for (const provider of [undefined, { generateStructured: async <T>() => mistaken as T, generateText: async () => '' }]) {
    const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async url => {
      assert.equal(decodeURIComponent(new URL(String(url)).pathname), '/geocoding/high park.json');
      return Response.json({ features: [{ id: 'fixture-high-park', text: 'High Park', place_name: 'High Park, Toronto', relevance: 1, place_type: ['poi'], center: [-79.4, 43.65] }] });
    } });
    const result = await new ParseService({ provider, resolver }).parse({ prompt }, 'test');
    assert.equal(result.parser, 'fallback');
    assert.equal(result.intent.travelTargets.length, 1);
    assert.equal(result.intent.travelTargets[0].query, 'high park');
    assert.equal(result.intent.travelTargets[0].category, undefined);
    assert.equal(result.destinations[0].resolution.status, 'resolved');
    assert.equal(result.intent.criteria.rent?.value.max, 2500);
  }
});

test('named parks bypass neighbourhood centroids while other destinations retain area lookup', async () => {
  let areaLookups = 0;
  const resolver = new DestinationResolver({
    maptilerKey: 'test',
    areaLookup: async query => {
      areaLookups++;
      return { status: 'resolved', query, destination: { id: 'neighbourhood', label: 'Neighbourhood representative point', resolved: { lng: -79.4, lat: 43.65, source: 'known_place' } } };
    },
    fetch: async () => Response.json({ features: [{ id: 'fixture-park', place_name: 'High Park, Toronto', relevance: 1, place_type: ['poi'], center: [-79.4, 43.65] }] }),
  });
  const park = await resolver.resolve('High Park');
  assert.equal(park.status, 'resolved');
  if (park.status === 'resolved') assert.equal(park.destination.resolved.source, 'maptiler');
  assert.equal(areaLookups, 0);
  assert.equal((await resolver.resolve('unlisted neighbourhood')).status, 'resolved');
  assert.equal(areaLookups, 1);
});
