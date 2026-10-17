import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { sqlListingLoader } from './candidates-sql';
import { ParseService } from '../parse';
import { sqlSearchDependencies } from './candidates-context';
import { listingContext, clearValuationCache } from './valuation';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { tieBreak } from '../../../../../packages/shared/engine/score';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
// Read-only real DB performance probe: RUN_LIVE_CONTEXT_PIPELINE=1 pnpm --filter web exec vitest run src/lib/db/pipeline-benchmark.live.test.ts
test.skipIf(process.env.RUN_LIVE_CONTEXT_PIPELINE !== '1')('actual 500-context cross-snapshot cold bounded pipeline comparison', async () => {
 process.loadEnvFile('.env.local');
 const sql = postgres(process.env.DATABASE_URL!, {max:2,connect_timeout:5,onnotice:()=>{}});
 try {
  const parsed = await new ParseService().parse({prompt:'I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.'},'bounded-context-validation');
  const request={intent:parsed.intent,hideUnconfirmed:false};
  const deps=sqlSearchDependencies(()=>sql);
  const source=await deps.loadCandidates!(request);
  const pool=source.filter(l=>filterListing(l,parsed.intent,{},false,true).passes);
  pool.sort((a,b)=>filterListing(a,parsed.intent,{},false,true).notes.length-filterListing(b,parsed.intent,{},false,true).notes.length||tieBreak({listing:a},{listing:b}));
  const selected=pool.slice(0,500); assert.equal(selected.length,500);
  const now=new Date(); const runs=[]; let baseline='';
  for(const concurrency of [8,16,32,8]) {
   clearValuationCache(); let next=0; const results:unknown[]=new Array(500); const start=performance.now(); const cpu=process.cpuUsage();
   await Promise.all(Array.from({length:concurrency},async()=>{while(next<selected.length){const index=next++; results[index]=await listingContext(sql,selected[index],now);}}));
   const elapsedMs=Math.round(performance.now()-start), cpuUsed=process.cpuUsage(cpu);
   const digest=createHash('sha256').update(JSON.stringify(results.map(canonical))).digest('hex');
   if(!baseline)baseline=digest;
   const row={concurrency,count:results.length,elapsedMs,processCpuMs:Math.round((cpuUsed.user+cpuUsed.system)/1000),sameResults:digest===baseline};runs.push(row);process.stdout.write(JSON.stringify(row)+'\n');
  }
  const record={scope:'Read-only actual DB, direct owner C listingContext for the same 500 ordinary best-match couple candidates; no B cache; no HTTP endpoint latency claim',measuredAt:new Date().toISOString(),fixedValuationNow:now.toISOString(),databaseClient:'postgres max 2, default pipeline; owner queries/algorithms unchanged',cheapPoolCount:pool.length,selection:'Same cheap hard filters and best-match hard-confirmation/confirmed-field/recency/rent ordering as ordinary candidate selection; hard travel is unknown and passes',runs,limits:['Only the representative couple pool was measured; not every possible pool or concurrent deployment load','C valuation cache cleared before every pass; database buffers and network caches are not flushed','Result comparison canonicalizes array order to ignore equal-distance comparable ordering; semantic array order is not asserted','Direct owner timings exclude B request SQL, filtering, schema validation, scoring, response serialization and routing'],comparisonClassification:{snapshotControl:'None: ordinary pooled reads across separate database snapshots',cause:'Unclassified: changing database facts and query nondeterminism are not distinguished',followup:'RUN_LIVE_CONTEXT_SNAPSHOT=1 isolates a bounded sample; it does not prove this entire pool equivalent'}};
  writeFileSync('../../apps/search/validation/rent-c-500-context-concurrency.json',JSON.stringify(record,null,2)+'\n');
  assert.ok(runs.every(r=>r.sameResults),'results changed across separate database snapshots; cause is unclassified');
 } finally {await sql.end({timeout:2});}
},180000);

// A single snapshot isolates repeated owner reads from the ingest worker; this is not a throughput test.
test.skipIf(process.env.RUN_LIVE_CONTEXT_SNAPSHOT !== '1')('cold owner contexts are stable within one read-only repeatable-read snapshot', async () => {
 if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
 assert.ok(process.env.DATABASE_URL);
 const sql = postgres(process.env.DATABASE_URL, {max:1,connect_timeout:5,onnotice:()=>{}});
 try {
  const record = await sql.begin('isolation level repeatable read read only', async transaction => {
   await transaction`SET LOCAL statement_timeout = '2s'`;
   await transaction`SET LOCAL idle_in_transaction_session_timeout = '5s'`;
   const [settings] = await transaction`SELECT current_setting('transaction_isolation') AS isolation,
    current_setting('transaction_read_only') AS read_only, txid_current_snapshot()::text AS snapshot`;
   assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.read_only, 'on');
   const started = performance.now(), now = new Date();
   const facts = await transaction`WITH classes AS (
    SELECT id, last_seen_at, count(*) OVER (PARTITION BY location::geometry) AS colocated,
     CASE WHEN unit_type = 'room' THEN 'room' WHEN bedrooms = 0 THEN 'studio'
      WHEN bedrooms = 2 THEN 'two-bedroom' WHEN bedrooms >= 3 THEN 'three-plus' END AS kind
    FROM listings WHERE status = 'active' AND duplicate_of IS NULL
   ), ranked AS (SELECT *, row_number() OVER (PARTITION BY kind ORDER BY colocated DESC, last_seen_at DESC, id) AS rank
    FROM classes WHERE kind IS NOT NULL)
   SELECT id, kind, colocated FROM ranked WHERE rank <= 6 ORDER BY kind, rank`;
   assert.equal(facts.length, 24); assert.equal(new Set(facts.map(row=>row.kind)).size, 4);
   // Both consumers only use ISql tagged queries/unsafe; no pool or transaction lifecycle methods.
   const ownerSql = transaction as unknown as postgres.Sql;
   const load = sqlListingLoader(()=>ownerSql);
   const listings = [];
   for (const fact of facts) { const listing = await load(String(fact.id)); assert.ok(listing); listings.push(listing); }
   const runs = [], differences: {run:number; sample:number; kind:string; fields:string[]}[] = [];
   let baseline: unknown[] = [];
   for (let run = 0; run < 3; run++) {
    clearValuationCache(); const contexts = []; const start = performance.now();
    let estimates = 0, benchmarks = 0, comparables = 0;
    for (const listing of listings) {
     assert.ok(performance.now()-started < 25000, 'bounded snapshot audit exceeded 25s');
     const context = await listingContext(ownerSql, listing, now);
     estimates += Number(context.valuation.status === 'ok');
     benchmarks += Number(context.valuation.benchmark !== null);
     comparables += context.valuation.comparables.length;
     contexts.push(canonical(context));
    }
    assert.ok(estimates > 0 && benchmarks > 0 && comparables > 0, 'sample must exercise estimates, benchmarks and comparables');
    if (run === 0) baseline = contexts;
    else contexts.forEach((context, sample)=> {
     if (JSON.stringify(context) !== JSON.stringify(baseline[sample])) {
      const fields: string[] = [];
      const compare = (before: unknown, after: unknown, path: string) => {
       if (JSON.stringify(before) === JSON.stringify(after)) return;
       if (before && after && typeof before === 'object' && typeof after === 'object') {
        const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) compare(left[key], right[key], path ? `${path}.${key}` : key);
       } else fields.push(path);
      };
      compare(baseline[sample], context, '');
      differences.push({run:run+1,sample,kind:String(facts[sample].kind),fields:fields.slice(0,30)});
     }
    });
    runs.push({run:run+1,count:contexts.length,estimates,benchmarks,comparables,elapsedMs:Math.round(performance.now()-start),sameResults:JSON.stringify(contexts)===JSON.stringify(baseline)});
   }
   const [end] = await transaction`SELECT txid_current_snapshot()::text AS snapshot`;
   assert.equal(end.snapshot, settings.snapshot);
   return {scope:'Read-only repeatable-read single-connection diagnosis, 24 active canonical subjects: six rooms, studios, two-bedroom and three-plus whole units, prioritizing co-located listings; three cold owner-context passes at fixed now',measuredAt:new Date().toISOString(),fixedValuationNow:now.toISOString(),transaction:{isolation:settings.isolation,readOnly:settings.read_only,snapshotUnchanged:end.snapshot===settings.snapshot},sampleClasses:[...new Set(facts.map(row=>row.kind))],subjectsWithColocatedListings:facts.filter(row=>Number(row.colocated)>1).length,runs,differences,elapsedMs:Math.round(performance.now()-started),limits:['One snapshot and 24 subjects cannot prove determinism for all 500 candidates or every SQL tie/cutoff','Comparable, adjustment and caveat arrays canonicalized without dropping membership or scalar values; semantic array order not asserted','Single reserved connection with sequential reads; no concurrency tuning or endpoint/full-pool latency claim','Earlier 500-context cross-snapshot differences remain unclassified; concurrent ingest was not controlled in that probe','No database data/schema writes, owner query changes, provider calls or private prompt output']};
  });
  writeFileSync('../../apps/search/validation/rent-c-context-snapshot.json', JSON.stringify(record,null,2)+'\n');
  process.stdout.write(JSON.stringify(record)+'\n');
  assert.ok(record.runs.every(run=>run.sameResults), 'owner contexts differed inside a fixed read-only snapshot; inspect differing fields');
 } finally {clearValuationCache(); await sql.end({timeout:2});}
},35000);
