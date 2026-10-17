import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { ParseService } from '../parse';
import { sqlSearchDependencies } from './candidates-context';
import { searchCandidates } from './candidates';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { CAVEATS } from '../../../../../packages/shared/engine/config';

// Opt in: RUN_LIVE_SEARCH_RANKING=1 pnpm --filter web exec vitest run src/lib/db/candidates-ranking.live.test.ts
// Read-only live DB/owner valuation acceptance with the labelled deterministic parser; no Gemini or routing claim.
test.skipIf(process.env.RUN_LIVE_SEARCH_RANKING !== '1')('SPEC16 live database ranking, room exclusion and unknown-bedroom evidence', async () => {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5, onnotice: () => {} });
  const deps = sqlSearchDependencies(() => sql);
  const prompts = [
    'Room or studio near York University under $1,300, close to the subway, furnished.',
    'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.',
    '3 bedrooms in Scarborough under $3,200, near a public school and a park, parking.',
  ];
  try {
    for (const [index, prompt] of prompts.entries()) {
      const parsed = await new ParseService().parse({ prompt }, 'live-ranking-probe');
      assert.equal(parsed.parser, 'fallback');
      const request = { intent: parsed.intent, hideUnconfirmed: false };
      const pool = await deps.loadCandidates!(request);
      const started = performance.now();
      const response = await searchCandidates(request, deps);
      assert.ok(response.results.length > 0, `demo ${index + 1} must be non-vacuous`);
      for (const row of response.results) {
        assert.equal(row.matchScore.total, Math.round(row.matchScore.parts.reduce((sum, p) => sum + (p.score ?? 0) * p.effectiveWeight, 0)));
        if (row.valuation.status === 'ok' && row.valuation.differencePct! > CAVEATS.farBelowPct) {
          assert.equal(row.matchScore.parts.find(p => p.id === 'value')!.score, null);
          assert.ok(row.matchScore.caveats.some(c => c.code === 'rent_far_below'));
        }
        if (index > 0) {
          assert.notEqual(row.listing.unitType, 'room'); assert.equal(row.listing.rentIsPerRoom, false);
          if (row.listing.bedrooms === null) assert.ok(row.matchScore.hardFilterNotes.includes('bedrooms: not confirmed'));
        }
      }
      const unknownBedrooms = response.results.map(r => parsed.intent.criteria.bedrooms?.hard && r.listing.bedrooms === null ? 1 : 0);
      assert.deepEqual(unknownBedrooms, [...unknownBedrooms].sort((a, b) => a - b));
      for (let i = 1; i < response.results.length; i++) {
        const previous = response.results[i - 1], current = response.results[i];
        if (unknownBedrooms[i - 1] === unknownBedrooms[i]) {
          assert.ok(previous.matchScore.hardFilterNotes.length <= current.matchScore.hardFilterNotes.length);
        }
        if (unknownBedrooms[i - 1] === unknownBedrooms[i] && previous.matchScore.hardFilterNotes.length === current.matchScore.hardFilterNotes.length) {
          const flagged = (row: typeof current) => Number(row.valuation.status === 'ok' && row.valuation.differencePct! > CAVEATS.farBelowPct);
          assert.ok(flagged(previous) <= flagged(current));
        }
      }
      // Cheap confirmation ordering must survive SQL source order and the ordinary candidate cap.
      const confirmed = pool.filter(l => filterListing(l, parsed.intent, {}, false, true).notes.length === 0);
      if (index > 0 && confirmed.length) assert.notEqual(response.results[0].listing.bedrooms, null);
      process.stdout.write(JSON.stringify({ demo: index + 1, database: 'live (read-only)', parser: parsed.parser, eligible: response.eligibleCount, returned: response.results.length, elapsedMs: Math.round(performance.now() - started), top6: response.results.slice(0, 6).map(r => ({ rent: r.listing.monthlyRentCad, bedrooms: r.listing.bedrooms, unitType: r.listing.unitType, score: r.matchScore.total, unknownHardFields: r.matchScore.hardFilterNotes.length, value: r.matchScore.parts.find(p => p.id === 'value')!.score, confidence: r.valuation.confidence, effectiveCount: r.valuation.effectiveCount })) }) + '\n');
    }
  } finally { await sql.end({ timeout: 2 }); }
}, 180000);
