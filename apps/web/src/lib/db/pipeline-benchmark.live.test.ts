import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { ParseService } from '../parse';
import { sqlSearchDependencies } from './candidates-context';
import { listingContext, clearValuationCache } from './valuation';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { tieBreak } from '../../../../../packages/shared/engine/score';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
// Read-only real DB performance probe: RUN_LIVE_CONTEXT_PIPELINE=1 pnpm --filter web exec vitest run src/lib/db/pipeline-benchmark.live.test.ts
test.skipIf(process.env.RUN_LIVE_CONTEXT_PIPELINE !== '1')('controlled actual 500-context cold bounded pipeline comparison', async () => {
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
  const record={scope:'Read-only actual DB, direct owner C listingContext for the same 500 ordinary best-match couple candidates; no B cache; no HTTP endpoint latency claim',measuredAt:new Date().toISOString(),fixedValuationNow:now.toISOString(),databaseClient:'postgres max 2, default pipeline; owner queries/algorithms unchanged',cheapPoolCount:pool.length,selection:'Same cheap hard filters and best-match hard-confirmation/confirmed-field/recency/rent ordering as ordinary candidate selection; hard travel is unknown and passes',runs,limits:['Only the representative couple pool was measured; not every possible pool or concurrent deployment load','C valuation cache cleared before every pass; database buffers and network caches are not flushed','Result comparison canonicalizes array order to ignore equal-distance comparable ordering; semantic array order is not asserted','Direct owner timings exclude B request SQL, filtering, schema validation, scoring, response serialization and routing']};
  writeFileSync('../../apps/search/validation/rent-c-500-context-concurrency.json',JSON.stringify(record,null,2)+'\n');
  assert.ok(runs.every(r=>r.sameResults),'owner results changed');
 } finally {await sql.end({timeout:2});}
},180000);
