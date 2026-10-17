import assert from 'node:assert/strict';

const base = process.env.SEARCH_BASE_URL ?? 'http://127.0.0.1:3000';
const provider = process.env.AI_PROVIDER;
assert.ok(provider === 'none' || provider === 'gemini', 'Set AI_PROVIDER=none or gemini to match the running server');
const prompts = [
  'Room or studio near York University under $1,300, close to the subway, furnished.',
  'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.',
  '3 bedrooms in Scarborough under $3,200, near a public school and a park, parking.',
];
const post = async (path, body) => {
  const response = await fetch(new URL(path, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
};

let completed = 0;
let allAiAvailable = provider === 'gemini';
for (const [index, prompt] of prompts.entries()) {
  const parsed = await post('/api/search/parse', { prompt });
  assert.ok(parsed.parser === 'gemini' || parsed.parser === 'fallback');
  // A failed first Gemini parse usually means quota or provider outage; avoid spending two more calls.
  if (provider === 'gemini' && parsed.parser !== 'gemini') {
    allAiAvailable = false;
    console.log(JSON.stringify({ prompt: index + 1, parser: parsed.parser, notice: parsed.notice, prewarmed: false }));
    break;
  }
  const intent = { ...parsed.intent, rawPrompt: '', fieldSources: {}, droppedRequests: [] };
  const search = await post('/api/listings/search', { intent });
  assert.equal(search.status, 'completed');
  assert.ok(search.results.length > 0, `Demo prompt ${index + 1} has no results`);
  const id = search.results[0].listing.id;
  const explained = await post(`/api/listings/${id}/explain`, { intent });
  assert.ok(explained.source === 'gemini' || explained.source === 'template');
  console.log(JSON.stringify({ prompt: index + 1, parser: parsed.parser, results: search.results.length, explanation: explained.source, aiAvailable: parsed.parser === 'gemini' && explained.source === 'gemini' }));
  allAiAvailable &&= parsed.parser === 'gemini' && explained.source === 'gemini';
  completed++;
  if (provider === 'gemini' && explained.source !== 'gemini') break;
}
console.log(JSON.stringify({ completed, total: prompts.length, allAiAvailable: allAiAvailable && completed === prompts.length }));
