import { getClient } from '../db';
import { z } from 'zod';
import { briefingKey, canBrief, validBriefing, writeBriefing, type BriefingFacts } from '../ai/briefing';
import type { AIProvider } from '../ai/index';

type Client = NonNullable<ReturnType<typeof getClient>>;
const readCache = 'SELECT payload FROM ai_cache WHERE key = $1 AND route = $2 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1';
const writeCache = `INSERT INTO ai_cache (key, route, payload, expires_at) VALUES ($1, $2, $3::text::jsonb, NULL)
ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = NULL WHERE ai_cache.route = EXCLUDED.route`;

export async function loadBriefingFacts(kind: 'ward' | 'neighbourhood', id: string, client: Client | null = getClient()): Promise<BriefingFacts | null> {
  if (!client) throw Error('Database unavailable');
  const areaSql = kind === 'ward'
    ? 'SELECT id, name, number FROM wards WHERE id = $1 OR number = $2 LIMIT 1'
    : 'SELECT id, name, number FROM neighbourhoods WHERE id = $1 LIMIT 1';
  const areas = await client.unsafe(areaSql, kind === 'ward' ? [id, /^\d{1,2}$/.test(id) ? Number(id) : -1] : [id]);
  if (!areas[0]) return null;
  const area = z.object({ id: z.string(), name: z.string(), number: z.number().int().nullable() }).parse(areas[0]);
  const rows = await client.unsafe(`SELECT i.indicator_id, i.value, i.unit, i.period, i.source_id, s.title AS source_title, s.url AS source_url, i.note
    FROM area_indicators i JOIN sources s ON s.id = i.source_id
    WHERE i.area_kind = $1 AND i.area_id = $2 AND i.value IS NOT NULL AND i.unit IS NOT NULL AND i.indicator_id !~ '^crime[:_]'
    ORDER BY i.indicator_id, i.period DESC LIMIT 100`, [kind, area.id]);
  return {
    area: { kind, id: area.id, name: area.name, number: area.number },
    indicators: rows.map(row => ({ indicatorId: row.indicator_id, value: Number(row.value), unit: row.unit, period: row.period, sourceId: row.source_id, sourceTitle: row.source_title, sourceUrl: row.source_url, note: row.note })),
    // D's current schema has only ward/neighbourhood kinds. A sourced city comparator contract is required.
    cityIndicators: [],
  };
}

export async function cachedBriefing(facts: BriefingFacts, model: string, client: Client | null = getClient()): Promise<string[] | null> {
  if (!client) return null;
  try {
    const rows = await client.unsafe(readCache, [briefingKey(facts, model), 'area.briefing']);
    const payload = rows[0]?.payload;
    const paragraphs = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.paragraphs : undefined;
    return Array.isArray(paragraphs) && paragraphs.every(p => typeof p === 'string') && validBriefing(paragraphs, facts) ? paragraphs : null;
  } catch { return null; }
}

export async function cacheBriefing(facts: BriefingFacts, model: string, paragraphs: string[], client: Client | null = getClient()): Promise<boolean> {
  if (!client || !validBriefing(paragraphs, facts)) return false;
  try { await client.unsafe(writeCache, [briefingKey(facts, model), 'area.briefing', JSON.stringify({ paragraphs })]); return true; }
  catch { return false; }
}

/** Run after D supplies ward housing and city comparators; never cache thin or template output. */
export async function preGenerateWardBriefings(provider: AIProvider, model: string, client: Client | null = getClient()) {
  if (!client) throw Error('Database unavailable');
  const wards = await client.unsafe('SELECT id FROM wards ORDER BY number');
  let generated = 0, insufficient = 0, unavailable = 0;
  for (const ward of wards) {
    const facts = await loadBriefingFacts('ward', ward.id, client);
    if (!facts || !canBrief(facts)) { insufficient++; continue; }
    if (await cachedBriefing(facts, model, client)) { generated++; continue; }
    const response = await writeBriefing(facts, provider);
    if (response.source !== 'gemini') { unavailable++; continue; }
    if (await cacheBriefing(facts, model, response.paragraphs, client)) generated++;
    else unavailable++;
  }
  return { wards: wards.length, generated, insufficient, unavailable };
}
