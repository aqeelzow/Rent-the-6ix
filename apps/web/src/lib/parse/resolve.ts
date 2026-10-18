import { z } from 'zod';
import knownPlaces from './known_places.json';
import { DestinationResolutionSchema, DestinationChoiceSchema, type DestinationResolution } from '../../../../../packages/shared/schemas/index';
import { MemoryCache, inputHash, type Cache } from './cache';
import { namedParkMentions } from './named-parks';
const places = z.array(z.object({ id: z.string(), label: z.string(), aliases: z.array(z.string()), group: z.string().optional(), primary: z.boolean().optional(), lng: z.number(), lat: z.number() })).parse(knownPlaces);
export const normalizePlace = (query: string) => query.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const choice = (p: typeof places[number]) => DestinationChoiceSchema.parse({ id: p.id, label: p.label, resolved: { lng: p.lng, lat: p.lat, source: 'known_place', representativePoint: true, label: p.label } });
const torontoBounds = [-79.65, 43.58, -79.10, 43.87] as const;
const geocodingFeature = z.object({ id: z.string().trim().min(1), place_name: z.string().trim().min(1), text: z.string().optional(), relevance: z.number().min(0).max(1).optional(), place_type: z.array(z.string()).optional(), bbox: z.array(z.number()).optional(), center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) });
const poiName = (name: string) => normalizePlace(name).replace(/^the /, '');
function knownResolution(normalized: string, query: string, preferPrimaryCampus: boolean): DestinationResolution | undefined {
  // Labels used to end in "representative point"; a search saved with one still matches.
  const known = places.filter(p => [...p.aliases, p.label, `${p.label} representative point`].some(a => normalizePlace(a) === normalized));
  if (known.length === 1) return { status: 'resolved', query, destination: choice(known[0]) };
  const group = /^(university of toronto|uoft|u of t)$/.test(normalized) ? 'University of Toronto' : /^(york|york university)$/.test(normalized) ? 'York University' : undefined;
  if (group) {
    const members = places.filter(p => p.group === group), primary = members.filter(p => p.primary);
    // A bare university name is not a real ambiguity for a renter: with no campus named, the main
    // campus is what they mean. Returning choices left the target without coordinates, which blanked
    // every travel figure on the result cards; `representativePoint` still marks it as a stand-in.
    if (primary.length === 1 && preferPrimaryCampus) return { status: 'resolved', query, destination: choice(primary[0]) };
    return { status: 'ambiguous', query, choices: members.map(choice) };
  }
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
    const known = knownResolution(normalized, query, prefersPrimary) ?? knownResolution(normalizePlace(searchQuery), query, prefersPrimary);
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
      if (this.config.areaLookup && !namedParkMentions(query).length) {
        try { const area = await this.config.areaLookup(query, controller.signal); if (area) { const parsed = DestinationResolutionSchema.parse({ ...area, query }); if (parsed.status !== 'unavailable') return parsed; } } catch { /* fall through to geocoding */ }
      }
      if (controller.signal.aborted) return unavailable('Destination lookup timed out.');
      if (!this.config.maptilerKey) return unavailable('Address Points unavailable or unmatched; geocoding is not configured. Choose a pin or provide an exact address.');
      const features = new Map<string, z.infer<typeof geocodingFeature>>();
      const requestedName = poiName(query.replace(/(?:,\s*|\s+)toronto(?:,?\s+ontario)?(?:,?\s+canada)?\s*$/i, ''));
      const matchesName = (feature: z.infer<typeof geocodingFeature>) => feature.place_type?.includes('poi') && poiName(feature.text ?? feature.place_name.split(',')[0]) === requestedName;
      const matchingFeatures = () => {
        // shortcut: lower-score suggestions require an exact POI name at 0.7 or above; tune with labelled Toronto examples.
        const candidates = [...features.values()].filter(feature => (feature.relevance ?? 0) >= 0.9 || (feature.relevance ?? 0) >= 0.7 && matchesName(feature));
        const named = candidates.filter(matchesName);
        return named.length ? named : candidates;
      };
      let failure: string | undefined;
      // Retry the original wording once; never strip a street or branch supplied by the renter.
      for (const lookupQuery of normalizePlace(searchQuery) === normalized ? [searchQuery] : [searchQuery, query]) {
        if (controller.signal.aborted) return unavailable('Destination lookup timed out.');
        try {
          const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(lookupQuery)}.json`);
          // MapTiler excludes named POIs by default; retain its other default types as well.
          url.search = new URLSearchParams({ key: this.config.maptilerKey, country: 'ca', bbox: torontoBounds.join(','), limit: '5', types: 'continental_marine,country,major_landform,region,subregion,county,joint_municipality,joint_submunicipality,municipality,municipal_district,locality,neighbourhood,place,postal_code,address,road,poi' }).toString();
          const response = await (this.config.fetch ?? fetch)(url, { signal: controller.signal });
          if (!response.ok) { failure = 'Geocoding provider unavailable.'; break; }
          const body = z.object({ features: z.array(geocodingFeature) }).parse(await response.json());
          for (const feature of body.features) {
            const [lng, lat] = feature.center;
            if (lng < torontoBounds[0] || lng > torontoBounds[2] || lat < torontoBounds[1] || lat > torontoBounds[3]) continue;
            if (!features.has(feature.id) || (feature.relevance ?? 0) > (features.get(feature.id)!.relevance ?? 0)) features.set(feature.id, feature);
          }
          if (matchingFeatures().some(feature => (feature.relevance ?? 0) >= 0.9)) break;
        } catch { failure = 'Geocoding failed or returned invalid data.'; break; }
      }
      const candidates = matchingFeatures().sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 5);
      const choices = candidates.map(p => DestinationChoiceSchema.parse({ id: p.id, label: p.place_name, resolved: { lng: p.center[0], lat: p.center[1], source: 'maptiler', ...((p.relevance !== 1 || p.bbox || p.place_type?.some(t => ['region','place','locality','neighbourhood','poi'].includes(t))) ? { representativePoint: true, label: p.place_name } : {}) } }));
      if (!choices.length) return unavailable(failure ?? 'No confident destination found. Provide an exact address or pin.');
      if (choices.length === 1 && (candidates[0].relevance ?? 0) >= 0.9) return { status: 'resolved', query, destination: choices[0] };
      return { status: 'ambiguous', query, choices };
    };
    try {
      const result = await Promise.race([work(), new Promise<DestinationResolution>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable('Destination lookup timed out.')); }, Math.min(3000, Math.max(1, this.config.timeoutMs ?? 3000))); })]);
      if (result.status !== 'unavailable') this.cache.set(key, result);
      return result;
    } finally { clearTimeout(timer!); }
  }
}
