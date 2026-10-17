import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRuntime } from '../api/runtime';
import { getClient } from '../db';

// Read-only opt-in: RUN_LIVE_BRIEFING=1 pnpm --filter web exec vitest run src/lib/db/briefing.live.test.ts
test.skipIf(process.env.RUN_LIVE_BRIEFING !== '1')('live briefing API reflects sourced ward facts and missing city context', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL);
  const sql = getClient(); assert.ok(sql);
  const api = createRuntime({ env: { DATABASE_URL: process.env.DATABASE_URL, AI_PROVIDER: 'none' } });
  const call = (kind: string, id: string) => api.briefing(new Request(`http://localhost/api/areas/${kind}/${id}/briefing`), { params: Promise.resolve({ kind, id }) });
  try {
    const response = await call('ward', '1'); assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.area.id, '01'); assert.equal(body.area.kind, 'ward');
    assert.deepEqual(body.cityIndicators, []);
    assert.equal(body.status, 'insufficient_data'); assert.equal(body.source, 'template'); assert.equal(body.paragraphs.length, 3);
    const [counts] = await sql`SELECT (SELECT count(*)::int FROM wards) AS wards, (SELECT count(*)::int FROM area_indicators WHERE area_kind = 'ward') AS ward_indicators`;
    assert.equal(counts.wards, 25); assert.equal(counts.ward_indicators, 0); assert.deepEqual(body.indicators, []);
    assert.equal((await call('ward', '99')).status, 404);
    assert.equal((await call('city', '1')).status, 422);
    console.info(JSON.stringify({ feature: 'P3.3 area briefing', wards: counts.wards, wardIndicators: counts.ward_indicators, status: body.status }));
  } finally { api.jobs.dispose(); await sql.end({ timeout: 2 }); }
}, 15000);
