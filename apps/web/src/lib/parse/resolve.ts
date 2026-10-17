import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DestinationResolutionSchema, DestinationChoiceSchema, type DestinationResolution } from '../../../../../packages/shared/schemas/index.js';
import { MemoryCache, inputHash, type Cache } from './cache.js';
const places = z.array(z.object({ id: z.string(), label: z.string(), aliases: z.array(z.string()), group: z.string().optional(), lng: z.number(), lat: z.number() })).parse(JSON.parse(readFileSync(new URL('./known_places.json', import.meta.url), 'utf8')));
export const normalizePlace = (query: string) => query.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const choice = (p: typeof places[number]) => DestinationChoiceSchema.parse({ id: p.id, label: p.label, resolved: { lng: p.lng, lat: p.lat, source: 'known_place', representativePoint: true, label: p.label } });
export type AddressLookup = (query: string, signal: AbortSignal) => Promise<DestinationResolution | undefined>;
export class DestinationResolver {
  private cache: Cache<DestinationResolution>;
  constructor(private config: { addressLookup?: AddressLookup; maptilerKey?: string; fetch?: typeof fetch; timeoutMs?: number; cache?: Cache<DestinationResolution> } = {}) { this.cache = config.cache ?? new MemoryCache<DestinationResolution>(); }
  async resolve(input: string): Promise<DestinationResolution> {
    const query = z.string().trim().min(1).max(500).parse(input); const normalized = normalizePlace(query);
    const known = places.filter(p => p.aliases.some(a => normalizePlace(a) === normalized));
    if (known.length === 1) return { status: 'resolved', query, destination: choice(known[0]) };
    const group = /^(university of toronto|uoft|u of t)$/.test(normalized) ? 'University of Toronto' : /^(york|york university)$/.test(normalized) ? 'York University' : undefined;
    if (group) return { status: 'ambiguous', query, choices: places.filter(p => p.group === group).map(choice) };
    const key = inputHash(normalized); const cached = this.cache.get(key); if (cached) return { ...cached, query };
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const unavailable = (reason: string): DestinationResolution => ({ status: 'unavailable', query, reason });
    const work = async (): Promise<DestinationResolution> => {
      if (this.config.addressLookup) {
        try { const address = await this.config.addressLookup(query, controller.signal); if (address) { const parsed = DestinationResolutionSchema.parse({ ...address, query }); if (parsed.status !== 'unavailable') return parsed; } } catch { /* unavailable owner lookup falls through to geocoding */ }
      }
      if (!this.config.maptilerKey) return unavailable('Address Points unavailable or unmatched; geocoding is not configured. Choose a pin or provide an exact address.');
      try {
        const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`);
        url.search = new URLSearchParams({ key: this.config.maptilerKey, country: 'ca', bbox: '-79.65,43.58,-79.10,43.87', limit: '5' }).toString();
        const response = await (this.config.fetch ?? fetch)(url, { signal: controller.signal });
        if (!response.ok) return unavailable('Geocoding provider unavailable.');
        const body = z.object({ features: z.array(z.object({ id: z.string(), place_name: z.string(), place_type: z.array(z.string()).optional(), bbox: z.array(z.number()).optional(), center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) })) }).parse(await response.json());
        const choices = body.features.map(p => DestinationChoiceSchema.parse({ id: p.id, label: p.place_name, resolved: { lng: p.center[0], lat: p.center[1], source: 'maptiler', ...((p.bbox || p.place_type?.some(t => ['region','place','locality','neighbourhood','poi'].includes(t))) ? { representativePoint: true, label: `${p.place_name} representative point` } : {}) } }));
        if (!choices.length) return unavailable('No destination found. Provide an exact address or pin.');
        return choices.length === 1 ? { status: 'resolved', query, destination: choices[0] } : { status: 'ambiguous', query, choices };
      } catch { return unavailable('Geocoding failed or returned invalid data.'); }
    };
    try {
      const result = await Promise.race([work(), new Promise<DestinationResolution>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable('Destination lookup timed out.')); }, Math.min(3000, Math.max(1, this.config.timeoutMs ?? 3000))); })]);
      if (result.status !== 'unavailable') this.cache.set(key, result);
      return result;
    } finally { clearTimeout(timer!); }
  }
}
