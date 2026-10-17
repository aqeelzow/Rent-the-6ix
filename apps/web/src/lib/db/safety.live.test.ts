import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { loadCrimeTable, safetyForListing } from './safety';
import { sqlSearchDependencies } from './candidates-context';
import { searchCandidates } from './candidates';
import { baseIntent } from '../../../../../packages/shared/fixtures';

// Read-only acceptance of the published D safety contract; opt in with RUN_LIVE_SAFETY=1.
test.skipIf(process.env.RUN_LIVE_SAFETY !== '1')('live safety opt-in, hard limit and unknown handling', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL);
  const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5, onnotice: () => {} });
  try {
    const table = await loadCrimeTable(sql);
    assert.ok(table.byArea.size > 0); assert.ok(table.city && table.city.combined > 0);
    const [listing] = await sql`SELECT id FROM listings WHERE status = 'active' AND duplicate_of IS NULL AND neighbourhood_id IS NOT NULL ORDER BY id LIMIT 1`;
    assert.ok(listing);
    const dependencies = sqlSearchDependencies(() => sql, async () => table);
    const source = await dependencies.loadListing!(listing.id);
    assert.ok(source);
    const expected = safetyForListing(table, source.neighbourhoodId);
    assert.ok(expected.safety?.relativeRate != null); assert.ok(expected.safetyScore != null);
    const off = await dependencies.enrich(source, baseIntent);
    assert.equal(off.safety, null);
    const intent = { ...baseIntent, safety: { enabled: true, hard: false } };
    const on = await dependencies.enrich(source, intent);
    assert.deepEqual(on.safety, expected.safety); assert.equal(on.safetyScore, expected.safetyScore);
    const deps = { listings: [source], enrich: dependencies.enrich };
    const response = await searchCandidates({ intent, hideUnconfirmed: false }, deps);
    assert.equal(response.results.length, 1);
    assert.ok(response.results[0].matchScore.parts.find(p => p.id === 'safety')!.effectiveWeight > 0);
    assert.ok(response.results[0].matchScore.caveats.some(c => c.code === 'safety_city_rate'));
    const rate = expected.safety.relativeRate;
    const accepted = await searchCandidates({ intent: { ...intent, safety: { enabled: true, hard: true, maxRelativeRate: rate } }, hideUnconfirmed: false }, deps);
    assert.equal(accepted.results.length, 1);
    if (rate > 0.01) {
      const rejected = await searchCandidates({ intent: { ...intent, safety: { enabled: true, hard: true, maxRelativeRate: Math.max(0.01, rate - 0.01) } }, hideUnconfirmed: false }, deps);
      assert.equal(rejected.results.length, 0);
    }
    assert.deepEqual(safetyForListing(table, null), { safety: null, safetyScore: null });
    console.info(JSON.stringify({ database: 'live (read-only)', neighbourhoods: table.byArea.size, cityMethod: table.city.method, optIn: true, hardLimit: true, caveats: true }));
  } finally { await sql.end({ timeout: 2 }); }
}, 30000);
