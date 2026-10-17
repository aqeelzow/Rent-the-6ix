import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRuntime, fixtureDependencies } from './runtime';
import { IpLimiter } from '../parse/index';
import { baseIntent, sampleListings, travelIntent } from '../../../../../packages/shared/fixtures/index';
import { SearchResponseSchema } from '../../../../../packages/shared/schemas/index';
// shortcut: eight synthetic rows and mocked routing measure local overhead, rerun with owner services for latency acceptance.
const api = createRuntime({ env: {}, limiter: new IpLimiter(10000), startLimiter: new IpLimiter(10000), pollLimiter: new IpLimiter(10000), dependencies: { ...fixtureDependencies, routeTimes: async (origins, targets, mode) => origins.flatMap(l => targets.map(t => ({ listingId: l.id, targetId: t.id, mode, minutes: 5, distanceM: 100, computedAt: l.lastSeenAt, method: 'otp', poiId: null }))) } });
const post = (body: unknown) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });
async function measure(name: string, action: () => Promise<void>) {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) { const start = performance.now(); await action(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ benchmark: name, rows: 8, iterations: 20, medianMs: Number(samples[10].toFixed(2)), p95Ms: Number(samples[18].toFixed(2)), synthetic: true }));
}
async function main() {
  await measure('fallback_parse', async () => { assert.equal((await api.parse(post({ prompt: 'cheapest downtown' }), undefined)).status, 200); });
  await measure('ordinary_search', async () => { const r = await api.search(post({ intent: baseIntent }), undefined); assert.equal(r.status, 200); assert.equal((await r.json()).status, 'completed'); });
  await measure('scalar_percentile', async () => { const r = await api.search(post({ intent: { ...baseIntent, numericExtreme: { field: 'rent', direction: 'min', percentage: 5 } } }), undefined); assert.equal((await r.json()).status, 'completed'); });
  await measure('context_detail', async () => { const r = await api.detail(new Request('http://localhost/api?intent='+encodeURIComponent(JSON.stringify(baseIntent))), { params: Promise.resolve({ id: sampleListings[1].id }) }); assert.equal(r.status, 200); });
  await measure('async_mock_routed_percentile_submit_and_complete', async () => {
    const r = await api.search(post({ intent: { ...travelIntent, numericExtreme: { field: 'travel', direction: 'min', percentage: 5, targetId: 'campus' } } }), undefined);
    const pending = SearchResponseSchema.parse(await r.json()); assert.equal(pending.status, 'pending'); if (pending.status !== 'pending') return;
    for (;;) { const result = await (await api.poll(new Request('http://localhost/api'), { params: Promise.resolve({ token: pending.jobToken }) })).json(); if (result.status !== 'pending') { assert.equal(result.status, 'completed'); break; } await new Promise(resolve => setTimeout(resolve, 0)); }
  });
  api.jobs.dispose();
}
void main();
