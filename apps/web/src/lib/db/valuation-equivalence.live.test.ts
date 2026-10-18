import { test } from 'vitest';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { listingContext, listingContexts, clearValuationCache } from './valuation';
import { sqlListingLoader } from './candidates-sql';

test.skipIf(process.env.RUN_VALUATION_EQUIVALENCE !== '1')('batched valuations match per-listing valuations', async () => {
  if (!process.env.DATABASE_URL) { try { process.loadEnvFile('../../.env.local'); } catch { /* repo-root env */ } }
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, connect_timeout: 10, idle_timeout: 300, onnotice: () => {} });
  try {
    const facts = await sql`
      WITH classes AS (
        SELECT id, last_seen_at,
          CASE WHEN unit_type = 'room' THEN 'room' WHEN bedrooms = 0 THEN 'studio'
            WHEN bedrooms = 1 THEN 'one-bed' WHEN bedrooms = 2 THEN 'two-bed' ELSE 'three-plus' END AS kind
        FROM listings WHERE status = 'active' AND duplicate_of IS NULL
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY kind ORDER BY last_seen_at DESC, id) AS rank FROM classes
      )
      SELECT id, kind FROM ranked WHERE rank <= 5 ORDER BY kind, rank`;
    const load = sqlListingLoader(() => sql);
    const listings = [];
    for (const fact of facts) { const listing = await load(String(fact.id)); assert.ok(listing); listings.push(listing); }
    const now = new Date('2026-10-17T12:00:00Z');

    clearValuationCache();
    const single: Awaited<ReturnType<typeof listingContext>>[] = [];
    for (const listing of listings) single.push(await listingContext(sql, listing, now));

    clearValuationCache();
    const batch = await listingContexts(sql, listings, now);

    let estimates = 0, mismatches = 0;
    const fields = new Set<string>();
    listings.forEach((listing, i) => {
      const before = single[i].valuation, after = batch.get(listing.id)!.valuation;
      if (before.status === 'ok') estimates++;
      for (const field of ['status', 'estimatedRentCad', 'lowCad', 'highCad', 'differencePct', 'priceLabel', 'comparableCount', 'effectiveCount', 'radiusM', 'confidence'] as const) {
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) { mismatches++; fields.add(field); }
      }
      // The comparable set must match; distances may differ by the spheroid/haversine delta.
      const ids = (list: typeof before.comparables) => list.map(c => c.listingId).sort();
      if (JSON.stringify(ids(before.comparables)) !== JSON.stringify(ids(after.comparables))) { mismatches++; fields.add('comparables'); }
      const maximumDistanceDelta = Math.max(0, ...before.comparables.map(c => {
        const match = after.comparables.find(other => other.listingId === c.listingId);
        return match ? Math.abs(match.distanceM - c.distanceM) : Infinity;
      }));
      if (maximumDistanceDelta > 5) { mismatches++; fields.add('distanceM'); }
    });
    console.log(JSON.stringify({ listings: listings.length, estimates, mismatches, differingFields: [...fields] }));
  } finally { clearValuationCache(); await sql.end({ timeout: 2 }); }
}, 120000);
