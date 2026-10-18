import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fallbackParse, ParseService, DestinationResolver } from './index';
import { possibleIntersections } from './intersections';

test('detects short street pairs without treating amenities or independent places as intersections', () => {
  for (const [prompt, phrase] of [
    ['near queens and adelaide', 'queens and adelaide'],
    ['concord and hallam', 'concord and hallam'],
    ['Apartments near Concord and Hallam under $2500', 'Concord and Hallam'],
    ['near Queen St W and Bathurst St', 'Queen St W and Bathurst St'],
    ['at St. Clair Avenue West & Bathurst Street, with parking', 'St. Clair Avenue West & Bathurst Street'],
  ]) assert.deepEqual(possibleIntersections(prompt), [phrase], prompt);
  for (const prompt of [
    'near parks and schools', 'near grocery and pharmacy', 'furnished and parking',
    'cats and dogs', 'apartments and condos', 'near Union Station and Eaton Centre',
    '10 min walk to Union Station and 20 min bike to Eaton Centre',
  ]) assert.deepEqual(possibleIntersections(prompt), [], prompt);
});

test('both basic and AI parsing suggest clarification for missing or unresolved intersection locations', async () => {
  for (const prompt of ['near queens and adelaide', 'invented and fictitious', 'Apartments near Invented and Fictitious under $2500']) {
    for (const provider of [undefined, { generateStructured: async <T>() => fallbackParse('under $2500') as T, generateText: async () => '' }]) {
      const result = await new ParseService({ provider }).parse({ prompt }, 'test');
      assert.ok(result.intent.droppedRequests.some(request => /Did you mean an intersection\?/.test(request.reason)), prompt);
      assert.ok(result.intent.travelTargets.every(target => !target.resolved));
      if (prompt.includes('$2500')) assert.equal(result.intent.criteria.rent?.value.max, 2500);
    }
  }
});

test('an unresolved AI destination gets clarification while a resolved full pair keeps its location', async () => {
  const prompt = 'near Invented and Fictitious';
  const interpretation = () => ({ ...fallbackParse(prompt), travelTargets: [{ id: 'target-1', kind: 'place', label: 'Invented and Fictitious', query: 'Invented and Fictitious', mode: 'walk', hard: false }], fieldSources: { 'travelTargets.target-1': { source: 'ai_prompt', phrase: 'Invented and Fictitious' } } });
  for (const resolved of [false, true]) {
    const result = await new ParseService({
      provider: { generateStructured: async <T>() => interpretation() as T, generateText: async () => '' },
      resolver: new DestinationResolver({ addressLookup: async query => resolved ? { status: 'resolved', query, destination: { id: 'verified', label: query, resolved: { lng: -79.43, lat: 43.67, source: 'address_points' } } } : undefined }),
    }).parse({ prompt }, 'test');
    assert.equal(result.intent.droppedRequests.some(request => /Did you mean an intersection\?/.test(request.reason)), !resolved);
    assert.equal(!!result.intent.travelTargets[0].resolved, resolved);
  }
});

test('catalogued intersections resolve locally without an unnecessary clarification', async () => {
  const result = await new ParseService().parse({ prompt: 'near Concord and Hallam' }, 'catalogued-intersection');
  assert.equal(result.destinations[0].resolution.status, 'resolved');
  assert.ok(!result.intent.droppedRequests.some(request => /Did you mean an intersection\?/.test(request.reason)));
});
