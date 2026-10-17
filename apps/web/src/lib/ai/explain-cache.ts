import { getClient } from '../db';

type Client = { unsafe(statement: string, parameters: string[]): PromiseLike<unknown> };
export type ExplanationCache = {
  get(key: string): Promise<string | undefined>;
  set(key: string, explanation: string): Promise<void>;
};

const read = 'SELECT payload FROM ai_cache WHERE key = $1 AND route = $2 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1';
const write = `INSERT INTO ai_cache (key, route, payload, expires_at) VALUES ($1, $2, $3::text::jsonb, NULL)
ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = NULL WHERE ai_cache.route = EXCLUDED.route`;

export function databaseExplanationCache(client: () => Client | null = getClient, timeoutMs = 150): ExplanationCache {
  let inFlight = false;
  const run = async (statement: string, parameters: string[]) => {
    if (inFlight) return;
    let timer: ReturnType<typeof setTimeout> | number | undefined;
    try {
      const sql = client(); if (!sql) return;
      inFlight = true;
      const operation = Promise.resolve(sql.unsafe(statement, parameters)).finally(() => { inFlight = false; });
      return await Promise.race([operation, new Promise<undefined>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    } catch { return; }
    finally { clearTimeout(timer); }
  };
  return {
    async get(key) {
      try {
        const rows = await run(read, [key, 'listings.explain']) as { payload?: unknown }[] | undefined;
        const payload = rows?.[0]?.payload;
        return payload && typeof payload === 'object' && !Array.isArray(payload) && 'explanation' in payload && typeof payload.explanation === 'string' ? payload.explanation : undefined;
      } catch { return undefined; }
    },
    async set(key, explanation) {
      await run(write, [key, 'listings.explain', JSON.stringify({ explanation })]);
    },
  };
}
