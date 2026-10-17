import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { baseIntent } from '../../../../../packages/shared/fixtures/index';
import { DetailResponseSchema } from '../../../../../packages/shared/schemas/index';
import { sqlSearchDependencies } from './candidates-context';
import { createRuntime } from '../api/runtime';

// Read-only opt-in using ignored web .env.local: RUN_LIVE_STATIC_DETAIL=1 pnpm --filter web exec vitest run src/lib/db/candidates-detail.live.test.ts
test.skipIf(process.env.RUN_LIVE_STATIC_DETAIL !== '1')('live detail returns civic/building/duplicate facts and opt-in-only sourced crime indicators', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5, onnotice: () => {} });
  const api = createRuntime({ env: {}, dependencies: sqlSearchDependencies(() => sql) });
  try {
    const [matched] = await sql`SELECT l.id FROM listings l JOIN buildings b ON b.id = l.building_id
      JOIN neighbourhoods n ON n.id = l.neighbourhood_id JOIN wards w ON w.id = l.ward_id
      WHERE l.status = 'active' AND l.duplicate_of IS NULL ORDER BY l.last_seen_at DESC LIMIT 1`;
    assert.ok(matched, 'real listing with matched building and both areas required');
    const [duplicated] = await sql`SELECT l.id FROM listings l WHERE EXISTS (SELECT 1 FROM listings d WHERE d.duplicate_of = l.id) LIMIT 1`;
    assert.ok(duplicated, 'real canonical duplicate group required');
    let buildingVerified = false, duplicatesVerified = false, optInCrime = 0;
    for (const id of new Set([String(matched.id), String(duplicated.id)])) {
      for (const enabled of [false, true]) {
        const intent = { ...baseIntent, safety: { ...baseIntent.safety, enabled } };
        const response = await api.detail(new Request(`http://localhost/api/listings/${id}?intent=${encodeURIComponent(JSON.stringify(intent))}`), { params: Promise.resolve({ id }) });
        assert.equal(response.status, 200);
        const detail = DetailResponseSchema.parse(await response.json());
        const expectedAreas = await sql`SELECT id FROM neighbourhoods WHERE id = ${detail.listing.neighbourhoodId} UNION ALL SELECT id FROM wards WHERE id = ${detail.listing.wardId}`;
        assert.deepEqual(detail.areas.map(a => a.id).sort(), expectedAreas.map(a => String(a.id)).sort());
        const indicators = await sql`SELECT * FROM area_indicators WHERE ((area_kind = 'neighbourhood' AND area_id = ${detail.listing.neighbourhoodId}) OR (area_kind = 'ward' AND area_id = ${detail.listing.wardId})) AND source_id IS NOT NULL AND unit IS NOT NULL AND (${enabled} OR indicator_id !~ '^crime[:_]') ORDER BY area_kind, indicator_id, period`;
        assert.equal(detail.indicators.length, indicators.length);
        for (const [index, indicator] of detail.indicators.entries()) {
          assert.equal(indicator.value, indicators[index].value); assert.equal(indicator.sourceId, indicators[index].source_id); assert.equal(indicator.period, indicators[index].period);
        }
        if (!enabled) assert.ok(detail.indicators.every(i => !/^crime[:_]/.test(i.indicatorId)));
        else optInCrime += detail.indicators.filter(i => /^crime[:_]/.test(i.indicatorId)).length;
        const duplicateRows = await sql`SELECT id FROM listings WHERE duplicate_of = ${id} ORDER BY last_seen_at DESC, id`;
        assert.deepEqual(detail.duplicates.map(d => d.id), duplicateRows.map(d => String(d.id)));
        if (id === String(duplicated.id)) { assert.ok(detail.duplicates.length > 0); duplicatesVerified = true; }
        if (id === String(matched.id)) {
          assert.equal(detail.areas.length, 2); assert.ok(detail.building);
          const [building] = await sql`SELECT id, address, latest_score, sign_colour, source_id, previous_scores FROM buildings WHERE id = ${detail.listing.buildingId}`;
          assert.equal(detail.building.id, building.id); assert.equal(detail.building.address, building.address);
          assert.equal(detail.building.latestScore, building.latest_score == null ? null : Number(building.latest_score));
          assert.equal(detail.building.signColour, building.sign_colour); assert.equal(detail.building.sourceId, building.source_id); assert.deepEqual(detail.building.previousScores, typeof building.previous_scores === 'string' ? JSON.parse(building.previous_scores) : building.previous_scores); buildingVerified = true;
        }
      }
    }
    assert.ok(buildingVerified && duplicatesVerified && optInCrime > 0, 'all live assertions must be non-vacuous');
    console.info(JSON.stringify({ feature: 'P2.25 static detail', database: 'live', areas: 'verified', buildingVerified, duplicatesVerified, optInCrime }));
  } finally { api.jobs.dispose(); await sql.end({ timeout: 2 }); }
}, 60000);
