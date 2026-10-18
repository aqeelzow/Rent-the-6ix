import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fallbackParse, ParseService, MemoryCache, configuredAreas } from './index';
import { cleanAIIntent } from './clean';
import { civicAreasLookup, civicAreasStatement } from './civic-areas-db';
import type { CivicArea } from './civic-areas';
const areas: CivicArea[] = [
  { kind: 'neighbourhood', id: '095', name: 'Annex', number: 95 },
  { kind: 'ward', id: '01', name: 'Etobicoke North', number: 1 },
  { kind: 'neighbourhood', id: '001', name: 'Shared Name', number: 1 },
  { kind: 'ward', id: '02', name: 'Shared Name', number: 2 },
];
test('fallback uses exact civic names and explicit ward numbers without guessing destination areas', () => {
  for (const prompt of ['in Annex', 'in the Annex', 'Annex', 'in neighbourhood Annex']) assert.deepEqual(fallbackParse(prompt, undefined, areas).areas, [{ kind: 'neighbourhood', id: '095' }]);
  assert.deepEqual(fallbackParse('in ward 01 under $2000', undefined, areas).areas, [{ kind: 'ward', id: '01' }]);
  assert.deepEqual(fallbackParse('in Etobicoke North', undefined, areas).areas, [{ kind: 'ward', id: '01' }]);
  for (const prompt of ['near Annex', '10 min walk to Annex', 'near ward 01', 'near ward Etobicoke North', 'not in Annex', 'under $2000', 'in Annexation', 'in ward Annex']) assert.deepEqual(fallbackParse(prompt, undefined, areas).areas, [], prompt);
  const ambiguous = fallbackParse('in Shared Name', undefined, areas);
  assert.equal(ambiguous.areas.length, 0); assert.match(ambiguous.droppedRequests[0].reason, /ambiguous/);
  assert.deepEqual(fallbackParse('in ward Shared Name', undefined, areas).areas, [{ kind: 'ward', id: '02' }]);
  assert.equal(fallbackParse('in downtown', undefined, areas).areas[0].kind, 'configured');
});
test('AI civic IDs require exact catalogue identity and evidence for that actual name or ward number', () => {
  const prompt = 'in Annex under $2000';
  for (const [area, phrase, accepted] of [
    [{ kind: 'neighbourhood', id: '095' }, 'in Annex', true],
    [{ kind: 'neighbourhood', id: '095' }, 'under $2000', false],
    [{ kind: 'ward', id: '01' }, 'in Annex', false],
    [{ kind: 'neighbourhood', id: '95' }, 'in Annex', false],
  ] as const) {
    const intent = fallbackParse(prompt); intent.areas = [area]; intent.fieldSources.areas = { source: 'ai_prompt', phrase };
    assert.equal(cleanAIIntent(intent, prompt, areas).areas.length, accepted ? 1 : 0);
  }
  const configured = fallbackParse('in downtown');
  assert.equal(cleanAIIntent(configured, 'in downtown', areas).areas.length, 1);
  const inventedConfigured = fallbackParse(prompt); inventedConfigured.areas = [configuredAreas.downtown]; inventedConfigured.fieldSources.areas = { source: 'ai_prompt', phrase: 'Annex' };
  assert.equal(cleanAIIntent(inventedConfigured, prompt, areas).areas.length, 0);
  for (const prompt of ['near Annex', 'in Shared Name']) {
    const intent = fallbackParse(prompt); intent.areas = [{ kind: 'neighbourhood', id: prompt.includes('Annex') ? '095' : '001' }]; intent.fieldSources.areas = { source: 'ai_prompt', phrase: prompt };
    assert.equal(cleanAIIntent(intent, prompt, areas).areas.length, 0);
  }
});
test('parse input includes authoritative catalogue and known labels; catalogue changes isolate cache', async () => {
  let calls = 0, catalogue = areas;
  const service = new ParseService({ cache: new MemoryCache(), civicAreas: async () => catalogue, provider: {
    generateStructured: async <T>(request: { system: string }) => {
      calls++; assert.match(request.system, /"id":"095"/); assert.match(request.system, /UofT St\. George campus representative point/);
      return fallbackParse('in Annex', undefined, catalogue) as T;
    }, generateText: async () => '',
  } });
  assert.equal((await service.parse({ prompt: 'in Annex' }, 'test')).intent.areas[0].kind, 'neighbourhood');
  await service.parse({ prompt: 'in Annex' }, 'test'); assert.equal(calls, 1);
  catalogue = [...areas, { kind: 'ward', id: '03', name: 'New Area', number: 3 }];
  await service.parse({ prompt: 'in Annex' }, 'test'); assert.equal(calls, 2);
});
test('catalogue read validates rows, bounds latency, shares unfinished reads and caches validated results', async () => {
  let calls = 0;
  const lookup = civicAreasLookup(() => ({ unsafe: async statement => { calls++; assert.equal(statement, civicAreasStatement); return areas; } }));
  assert.deepEqual(await lookup(), areas); assert.deepEqual(await lookup(), areas); assert.equal(calls, 1);
  for (const result of [[{ ...areas[0], id: '' }], [areas[0], areas[0]]]) assert.deepEqual(await civicAreasLookup(() => ({ unsafe: async () => result }))(), []);
  assert.deepEqual(await civicAreasLookup(() => ({ unsafe: async () => { throw Error('private DB'); } }))(), []);
  assert.deepEqual(await civicAreasLookup(() => null)(), []);
  let finish!: (value: unknown) => void;
  calls = 0;
  const slow = civicAreasLookup(() => ({ unsafe: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }), 5);
  assert.deepEqual(await slow(), []); assert.deepEqual(await slow(), []); assert.equal(calls, 1);
  finish(areas); await new Promise(resolve => setTimeout(resolve, 0)); assert.deepEqual(await slow(), areas);
});
test('omitted grounded area is added deterministically and unavailable catalogue stays visible', async () => {
  const provider = { generateStructured: async <T>() => fallbackParse('under $2500') as T, generateText: async () => '' };
  const parsed = await new ParseService({ civicAreas: async () => areas, provider }).parse({ prompt: 'under $2500 in Annex' }, 'test');
  // The area is a keyword fact; it is restored on the AI interpretation instead of rejecting it.
  assert.equal(parsed.parser, 'gemini'); assert.deepEqual(parsed.intent.areas, [{ kind: 'neighbourhood', id: '095' }]);
  const ambiguous = await new ParseService({ civicAreas: async () => areas, provider }).parse({ prompt: 'in Shared Name under $2500' }, 'test');
  assert.equal(ambiguous.parser, 'fallback'); assert.ok(ambiguous.intent.droppedRequests.some(d => /ambiguous/.test(d.reason)));
  const unavailable = await new ParseService({ civicAreas: async () => [] }).parse({ prompt: 'under $2500 in Annex' }, 'test');
  assert.match(unavailable.notice!, /catalogue unavailable/);
});
