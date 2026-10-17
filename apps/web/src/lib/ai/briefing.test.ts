import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canBrief, templateBriefing, validBriefing, writeBriefing, type BriefingFacts } from './briefing';

const indicator = (indicatorId: string, value: number) => ({ indicatorId, value, unit: '%', period: '2021', sourceId: 'census', sourceTitle: '2021 Census', sourceUrl: 'https://example.test/1234', note: null });
const facts: BriefingFacts = { area: { kind: 'ward', id: '01', name: 'Ward One', number: 1 }, indicators: [indicator('rent_burden', 31), indicator('housing_condition', 12), indicator('development_growth', 5)], cityIndicators: [indicator('rent_burden', 28), indicator('housing_condition', 9), indicator('development_growth', 4)] };
const paragraphs = ['Rent burden is 31% here and 28% citywide (2021 Census).', 'Housing condition is 12% here and 9% citywide (2021 Census).', 'Development growth is 5% here and 4% citywide (2021 Census).'];

test('briefings require source-backed matching city context and reject invented numbers or politics', async () => {
  assert.equal(canBrief(facts), true);
  assert.equal(canBrief({ ...facts, cityIndicators: [] }), false);
  assert.equal(validBriefing(paragraphs, facts), true);
  assert.equal(validBriefing([paragraphs[0].replace('31%', '99%'), ...paragraphs.slice(1)], facts), false);
  assert.equal(validBriefing([paragraphs[0].replace('31%', '1234%'), ...paragraphs.slice(1)], facts), false);
  assert.equal(validBriefing([paragraphs[0], 'Housing candidate should win.', paragraphs[2]], facts), false);
  let calls = 0;
  const provider = { generateText: async () => { calls++; return calls === 1 ? paragraphs[0].replace('31%', '99%') + '\n\n' + paragraphs.slice(1).join('\n\n') : paragraphs.join('\n\n'); }, generateStructured: async () => { throw Error('unused'); } };
  const response = await writeBriefing(facts, provider);
  assert.equal(calls, 2); assert.equal(response.source, 'gemini'); assert.deepEqual(response.paragraphs, paragraphs);
  const thin = await writeBriefing({ ...facts, cityIndicators: [] }, provider);
  assert.equal(calls, 2); assert.equal(thin.status, 'insufficient_data'); assert.equal(thin.source, 'template');
  assert.match(templateBriefing(facts).paragraphs[0], /31 %.*28 %/);
  assert.deepEqual(templateBriefing({ ...facts, indicators: [], cityIndicators: [] }).paragraphs.length, 3);
});
