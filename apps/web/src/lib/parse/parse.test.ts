import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseInstruction } from './instruction';
import { SearchIntentSchema } from '../../../../../packages/shared/schemas/index';
import { GeminiProvider, AIUnavailable, NoneProvider } from '../ai/index';
import { fallbackParse, ParseService, DestinationResolver, IpLimiter, RateLimitError, MemoryCache } from './index';

const local = [
  "I'm looking for houses or apartments around the university of toronto. Should be within 10 minutes biking distance. Around 3-5k per",
  "I work at TD Canada on bay st and queens st w. I'm looking for a place to commute, bike, or walk to work, and it should take no longer than 10 minutes.",
  "I'm on a budget. I wanna live in downtown at the cheapest cost",
];
const demos = [
  'Room or studio near York University under $1,300, close to the subway, furnished.',
  'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.',
  '3 bedrooms in Scarborough under $3,200, near a public school and a park, parking.',
];
test('all six acceptance prompts parse and do not infer unstated criteria', async () => {
  for (const prompt of [...local, ...demos]) assert.equal(SearchIntentSchema.safeParse(fallbackParse(prompt)).success, true);
  const one = fallbackParse(local[0]); assert.deepEqual(one.criteria.rent, { value: { min: 3000, max: 5000 }, hard: false }); assert.equal(one.travelTargets[0].mode, 'bike'); assert.equal(one.travelTargets[0].maxMinutes, 10); assert.equal(one.travelTargets[0].hard,true); assert.equal(one.criteria.bedrooms, undefined);
  const two = fallbackParse(local[1]); assert.deepEqual(new Set([two.travelTargets[0].mode, ...two.travelTargets[0].alternativeModes!]), new Set(['transit','bike','walk'])); assert.deepEqual(two.criteria, {}); assert.equal(two.household, undefined);
  const three = fallbackParse(local[2]); assert.equal(three.sortBy, 'lowest_rent'); assert.equal(three.areas[0].kind, 'configured');
  const student = fallbackParse(demos[0]); assert.deepEqual(student.criteria.unitTypes?.value, ['room', 'studio']); assert.equal(student.criteria.bedrooms, undefined); assert.equal(student.criteria.furnished?.value, true);
  const couple = fallbackParse(demos[1]); assert.deepEqual(couple.criteria.bedrooms?.value, { min: 2, max: 2 }); assert.equal(couple.criteria.rent?.value.max, 2800); assert.equal(couple.household?.annualIncomeCad, 95000); assert.equal(couple.travelTargets.length, 2); assert.equal(couple.travelTargets[0].maxMinutes, 25); assert.equal(couple.travelTargets[1].maxMinutes, undefined); assert.equal(couple.criteria.priceFairness?.hard, false);
  const family = fallbackParse(demos[2]); assert.equal(family.travelTargets.length, 2); assert.equal(family.areas[0].kind, 'configured');
  const service = new ParseService({ provider: new NoneProvider() });
  for (const prompt of [...local, ...demos]) { const response = await service.parse({ prompt }, 'trusted-ip'); assert.equal(response.parser, 'fallback'); }
});
test('home bounds, preferences, booleans, age, source evidence and safety remain explicit', () => {
  const intent = fallbackParse('Ideally 2 bathrooms, at least 750 sqft, built after 2010, central air, cats allowed, no parking, unfurnished, utilities not included.');
  assert.equal(intent.criteria.bathrooms?.hard, false); assert.equal(intent.criteria.sizeSqft?.value.min, 750); assert.equal(intent.criteria.buildingAge?.value.builtAfter, 2010); assert.equal(intent.criteria.airConditioning?.value, 'central'); assert.equal(intent.criteria.parking?.value, false); assert.equal(intent.criteria.furnished?.value, false); assert.equal(intent.criteria.utilitiesIncluded?.value, false);
  assert.equal(intent.fieldSources['criteria.bathrooms'].phrase, '2 bathrooms'); assert.deepEqual(intent.safety, { enabled: false, hard: false });
  assert.equal(fallbackParse('new build below city crime rate', new Date('2026-01-01')).criteria.buildingAge?.value.builtAfter, 2016);
  assert.equal(fallbackParse('new build below city crime rate').safety.hard, true);
});
test('percentiles, minima, travel selectors, independent destinations and clarification', () => {
  assert.deepEqual(fallbackParse('bottom 5% rent min 12 results').numericExtreme, { field:'rent', direction:'min', percentage:5, minimumCount:12 });
  for (const prompt of ['bottom 5% rent minimum 100 results', 'bottom 5% rent min 10 results', 'rent under 5%']) {
    assert.equal(fallbackParse(prompt).criteria.rent, undefined, prompt);
  }
  assert.equal(fallbackParse('bottom 5% rent minimum 100 results').numericExtreme?.minimumCount, 100);
  assert.equal(fallbackParse('top 5% largest').numericExtreme?.field, 'sizeSqft');
  assert.equal(fallbackParse('top 5% shortest travel to Union Station by bike').numericExtreme?.targetId, 'target-1');
  const multiple = fallbackParse('bottom 5% rent and top 10% size'); assert.equal(multiple.numericExtreme, undefined); assert.equal(multiple.droppedRequests.length, 2);
  assert.ok(fallbackParse('bottom 5%').droppedRequests.length); assert.ok(fallbackParse('spacious').droppedRequests.length);
  const independent = fallbackParse('10 min walk to Union Station and 20 min bike to Eaton Centre'); assert.equal(independent.travelTargets.length, 2); assert.equal(independent.travelTargets[0].maxMinutes, 10); assert.equal(independent.travelTargets[0].alternativeModes,undefined); assert.equal(independent.travelTargets[1].maxMinutes, 20); assert.equal(independent.travelTargets[1].mode, 'bike');
  assert.deepEqual(fallbackParse('rent at least $1,800').criteria.rent?.value, { min: 1800 });
});
test('rent parsing skips earlier bedroom, size and travel quantities', async () => {
  const service = new ParseService({ provider: new NoneProvider() });
  for (const prompt of [
    'At least 2 bedrooms, under $3000',
    'Budget for at least 2-bedroom apartments, under $3000',
    'At least 800 sqft and under $3000',
    'Under 30 years old and under $3000',
    'Within 15 minutes walk to Union Station and under $3000',
  ]) {
    const { intent } = await service.parse({ prompt }, 'rent-order-test');
    assert.deepEqual(intent.criteria.rent?.value, { max: 3000 }, prompt);
    assert.equal(intent.fieldSources['criteria.rent'].phrase, 'under $3000');
  }
  for (const prompt of [
    '2-3 bedrooms, $2000-$3000',
    '700-900 sqft, rent 2000-3000',
    'Budget for 2-3 bedrooms, $2000-$3000',
  ]) assert.deepEqual(fallbackParse(prompt).criteria.rent?.value, { min: 2000, max: 3000 }, prompt);
  for (const prompt of ['Budget 2 bedrooms', 'Budget for at least 2 bedrooms', 'Budget for 700-900 sqft']) {
    assert.equal(fallbackParse(prompt).criteria.rent, undefined, prompt);
  }
});
test('explicit static sorts and both building-age directions survive basic parsing', () => {
  const now = new Date('2026-10-17');
  for (const phrase of ['at most', 'maximum', 'under', 'no more than']) {
    assert.deepEqual(fallbackParse(`Apartments ${phrase} 20 years old`, now).criteria.buildingAge?.value, { builtAfter: 2006 });
  }
  for (const phrase of ['at least', 'minimum', 'over', 'older than', 'no less than']) {
    assert.deepEqual(fallbackParse(`Apartments ${phrase} 20 years old`, now).criteria.buildingAge?.value, { builtBefore: 2006 });
  }
  const preference = fallbackParse('Apartments, ideally at least 20 years old', now);
  assert.equal(preference.criteria.buildingAge?.hard, false);
  assert.equal(preference.fieldSources['criteria.buildingAge'].phrase, 'at least 20 years old');
  assert.equal(fallbackParse('Apartments at least 300 years old', now).droppedRequests.length, 1);
  assert.equal(fallbackParse('best value apartments').sortBy, 'best_value');
  assert.equal(fallbackParse('lowest true monthly cost near work').sortBy, 'lowest_true_cost');
  assert.equal(fallbackParse('shortest commute to Union Station').sortBy, 'shortest_trips');
  for (const phrase of ['newest listings', 'latest listings', 'most recently listed', 'newest first']) {
    const intent = fallbackParse(`${phrase} under $2500`);
    assert.equal(intent.sortBy, 'newest');
    assert.equal(intent.fieldSources.sortBy.phrase, phrase);
    assert.equal(intent.criteria.buildingAge, undefined);
  }
  const building = fallbackParse('top 5% newest apartments');
  assert.equal(building.numericExtreme?.field, 'buildingAge');
  assert.equal(building.sortBy, 'best_match');
});
test('known places ambiguity, representative labels and honest unknown business', async () => {
  const resolver = new DestinationResolver();
  const broad = await resolver.resolve('University of Toronto'); assert.equal(broad.status, 'ambiguous');
  const york = await resolver.resolve('York University'); assert.equal(york.status, 'ambiguous'); if (york.status === 'ambiguous') assert.equal(york.choices.length, 3);
  const specific = await resolver.resolve('UofT St. George'); assert.equal(specific.status, 'resolved'); if (specific.status === 'resolved') assert.equal(specific.destination.resolved.representativePoint, true);
  for (const query of ['TD', 'TD Canada', 'TD at Bay and King', 'TD at Queen Street West']) assert.equal((await resolver.resolve(query)).status, 'unavailable');
});
test('verified TD Bay and Queen aliases resolve without guessing other branches', async () => {
  const resolver = new DestinationResolver();
  for (const query of ['TD Canada on bay st and queens st w.', 'TD at Bay St. and Queen St. W.', 'TD on Bay Street and Queen Street W', 'TD Canada at Bay Street and Queens St W']) {
    const resolved = await resolver.resolve(query);
    assert.equal(resolved.status, 'resolved');
    if (resolved.status === 'resolved') {
      assert.equal(resolved.destination.id, 'td-bay-queen');
      assert.equal(resolved.destination.resolved.source, 'known_place');
      assert.equal(resolved.destination.resolved.representativePoint, true);
      assert.match(resolved.destination.label, /394 Bay St/);
    }
  }
  const result = await new ParseService({ provider: new NoneProvider(), resolver }).parse({ prompt: local[1] }, 'trusted-ip');
  assert.equal(result.intent.travelTargets.length, 1);
  assert.equal(result.destinations[0].resolution.status, 'resolved');
  assert.deepEqual(new Set([result.intent.travelTargets[0].mode, ...result.intent.travelTargets[0].alternativeModes!]), new Set(['transit', 'bike', 'walk']));
  assert.equal(result.intent.travelTargets[0].maxMinutes, 10);
});
test('Address Points before MapTiler, validated geocoding ambiguity/cache/timeout', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ features: [{ id: 'a', place_name: 'Toronto configured neighbourhood', relevance: 1, place_type: ['neighbourhood'], center: [-79.4,43.7] },{ id:'b',place_name:'second',relevance:1,center:[-79.3,43.8] }] }); };
  const resolver = new DestinationResolver({ addressLookup: async query => ({ status:'unavailable',query,reason:'no match' }), maptilerKey:'test',fetch:fetcher });
  assert.equal((await resolver.resolve('unlisted destination')).status, 'ambiguous'); await resolver.resolve('unlisted destination'); assert.equal(calls, 1);
  const resolved = new DestinationResolver({ addressLookup: async query => ({ status:'resolved',query,destination:{ id:'fixture-address',label:'fixture address',resolved:{ lng:-79.4,lat:43.7,source:'address_points' } } }), fetch:fetcher, maptilerKey:'test' });
  assert.equal((await resolved.resolve('123 fixture street')).status, 'resolved'); assert.equal(calls, 1);
  const invalid = new DestinationResolver({ maptilerKey:'test',fetch:async () => Response.json({ features: [{ id:'a',place_name:'bad',relevance:1,center:[900,0] }] }) }); assert.equal((await invalid.resolve('bad')).status, 'unavailable');
  const timeout = new DestinationResolver({ timeoutMs:5,addressLookup:async () => new Promise(() => {}) }); assert.equal((await timeout.resolve('hang')).status, 'unavailable');
});
const geminiResponse = (value: unknown) => Response.json({ candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}] });
test('generic Gemini structured generation validates refinements and retries once', async () => {
  let calls = 0;
  const schema = z.object({ min:z.number(),max:z.number() }).refine(v => v.min <= v.max);
  const provider = new GeminiProvider({ apiKey:'test',model:'configured-main',fastModel:'configured-fast',fetch:async (url, opts) => { calls++; assert.match(String(url),/configured-fast/); const body = JSON.parse(String(opts?.body)); assert.equal(body.generationConfig.responseMimeType,'application/json'); assert.ok(body.generationConfig.responseJsonSchema); return geminiResponse(calls === 1 ? { min:2,max:1 } : { min:1,max:2 }); } });
  assert.deepEqual(await provider.generateStructured({ system:'test',prompt:'fixture',schema,fast:true }), { min:1,max:2 }); assert.equal(calls, 2);
});
test('Gemini busy never retries, timeout bounds full retry and text uses main model', async () => {
  for (const status of [429,503]) { let calls = 0; const provider = new GeminiProvider({ apiKey:'test',model:'test',fetch:async () => { calls++; return new Response('',{status}); } }); await assert.rejects(provider.generateText({system:'test',prompt:'test'}), (e: unknown) => e instanceof AIUnavailable && e.reason === 'busy' && e.status === status); assert.equal(calls,1); }
  let calls = 0; const provider = new GeminiProvider({ apiKey:'test',model:'test',deadlineMs:15,fetch:async () => { calls++; if (calls === 1) return geminiResponse({invalid:true}); return new Promise(() => {}); } });
  await assert.rejects(provider.generateStructured({system:'test',prompt:'test',schema:z.object({ok:z.boolean()})}), (e: unknown) => e instanceof AIUnavailable && e.reason === 'timeout'); assert.equal(calls,2);
  const text = new GeminiProvider({ apiKey:'test',model:'main',fastModel:'fast',fetch:async url => { assert.match(String(url), /main/); return Response.json({candidates:[{content:{parts:[{text:'hello'}]}}]}); } }); assert.equal(await text.generateText({system:'test',prompt:'test'}),'hello');
});
test('Gemini fast requests cap the shared retry deadline at three seconds and respect shorter budgets', async () => {
  vi.useFakeTimers();
  try {
    for (const [fast, deadlineMs, budget] of [[true, undefined, 3000], [true, 12000, 3000], [true, 500, 500], [false, undefined, 12000], [false, 1500, 1500]] as const) {
      let calls = 0;
      let signal: AbortSignal | undefined;
      const provider = new GeminiProvider({ apiKey: 'test', model: 'configured', deadlineMs, fetch: async (_url, opts) => {
        calls++;
        signal = opts?.signal as AbortSignal;
        if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 100)); return geminiResponse({ invalid: true }); }
        return new Promise(() => {});
      } });
      const rejected = assert.rejects(provider.generateStructured({ system: 'test', prompt: 'test', schema: z.object({ ok: z.boolean() }), fast }), (error: unknown) => error instanceof AIUnavailable && error.reason === 'timeout');
      await vi.advanceTimersByTimeAsync(100);
      assert.equal(calls, 2);
      await vi.advanceTimersByTimeAsync(budget - 101);
      assert.equal(signal?.aborted, false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      assert.equal(signal?.aborted, true);
      assert.equal(calls, 2);
    }
  } finally { vi.useRealTimers(); }
});
test('hash cache is bounded/expiring/copy isolated and per-IP limits cannot evict around quota', () => {
  let time = 1000; const cache = new MemoryCache<{value:number}>(1,100,() => time); cache.set('a',{value:1}); const a = cache.get('a')!; a.value=9; assert.equal(cache.get('a')?.value,1); cache.set('b',{value:2}); assert.equal(cache.get('a'),undefined); time+=101; assert.equal(cache.get('b'),undefined);
  const limiter = new IpLimiter(1,100,1,() => time); limiter.check('ip'); assert.throws(() => limiter.check('ip'),RateLimitError); assert.throws(() => limiter.check('second-ip'),RateLimitError); time+=101; limiter.check('second-ip');
});
test('service validates boundaries, AI output, cache and resolved targets', async () => {
  let calls = 0; const provider = { generateStructured: async <T>() => { calls++; return fallbackParse('10 min walk to Union Station') as T; }, generateText:async () => 'unused' };
  const service = new ParseService({provider, limiter:new IpLimiter(5)});
  const parsed = await service.parse({prompt:'10 min walk to Union Station'},'ip'); assert.equal(parsed.parser,'gemini'); assert.equal(parsed.intent.rawPrompt,'10 min walk to Union Station'); assert.equal(parsed.destinations[0].resolution.status,'resolved');
  await service.parse({prompt:'10 min walk to Union Station'},'ip'); assert.equal(calls,1);
  await assert.rejects(service.parse({prompt:''},'ip'));
});

test('no inverted exclusions or implied room type and unsupported requests remain visible', () => {
  const no = fallbackParse('under $2500 no basements, 1 room, available November'); assert.ok(!no.criteria.unitTypes?.value.includes('basement')); assert.ok(no.criteria.unitTypes?.value.includes('apartment')); assert.equal(no.criteria.bedrooms?.value.min,1); assert.equal(no.criteria.unitTypes?.hard,true); assert.ok(no.droppedRequests.some(d => d.phrase.includes('available')));
  assert.deepEqual(fallbackParse('apartments no basements').criteria.unitTypes?.value,['apartment']); assert.equal(fallbackParse('only basements, no basements').criteria.unitTypes,undefined);
  const unknowns = fallbackParse('I need 2 bedrooms, no pets, and a balcony'); assert.ok(unknowns.droppedRequests.some(d => d.phrase === 'no pets')); assert.ok(unknowns.droppedRequests.some(d => d.phrase === 'balcony'));
  assert.equal(fallbackParse('low crime').safety.enabled,true); assert.equal(fallbackParse('safe area').safety.enabled,true);
  assert.equal(fallbackParse('budget under 750 sqft').criteria.rent,undefined);
  const separate = fallbackParse('10 min walk to Union Station and near Eaton Centre'); assert.equal(separate.travelTargets[1].maxMinutes,undefined); assert.equal(separate.travelTargets[1].mode,'transit');
});
test('schema-valid AI hallucinations do not become constraints or coordinates', async () => {
  const invented = fallbackParse('under $2000 safe area 10 min walk to Union Station'); invented.fieldSources={}; invented.travelTargets[0].resolved={lng:1,lat:1,source:'known_place'};
  const service = new ParseService({provider:{ generateStructured:async <T>() => invented as T, generateText:async () => '' }});
  const parsed = await service.parse({prompt:'hello'},'ip'); assert.deepEqual(parsed.intent.criteria,{}); assert.equal(parsed.intent.safety.enabled,false); assert.equal(parsed.intent.travelTargets.length,0); assert.equal(parsed.parser,'fallback'); assert.ok(parsed.notice);
});

test('root walkthrough refines close groceries to one timed amenity without changing campus modes', () => {
  const intent = fallbackParse(demos[1] + ' With AC, ideally built after 2005, 10 min walk to a supermarket.');
  assert.equal(intent.travelTargets.length,2);
  const campus=intent.travelTargets.find(t => t.kind==='place')!; assert.equal(campus.mode,'transit'); assert.equal(campus.alternativeModes,undefined); assert.equal(campus.maxMinutes,25); assert.equal(campus.hard,true);
  const grocery=intent.travelTargets.find(t => t.category==='grocery')!; assert.equal(grocery.kind,'amenity'); assert.equal(grocery.mode,'walk'); assert.equal(grocery.alternativeModes,undefined); assert.equal(grocery.maxMinutes,10); assert.equal(grocery.hard,true);
  assert.equal(intent.criteria.airConditioning?.value,'any'); assert.equal(intent.criteria.buildingAge?.hard,false);
});


test('AI source contract uses target IDs and missing travel evidence falls back without widening', async () => {
  assert.ok(parseInstruction.includes('travelTargets.<target.id>'));
  assert.ok(parseInstruction.includes('never an array index'));
  assert.ok(parseInstruction.includes('within 10 minutes biking'));
  assert.ok(parseInstruction.includes('only for the criterion they modify'));
  assert.ok(parseInstruction.includes('verbatim substring'));
  const prompt = '10 min walk to Union Station';
  const invalid = fallbackParse(prompt);
  invalid.fieldSources['travelTargets.0'] = invalid.fieldSources['travelTargets.target-1'];
  delete invalid.fieldSources['travelTargets.target-1'];
  const service = new ParseService({ provider: { generateStructured: async <T>() => structuredClone(invalid) as T, generateText: async () => '' } });
  const result = await service.parse({ prompt }, 'ip');
  assert.equal(result.parser, 'fallback');
  assert.equal(result.intent.travelTargets[0].maxMinutes, 10);
  assert.equal(result.destinations[0].resolution.status, 'resolved');
  assert.ok(result.notice);
});


test('MapTiler partial or missing relevance cannot become a destination choice', async () => {
  const partial = { id: 'wrong', place_name: 'Unrelated landform', place_type: ['major_landform'], center: [-79.4,43.7] };
  const features = [partial, { ...partial, id: 'partial', relevance: 0.554815 }];
  const resolver = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features }) });
  assert.equal((await resolver.resolve('an exact business branch')).status, 'unavailable');
  const mixed = new DestinationResolver({ maptilerKey: 'test', fetch: async () => Response.json({ features: [...features, { ...partial, id: 'full', place_name: 'Matching alternate-language name', relevance: 1 }] }) });
  const result = await mixed.resolve('an exact business branch');
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') assert.equal(result.destination.id, 'full');
});


test('known hard travel bounds cannot be softened, omitted or widened by AI', async () => {
  const prompt = '10 min walk to Union Station';
  for (const change of ['soften', 'omit', 'widen'] as const) {
    const intent = fallbackParse(prompt);
    if (change === 'soften') intent.travelTargets[0].hard = false;
    if (change === 'omit') intent.travelTargets = [];
    if (change === 'widen') intent.travelTargets[0].maxMinutes = 20;
    const service = new ParseService({ provider: { generateStructured: async <T>() => intent as T, generateText: async () => '' } });
    const result = await service.parse({ prompt }, 'ip');
    assert.equal(result.parser, 'fallback');
    assert.equal(result.intent.travelTargets[0].hard, true);
    assert.equal(result.intent.travelTargets[0].maxMinutes, 10);
  }
  const preferred = 'Ideally 10 min walk to Union Station';
  const service = new ParseService({ provider: { generateStructured: async <T>() => fallbackParse(preferred) as T, generateText: async () => '' } });
  const result = await service.parse({ prompt: preferred }, 'ip');
  assert.equal(result.parser, 'gemini');
  assert.equal(result.intent.travelTargets[0].hard, false);
});

test('plain monthly budgets parse without currency signs and do not consume home or travel bounds', () => {
  assert.deepEqual(fallbackParse('2 bedrooms under 2500').criteria.rent, { value: { max: 2500 }, hard: true });
  assert.deepEqual(fallbackParse('budget of 2000, 1 bedroom').criteria.rent?.value, { max: 2000 });
  assert.deepEqual(fallbackParse('maximum rent: 1800').criteria.rent?.value, { max: 1800 });
  for (const prompt of ['under 800 sqft', 'at least 2 bedrooms', 'under 10 minutes walk to Union Station', 'built after 2000']) assert.equal(fallbackParse(prompt).criteria.rent, undefined);
});


test('timed destinations preserve street dots without duplicate campuses or merged trips', async () => {
  const campus = await new ParseService({ provider: new NoneProvider() }).parse({ prompt: 'Within 25 minutes by transit to UofT St. George.' }, 'destination-regression');
  assert.equal(campus.intent.travelTargets.length, 1);
  assert.equal(campus.intent.travelTargets[0].query, 'UofT St. George');
  assert.equal(campus.intent.travelTargets[0].maxMinutes, 25);
  assert.equal(campus.intent.travelTargets[0].hard, true);
  assert.equal(campus.destinations[0].resolution.status, 'resolved');
  if (campus.destinations[0].resolution.status === 'resolved') assert.equal(campus.destinations[0].resolution.destination.resolved.source, 'known_place');
  const prompt = '10 min walk to 100 Queen St. W. Parking required. 20 min bike to 200 King St. E.';
  const intent = fallbackParse(prompt);
  assert.deepEqual(intent.travelTargets.map(t => [t.query, t.mode, t.maxMinutes]), [['100 Queen St. W', 'walk', 10], ['200 King St. E', 'bike', 20]]);
  assert.equal(intent.fieldSources['travelTargets.target-1'].phrase, '10 min walk to 100 Queen St. W');
  assert.equal(intent.fieldSources['travelTargets.target-2'].phrase, '20 min bike to 200 King St. E');
  const joined = fallbackParse('10 min walk to 100 Queen St. W and 20 min bike to 200 King St. E');
  assert.deepEqual(joined.travelTargets.map(t => [t.query, t.mode, t.maxMinutes]), [['100 Queen St. W', 'walk', 10], ['200 King St. E', 'bike', 20]]);
});
