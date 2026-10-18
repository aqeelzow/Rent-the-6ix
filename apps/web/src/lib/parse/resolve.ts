import { z } from 'zod';
import { DestinationResolutionSchema, DestinationChoiceSchema, type DestinationResolution } from '../../../../../packages/shared/schemas/index';
import { distanceM } from '../../../../../packages/shared/engine/travel';
import { MemoryCache, inputHash, type Cache } from './cache';
import { normalizePlace } from './place-name';
import { placeCatalogue, type PlaceEntity } from './place-catalogue';
export { normalizePlace } from './place-name';
const choice = (p: PlaceEntity) => DestinationChoiceSchema.parse({ id: p.id, label: p.label, resolved: { lng: p.lng, lat: p.lat, source: 'known_place', representativePoint: true, label: p.label } });
function knownResolution(normalized: string, query: string, preferPrimaryCampus: boolean, fuzzy = false): DestinationResolution | undefined {
  const match = placeCatalogue.lookup(normalized, fuzzy);
  if (!match) return;
  const primary = match.group && preferPrimaryCampus ? match.places.filter(p => p.primary) : [];
  if (primary.length === 1) return { status: 'resolved', query, destination: choice(primary[0]) };
  if (match.places.length === 1) return { status: 'resolved', query, destination: choice(match.places[0]) };
  return { status: 'ambiguous', query, choices: match.places.map(choice) };
}
export type AddressLookup = (query: string, signal: AbortSignal) => Promise<DestinationResolution | undefined>;
export class DestinationResolver {
  private cache: Cache<DestinationResolution>;
  constructor(private config: { addressLookup?: AddressLookup; areaLookup?: AddressLookup; maptilerKey?: string; fetch?: typeof fetch; timeoutMs?: number; preferPrimaryCampus?: boolean; cache?: Cache<DestinationResolution> } = {}) { this.cache = config.cache ?? new MemoryCache<DestinationResolution>(); }
  async resolve(input: string, normalizedQuery?: string): Promise<DestinationResolution> {
    const query = z.string().trim().min(1).max(500).parse(input); const normalized = normalizePlace(query);
    const searchQuery = normalizedQuery === undefined ? query : z.string().trim().min(1).max(500).parse(normalizedQuery);
    // A normalization must not narrow an already ambiguous campus or override a known original.
    const prefersPrimary = this.config.preferPrimaryCampus !== false;
    const hint = normalizePlace(searchQuery);
    const known = knownResolution(normalized, query, prefersPrimary) ?? knownResolution(hint, query, prefersPrimary) ?? knownResolution(normalized, query, prefersPrimary, true) ?? knownResolution(hint, query, prefersPrimary, true);
    if (known) return known;
    const key = inputHash(JSON.stringify([normalized, normalizePlace(searchQuery)])); const cached = this.cache.get(key); if (cached) return { ...cached, query };
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const unavailable = (reason: string): DestinationResolution => ({ status: 'unavailable', query, reason });
    const work = async (): Promise<DestinationResolution> => {
      if (this.config.addressLookup) {
        try { const address = await this.config.addressLookup(query, controller.signal); if (address) { const parsed = DestinationResolutionSchema.parse({ ...address, query }); if (parsed.status !== 'unavailable') return parsed; } } catch { /* unavailable owner lookup falls through to geocoding */ }
      }
      // Area names ("Liberty Village", "Scarborough") are neither addresses nor full POIs; the
      // City's neighbourhood/ward tables answer them with a labelled representative point.
      if (this.config.areaLookup) {
        try { const area = await this.config.areaLookup(query, controller.signal); if (area) { const parsed = DestinationResolutionSchema.parse({ ...area, query }); if (parsed.status !== 'unavailable') return parsed; } } catch { /* fall through to geocoding */ }
      }
      if (controller.signal.aborted) return unavailable('Destination lookup timed out.');
      if (!this.config.maptilerKey) return unavailable('Address Points unavailable or unmatched; geocoding is not configured. Choose a pin or provide an exact address.');
      try {
        const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(searchQuery)}.json`);
        // MapTiler excludes named POIs by default; retain its other default types as well.
        url.search = new URLSearchParams({ key: this.config.maptilerKey, country: 'ca', bbox: '-79.65,43.58,-79.10,43.87', limit: '5', types: 'continental_marine,country,major_landform,region,subregion,county,joint_municipality,joint_submunicipality,municipality,municipal_district,locality,neighbourhood,place,postal_code,address,road,poi' }).toString();
        const response = await (this.config.fetch ?? fetch)(url, { signal: controller.signal });
        if (!response.ok) return unavailable('Geocoding provider unavailable.');
        const body = z.object({ features: z.array(z.object({ id: z.string(), place_name: z.string(), relevance: z.number().min(0).max(1).optional(), place_type: z.array(z.string()).optional(), bbox: z.array(z.number()).optional(), center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) })) }).parse(await response.json());
        const exact = body.features.filter(p => p.relevance === 1);
        const candidates = exact.length ? exact : body.features.filter(p => (p.relevance ?? 0) >= 0.9);
        const choices = candidates.map(p => DestinationChoiceSchema.parse({ id: p.id, label: p.place_name, resolved: { lng: p.center[0], lat: p.center[1], source: 'maptiler', ...((p.relevance !== 1 || p.bbox || p.place_type?.some(t => ['region','place','locality','neighbourhood','poi'].includes(t))) ? { representativePoint: true, label: `${p.place_name} representative point` } : {}) } }));
        if (!choices.length) return unavailable('No confident destination found. Provide an exact address or pin.');
        // Nearby entrances and attractions share a representative point; distant branches need a choice.
        if (choices.every(a => choices.every(b => distanceM(a.resolved, b.resolved) <= 250))) {
          const destination = choices[0];
          if (choices.length > 1) destination.resolved = { ...destination.resolved, representativePoint: true, label: `${destination.label} representative point` };
          return { status: 'resolved', query, destination };
        }
        return { status: 'ambiguous', query, choices };
      } catch { return unavailable('Geocoding failed or returned invalid data.'); }
    };
    try {
      const result = await Promise.race([work(), new Promise<DestinationResolution>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable('Destination lookup timed out.')); }, Math.min(3000, Math.max(1, this.config.timeoutMs ?? 3000))); })]);
      if (result.status !== 'unavailable') this.cache.set(key, result);
      return result;
    } finally { clearTimeout(timer!); }
  }
}
