import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { ParseService } from './index';
import { civicAreasLookup } from './civic-areas-db';
import { areaStatement } from './areas';
import { candidateQuery } from '../db/candidates-sql';
import { loadChoropleth } from '../db/area-choropleth';

// Opt in against a seeded Waterloo database: RUN_LIVE_CIVIC_PARSE=1 pnpm --filter web exec vitest run src/lib/parse/civic-areas.live.test.ts
// The legacy rows used below are always rolled back.
test.skipIf(process.env.RUN_LIVE_CIVIC_PARSE !== '1')('live civic lookups ignore legacy neighbourhoods and indicators', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const rollback = new Error('Rollback temporary legacy rows');
  try {
    await sql.begin(async tx => {
      await tx`INSERT INTO neighbourhoods (id, name, geometry)
        SELECT 'legacy-review-annex', 'Annex', geometry FROM neighbourhoods WHERE id = 'WPD-columbia'`;
      await tx`INSERT INTO area_indicators (area_id, area_kind, indicator_id, value, unit, period)
        VALUES ('legacy-review-annex', 'neighbourhood', 'renter_households_pct', 100, 'legacy unit', 'Legacy')`;
      const lookup = civicAreasLookup(() => ({ unsafe: async statement => await tx.unsafe(statement) }));
      const catalogue = await lookup();
      assert.ok(catalogue.some(a => a.id === 'WPD-columbia'));
      assert.ok(catalogue.every(a => a.id.startsWith('WPD-')));
      assert.equal((await tx.unsafe(areaStatement, ['annex'])).length, 0);
      const parser = new ParseService({ civicAreas: lookup });
      const parsed = await parser.parse({ prompt: 'in Columbia under $3000' }, 'live-public-area');
      assert.deepEqual(parsed.intent.areas, [{ kind: 'neighbourhood', id: 'WPD-columbia' }]);
      const query = candidateQuery({ intent: parsed.intent, hideUnconfirmed: true });
      assert.ok(query.parameters.includes('WPD-columbia'));
      const rows = await tx.unsafe(query.statement, query.parameters);
      assert.ok(rows.length > 0);
      assert.ok(rows.every(row => row.neighbourhood_id === 'WPD-columbia'));
      const layer = await loadChoropleth(tx, 'neighbourhood', 'renter_households_pct', async () => null);
      assert.ok(layer && layer.features.some(feature => feature.id === 'WPD-columbia'));
      assert.ok(layer.features.every(feature => feature.id.startsWith('WPD-')));
      assert.equal(layer.sourceId, 'statcan-waterloo-census-profile');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally { await sql.end({ timeout: 2 }); }
}, 15000);
