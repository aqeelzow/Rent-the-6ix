import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { AIUnavailable, providerFromEnv, type AIProvider } from '../ai/index';
import { ParseService, DestinationResolver } from './index';
import { civicAreasLookup } from './civic-areas-db';
import { addressPointsLookup } from './address-points';

const prompts = [
  "I'm looking for houses or apartments around the university of toronto. Should be within 10 minutes biking distance. Around 3-5k per",
  "I work at TD Canada on bay st and queens st w. I'm looking for a place to commute, bike, or walk to work, and it should take no longer than 10 minutes.",
  "I'm on a budget. I wanna live in downtown at the cheapest cost",
  'Room or studio near York University under $1,300, close to the subway, furnished.',
  'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.',
  '3 bedrooms in Scarborough under $3,200, near a public school and a park, parking.',
];

// Real paid provider calls and read-only civic SQL. No persistent parse cache or listing writes.
test.skipIf(process.env.RUN_LIVE_GEMINI_PARSE !== '1')('live fast Gemini preserves all six acceptance interpretations with civic resolution', async () => {
  process.loadEnvFile('.env.local');
  assert.equal(process.env.AI_PROVIDER, 'gemini');
  assert.ok(process.env.GEMINI_MODEL_FAST); assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const client = () => ({ unsafe: async (statement: string, parameters?: string[]) => await sql.unsafe(statement, parameters) });
  const actual = providerFromEnv();
  const providerErrors: string[] = [];
  const provider: AIProvider = {
    generateStructured: async options => {
      try { return await actual.generateStructured(options); }
      catch (error) { providerErrors.push(error instanceof AIUnavailable ? `${error.reason}:${error.status}` : 'unexpected'); throw error; }
    },
    generateText: options => actual.generateText(options),
  };
  const evidence = [];
  const responses = [];
  try {
    const parser = new ParseService({ provider, civicAreas: civicAreasLookup(client), resolver: new DestinationResolver({ addressLookup: addressPointsLookup(client), maptilerKey: process.env.NEXT_PUBLIC_MAPTILER_KEY }) });
    for (const [index, prompt] of prompts.entries()) {
      const start = performance.now();
      const response = await parser.parse({ prompt }, 'live-public-provider-acceptance');
      responses.push(response);
      evidence.push({ example: index + 1, milliseconds: Math.round(performance.now() - start), parser: response.parser, notice: response.notice, providerErrors: providerErrors.splice(0), criteria: Object.keys(response.intent.criteria), targets: response.intent.travelTargets.length, destinations: response.destinations.map(d => d.resolution.status) });
    }
    console.info(JSON.stringify({ feature: 'P1.21 live fast-provider acceptance', model: process.env.GEMINI_MODEL_FAST, database: 'live read-only', evidence }));
    for (const response of responses) {
      if (response.parser === 'fallback') assert.ok(response.notice, 'fallback must remain visible');
      assert.equal(new Set(response.intent.travelTargets.map(t => `${t.kind}:${t.query ?? t.category}`)).size, response.intent.travelTargets.length);
      assert.ok(Object.values(response.intent.fieldSources).every(source => !source.phrase || response.intent.rawPrompt.toLowerCase().includes(source.phrase.toLowerCase())));
    }
    const [local, work, budget, student, couple, family] = responses.map(r => r.intent);
    assert.deepEqual(local.criteria.rent?.value, { min: 3000, max: 5000 });
    assert.equal(local.criteria.bedrooms, undefined);
    assert.equal(local.travelTargets.length, 1); assert.equal(local.travelTargets[0].maxMinutes, 10); assert.equal(local.travelTargets[0].mode, 'bike'); assert.equal(local.travelTargets[0].hard, true);
    assert.equal(responses[0].destinations[0].resolution.status, 'ambiguous');
    assert.deepEqual(work.criteria, {}); assert.equal(work.household, undefined);
    assert.equal(work.travelTargets.length, 1); assert.equal(work.travelTargets[0].maxMinutes, 10);
    assert.deepEqual(new Set([work.travelTargets[0].mode, ...work.travelTargets[0].alternativeModes ?? []]), new Set(['transit', 'bike', 'walk']));
    assert.equal(responses[1].destinations[0].resolution.status, 'resolved');
    assert.equal(budget.sortBy, 'lowest_rent'); assert.equal(budget.areas[0].kind, 'configured');
    assert.deepEqual(new Set(student.criteria.unitTypes?.value), new Set(['room', 'studio'])); assert.equal(student.criteria.bedrooms, undefined); assert.equal(student.criteria.rent?.value.max, 1300); assert.equal(student.criteria.furnished?.value, true);
    assert.deepEqual(couple.criteria.bedrooms?.value, { min: 2, max: 2 }); assert.equal(couple.criteria.bedrooms?.hard, true); assert.equal(couple.criteria.rent?.value.max, 2800); assert.equal(couple.household?.annualIncomeCad, 95000);
    assert.equal(couple.travelTargets.length, 2); assert.equal(couple.travelTargets.filter(t => t.maxMinutes === 25 && t.mode === 'transit' && t.hard).length, 1);
    assert.deepEqual(family.criteria.bedrooms?.value, { min: 3, max: 3 }); assert.equal(family.criteria.rent?.value.max, 3200); assert.equal(family.criteria.parking?.value, true); assert.equal(family.travelTargets.length, 2); assert.equal(family.areas[0].kind, 'configured');
    assert.ok(responses.every(response => response.parser === 'gemini'), 'all semantic checks passed, but each acceptance prompt must use actual successful Gemini');
  } finally { await sql.end({ timeout: 2 }); }
}, 45000);
