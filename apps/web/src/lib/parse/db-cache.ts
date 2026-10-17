import { z } from 'zod';
import { SearchIntentSchema, type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { getClient } from '../db';
import { configuredAreas } from './fallback';

export interface IntentCache {
  get(key: string, prompt: string): Promise<SearchIntent | undefined>;
  set(key: string, prompt: string, intent: SearchIntent): Promise<void>;
}
type Client = { unsafe(statement: string, parameters: (string | number)[]): PromiseLike<unknown> };
const span = z.tuple([z.number().int().nonnegative(), z.number().int().positive()]);
const payloadSchema = z.strictObject({ intent: SearchIntentSchema, sources: z.record(z.string(), span), targets: z.array(z.strictObject({ label: span, query: span.optional() })) });
const route = 'search.parse';
export const parseCacheRead = 'SELECT payload FROM ai_cache WHERE key = $1 AND route = $2 AND expires_at > now() LIMIT 1';
// Bind JSON as text so postgres does not encode an already serialized string again.
export const parseCacheWrite = `INSERT INTO ai_cache (key, route, payload, expires_at) VALUES ($1, $2, $3::text::jsonb, now() + interval '5 minutes') ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at WHERE ai_cache.route = EXCLUDED.route`;

function pack(prompt: string, input: SearchIntent) {
  const intent = SearchIntentSchema.parse(structuredClone(input));
  // shortcut: cache only losslessly grounded parses without generated clarification text; broaden when a privacy-safe reason vocabulary exists.
  if (intent.droppedRequests.length || intent.travelTargets.some(t => t.normalizedQuery || !/^target-\d+$/.test(t.id)) || intent.areas.some(a => !Object.values(configuredAreas).some(known => JSON.stringify(a) === JSON.stringify(known)))) return;
  const locate = (text: string): z.infer<typeof span> => {
    const start = prompt.indexOf(text);
    if (start < 0 || !text) throw new Error('Ungrounded cache text');
    return [start, start + text.length];
  };
  const sources: Record<string, z.infer<typeof span>> = {};
  const allowed = new Set(['areas', 'safety', 'sortBy', 'numericExtreme', ...Object.keys(intent.criteria).map(k => `criteria.${k}`), ...Object.keys(intent.household ?? {}).map(k => `household.${k}`), ...intent.travelTargets.map(t => `travelTargets.${t.id}`)]);
  for (const [key, source] of Object.entries(intent.fieldSources)) {
    if (!allowed.has(key) || source.source !== 'ai_prompt' || !source.phrase) return;
    sources[key] = locate(source.phrase);
  }
  const targets = intent.travelTargets.map(target => {
    const result = { label: locate(target.label), ...(target.query ? { query: locate(target.query) } : {}) };
    target.label = '_';
    if (target.query) target.query = '_';
    delete target.resolved;
    return result;
  });
  intent.rawPrompt = ''; intent.fieldSources = {};
  return payloadSchema.parse({ intent, sources, targets });
}
function unpack(payload: unknown, prompt: string): SearchIntent {
  const { intent, sources, targets } = payloadSchema.parse(payload);
  const text = ([start, end]: z.infer<typeof span>) => {
    if (start >= end || end > prompt.length) throw new Error('Invalid cache span');
    return prompt.slice(start, end);
  };
  if (targets.length !== intent.travelTargets.length || intent.rawPrompt || Object.keys(intent.fieldSources).length || intent.droppedRequests.length) throw new Error('Invalid cache intent');
  intent.rawPrompt = prompt;
  for (const [key, range] of Object.entries(sources)) intent.fieldSources[key] = { source: 'ai_prompt', phrase: text(range) };
  intent.travelTargets.forEach((target, index) => {
    if (target.label !== '_' || target.query !== undefined && target.query !== '_' || target.resolved) throw new Error('Invalid cached target');
    target.label = text(targets[index].label);
    if (targets[index].query) target.query = text(targets[index].query!);
  });
  const result = SearchIntentSchema.parse(intent);
  // Reapply the writer's privacy/grounding checks to malformed or old stored rows.
  if (!pack(prompt, result)) throw new Error('Invalid cache grounding');
  return result;
}
export function databaseIntentCache(client: () => Client | null = getClient, timeoutMs = 150): IntentCache {
  let inFlight = false;
  const run = async (statement: string, parameters: (string | number)[]) => {
    if (inFlight) return;
    let timer: ReturnType<typeof setTimeout> | number | undefined;
    try {
      const sql = client(); if (!sql) return;
      inFlight = true;
      // shortcut: ignore late results and allow one unfinished cache operation per runtime; use an owner-bounded connection if cancellation is needed.
      const operation = Promise.resolve(sql.unsafe(statement, parameters)).finally(() => { inFlight = false; });
      return await Promise.race([operation, new Promise<undefined>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    } catch { return; }
    finally { clearTimeout(timer); }
  };
  return {
    async get(key, prompt) {
      try {
        const rows = z.array(z.object({ payload: z.unknown() })).max(1).parse(await run(parseCacheRead, [key, route]));
        return rows.length ? unpack(rows[0].payload, prompt) : undefined;
      } catch { return; }
    },
    async set(key, prompt, intent) {
      try { const payload = pack(prompt, intent); if (payload) await run(parseCacheWrite, [key, route, JSON.stringify(payload)]); }
      catch { /* Cache errors never fail a valid interpretation. */ }
    },
  };
}
