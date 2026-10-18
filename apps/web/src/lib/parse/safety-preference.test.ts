import assert from 'node:assert/strict';
import { test } from 'vitest';
import { NoneProvider } from '../ai';
import { fallbackParse, ParseService } from './index';

const query = 'Room or studio near York University under $1,300, close to the subway, furnished';

test('both parsers retain explicit safety preferences and the rest of the York search', async () => {
  for (const phrase of ['safe neighborhood', 'safe neighbourhood', 'safe area', 'safer', 'low crime']) {
    const prompt = `${query}, ${phrase}`;
    // Simulate Gemini understanding the other criteria but omitting safety.
    const omitted = fallbackParse(query);
    const gemini = { generateStructured: async <T>() => structuredClone(omitted) as T, generateText: async () => '' };
    for (const provider of [new NoneProvider(), gemini]) {
      const result = await new ParseService({ provider }).parse({ prompt }, 'test');
      assert.equal(result.parser, provider === gemini ? 'gemini' : 'fallback');
      assert.deepEqual(result.intent.safety, { enabled: true, hard: false });
      assert.deepEqual(result.intent.fieldSources.safety, { source: 'ai_prompt', phrase });
      assert.deepEqual(result.intent.criteria.unitTypes?.value, ['room', 'studio']);
      assert.equal(result.intent.criteria.rent?.value.max, 1300);
      assert.equal(result.intent.criteria.furnished?.value, true);
      assert.ok(result.intent.travelTargets.some(target => target.query === 'York University'));
      assert.ok(result.intent.travelTargets.some(target => target.category === 'rapid_transit'));
    }
  }
});

test('safety wording alone is grounded even when Gemini returns no preferences', async () => {
  const prompt = 'safe neighborhood';
  const empty = fallbackParse('hello');
  const service = new ParseService({ provider: {
    generateStructured: async <T>() => ({ ...structuredClone(empty), droppedRequests: [] }) as T,
    generateText: async () => '',
  } });
  const result = await service.parse({ prompt }, 'test');
  assert.equal(result.parser, 'gemini');
  assert.deepEqual(result.intent.safety, { enabled: true, hard: false });
});

test('general safety requests are recognized by both parsers without a specific neighborhood phrase', async () => {
  for (const wording of [
    'somewhere safe', 'I want to feel safe walking at night', 'a safer place', 'the safest location',
    'neighborhood safety matters', 'safety is important to me', 'low-crime surroundings',
    'lower crime rates', 'less crime', 'avoid high crime areas', 'avoid unsafe neighborhoods',
    'away from dangerous areas', 'a secure neighbourhood',
  ]) {
    const prompt = `under $2000, ${wording}`;
    const omitted = fallbackParse('under $2000');
    const gemini = { generateStructured: async <T>() => structuredClone(omitted) as T, generateText: async () => '' };
    for (const provider of [new NoneProvider(), gemini]) {
      const result = await new ParseService({ provider }).parse({ prompt }, 'test');
      assert.equal(result.parser, provider === gemini ? 'gemini' : 'fallback');
      assert.deepEqual(result.intent.safety, { enabled: true, hard: false }, wording);
      assert.ok(prompt.includes(result.intent.fieldSources.safety.phrase!));
    }
  }
});

test('negation and unrelated safety wording do not opt the renter into crime scoring', async () => {
  for (const wording of [
    "I don't care about safety", 'I do not want safety', 'ignore safety', 'no safety preference',
    'safety is not important', 'safety does not matter', 'safety isn’t a concern',
    'not worried about crime', 'a safe deposit box', 'fire safety', 'safe bike storage',
    'a pet-safe apartment',
  ]) {
    const prompt = `under $2000, ${wording}`;
    assert.equal(fallbackParse(prompt).safety.enabled, false, wording);
    const invented = fallbackParse('under $2000');
    invented.safety = { enabled: true, hard: true };
    invented.fieldSources.safety = { source: 'ai_prompt', phrase: wording };
    const result = await new ParseService({ provider: {
      generateStructured: async <T>() => structuredClone(invented) as T,
      generateText: async () => '',
    } }).parse({ prompt }, 'test');
    assert.equal(result.parser, 'gemini');
    assert.deepEqual(result.intent.safety, { enabled: false, hard: false }, wording);
  }
});

test('later safety requests take precedence and explicit city-rate bounds stay hard', () => {
  assert.equal(fallbackParse("I don't care about safety, but prefer somewhere safe").safety.enabled, true);
  assert.equal(fallbackParse("somewhere safe, but safety doesn't matter").safety.enabled, false);
  assert.equal(fallbackParse('under $2000, not only safe but furnished').safety.enabled, true);
  for (const wording of ['below the city crime rate', 'crime rates below the city average', "crime lower than the city's rate"]) {
    assert.deepEqual(fallbackParse(`under $2000, ${wording}`).safety, { enabled: true, hard: true }, wording);
  }
});

test('below-city-rate requests are hard while general safety requests never invent a limit', async () => {
  for (const phrase of ['safe neighborhood', 'below the city crime rate']) {
    const prompt = `under $2000, ${phrase}`;
    const invented = fallbackParse(prompt);
    invented.safety = { enabled: true, hard: true, maxRelativeRate: 0.5 };
    const service = new ParseService({ provider: {
      generateStructured: async <T>() => structuredClone(invented) as T,
      generateText: async () => '',
    } });
    const result = await service.parse({ prompt }, 'test');
    const expected = { enabled: true, hard: phrase.startsWith('below') };
    assert.deepEqual(result.intent.safety, expected);
    assert.deepEqual(fallbackParse(prompt).safety, expected);
  }
});

test('safety stays off without a safety request, including unrelated uses of safe', async () => {
  for (const prompt of [query, 'under $2000 with a safe deposit box']) {
    assert.deepEqual(fallbackParse(prompt).safety, { enabled: false, hard: false });
    const invented = fallbackParse(prompt);
    invented.safety = { enabled: true, hard: false };
    delete invented.fieldSources.safety;
    const result = await new ParseService({ provider: {
      generateStructured: async <T>() => structuredClone(invented) as T,
      generateText: async () => '',
    } }).parse({ prompt }, 'test');
    assert.equal(result.intent.safety.enabled, false);
  }
});
