import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { ParseService } from './index';
import { civicAreasLookup } from './civic-areas-db';
import { candidateQuery } from '../db/candidates-sql';

// Opt in: RUN_LIVE_CIVIC_PARSE=1 pnpm --filter web exec vitest run src/lib/parse/civic-areas.live.test.ts
// Read-only owner catalogue and eligibility queries; no AI calls or data writes.
test.skipIf(process.env.RUN_LIVE_CIVIC_PARSE !== '1')('live civic catalogue parses exact owner IDs into bound SQL eligibility filters', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const lookup = civicAreasLookup(() => ({ unsafe: async statement => await sql.unsafe(statement) }));
    const catalogue = await lookup();
    assert.equal(catalogue.filter(a => a.kind === 'neighbourhood').length, 158);
    assert.equal(catalogue.filter(a => a.kind === 'ward').length, 25);
    assert.ok(catalogue.some(a => a.kind === 'neighbourhood' && a.name === 'Annex' && a.id === '095'));
    assert.ok(catalogue.some(a => a.kind === 'ward' && a.id === '01' && a.number === 1));
    const parser = new ParseService({ civicAreas: lookup });
    const evidence = [];
    for (const [prompt, kind, id] of [['in Annex under $3000', 'neighbourhood', '095'], ['in ward 01 under $3000', 'ward', '01']] as const) {
      const parsed = await parser.parse({ prompt }, 'live-public-area');
      assert.equal(parsed.parser, 'fallback'); assert.deepEqual(parsed.intent.areas, [{ kind, id }]);
      const query = candidateQuery({ intent: parsed.intent, hideUnconfirmed: true });
      assert.ok(query.parameters.includes(id)); assert.ok(!query.statement.includes(id));
      const rows = await sql.unsafe(query.statement, query.parameters);
      assert.ok(rows.length > 0, 'public area should have confirmed active matches');
      assert.ok(rows.every(row => row[kind === 'ward' ? 'ward_id' : 'neighbourhood_id'] === id));
      evidence.push({ kind, id, confirmedMatches: rows.length });
    }
    console.info(JSON.stringify({ feature: 'P1.21 civic parsing', database: 'live', neighbourhoods: 158, wards: 25, evidence }));
  } finally { await sql.end({ timeout: 2 }); }
}, 15000);
