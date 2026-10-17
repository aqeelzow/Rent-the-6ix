import { z } from 'zod';
import { getClient } from '../db';
import { MemoryCache } from './cache';
import { civicAreaRow, type CivicArea } from './civic-areas';

export const civicAreasStatement = `SELECT 'neighbourhood' AS kind, id, name, number FROM neighbourhoods
UNION ALL SELECT 'ward' AS kind, id, name, number FROM wards ORDER BY kind, id LIMIT 513`;
type Client = { unsafe(statement: string): PromiseLike<unknown> };
export function civicAreasLookup(client: () => Client | null = getClient, timeoutMs = 1000): () => Promise<CivicArea[]> {
  const cache = new MemoryCache<CivicArea[]>(1);
  let inFlight: Promise<CivicArea[]> | undefined;
  return async () => {
    const cached = cache.get('areas'); if (cached) return cached;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!inFlight) {
        const sql = client(); if (!sql) return [];
        // shortcut: one unfinished read per runtime; late reads populate the bounded cache without delaying parsing.
        inFlight = Promise.resolve(sql.unsafe(civicAreasStatement)).then(result => {
          const areas = z.array(civicAreaRow).max(512).parse(result);
          if (new Set(areas.map(a => `${a.kind}:${a.id}`)).size !== areas.length) throw Error('Duplicate civic IDs');
          if (areas.length) cache.set('areas', areas);
          return areas;
        }).finally(() => { inFlight = undefined; });
      }
      return await Promise.race([inFlight, new Promise<CivicArea[]>(resolve => { timer = setTimeout(() => resolve([]), timeoutMs); })]);
    } catch { return []; }
    finally { clearTimeout(timer); }
  };
}
