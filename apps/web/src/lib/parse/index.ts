import { z } from 'zod';
import { ParseRequestSchema, ParseResponseSchema, SearchIntentSchema, type ParseResponse, type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { AIUnavailable, NoneProvider, type AIProvider } from '../ai/index';
import { cleanAIIntent } from './clean';
import type { IntentCache } from './db-cache';
import type { CivicArea } from './civic-areas';
import knownPlaces from './known_places.json';
import { parseInstruction } from './instruction';
import { fallbackParse, configuredAreas } from './fallback';
import { DestinationResolver } from './resolve';
import { MemoryCache, IpLimiter, inputHash, type Cache } from './cache';
import { possibleIntersections } from './intersections';
import { namedParkMentions } from './named-parks';
export { fallbackParse, configuredAreas } from './fallback';
export { DestinationResolver } from './resolve';
export { IpLimiter, RateLimitError, MemoryCache } from './cache';
export class ParseService {
  private cache: Cache<ParseResponse>;
  constructor(private options: { provider?: AIProvider; resolver?: DestinationResolver; cache?: Cache<ParseResponse>; limiter?: IpLimiter; now?: () => Date; intentCache?: IntentCache; cacheNamespace?: string; civicAreas?: () => Promise<CivicArea[]> } = {}) { this.cache = options.cache ?? new MemoryCache<ParseResponse>(); }
  async parse(input: unknown, trustedIp: string): Promise<ParseResponse> {
    const { prompt } = ParseRequestSchema.parse(input);
    this.options.limiter?.check(trustedIp);
    const catalogue = await this.options.civicAreas?.() ?? [];
    const key = inputHash(`parse-v2:${this.options.cacheNamespace ?? "default"}:${inputHash(parseInstruction + JSON.stringify(configuredAreas) + JSON.stringify(catalogue) + JSON.stringify(knownPlaces.map(p => p.label)))}:${(this.options.now?.() ?? new Date()).toISOString().slice(0, 10)}:${prompt}`);
    const cached = this.cache.get(key); if (cached) return cached;
    let intent: SearchIntent; let parser: ParseResponse['parser'] = 'fallback'; let notice: string | undefined = this.options.civicAreas && !catalogue.length ? 'Official area catalogue unavailable; review area filters.' : undefined;
    const stored = await this.options.intentCache?.get(key, prompt);
    if (stored) { intent = stored; parser = 'gemini'; } else {
      // Rejection steps are logged without prompt content so a failed interpretation is diagnosable.
      const reject = (step: string) => { console.warn('[search.parse] AI interpretation rejected', { step }); return new AIUnavailable('invalid'); };
      try {
        intent = SearchIntentSchema.parse(await (this.options.provider ?? new NoneProvider()).generateStructured({ schema: SearchIntentSchema, fast: true, system: parseInstruction + ` Today is ${(this.options.now?.() ?? new Date()).toISOString().slice(0, 10)}. Configured areas: ${JSON.stringify(configuredAreas)}. Official civic areas: ${JSON.stringify(catalogue)}. Known place labels: ${JSON.stringify(knownPlaces.map(p => p.label))}`, prompt }));
        intent = SearchIntentSchema.parse(cleanAIIntent(intent, prompt, catalogue));
        // Nothing survived the evidence check: the model added no grounded constraint, so the
        // deterministic interpretation is the honest answer (and says AI wasn't used).
        const grounded = intent.travelTargets.length + Object.keys(intent.criteria).length + intent.areas.length + (intent.household ? 1 : 0) + (intent.numericExtreme ? 1 : 0) + (intent.safety.enabled ? 1 : 0) + (intent.sortBy !== 'best_match' ? 1 : 0);
        if (!grounded) throw reject('no_grounded_interpretation');
        const basic = fallbackParse(prompt, this.options.now?.(), catalogue);
        // A named park the model dropped would turn "near High Park" into any listing in the city.
        if (namedParkMentions(prompt).some(park => !intent.travelTargets.some(target => target.kind === 'place' && target.query?.toLowerCase().includes(park.phrase.toLowerCase())))) throw reject('named_park');
        if (basic.droppedRequests.some(request => request.reason === 'Area name is ambiguous; specify neighbourhood or ward.')) throw reject('ambiguous_area');
        // Areas are keyword facts, not interpretation. Prefer the deterministic match: requiring
        // the model to reproduce a configured-area object rejected otherwise-good parses, and a
        // union of the two would widen an OR filter.
        if (basic.areas.length) {
          intent.areas = basic.areas;
          if (basic.fieldSources.areas) intent.fieldSources.areas = basic.fieldSources.areas;
          else delete intent.fieldSources.areas;
        }
        // A model that softens or drops a bound the deterministic parser found would silently
        // widen the search. Restore that bound on the model's target, or add the grounded target,
        // instead of throwing the whole (otherwise good) interpretation away and paying for a retry.
        for (const required of basic.travelTargets.filter(t => t.hard && t.maxMinutes !== undefined)) {
          const match = intent.travelTargets.find(actual => actual.kind === required.kind && (required.kind === 'place' ? actual.query?.toLowerCase() === required.query?.toLowerCase() : actual.category === required.category));
          if (match) {
            match.hard = true;
            match.maxMinutes = required.maxMinutes;
            match.mode = required.mode;
            if (required.alternativeModes) match.alternativeModes = required.alternativeModes;
            else delete match.alternativeModes;
          } else {
            const id = `target-${intent.travelTargets.length + 1}`;
            intent.travelTargets.push({ ...required, id });
            const evidence = basic.fieldSources[`travelTargets.${required.id}`];
            if (evidence) intent.fieldSources[`travelTargets.${id}`] = evidence;
          }
        }
        intent = SearchIntentSchema.parse(intent);
        parser = 'gemini';
      } catch (error) {
        console.warn('[search.parse] Gemini parse fell back', {
          reason: error instanceof AIUnavailable ? error.reason : error instanceof z.ZodError ? 'schema_validation' : 'parse_validation',
          status: error instanceof AIUnavailable && error.reason === 'busy' ? error.status : undefined,
        });
        intent = fallbackParse(prompt, this.options.now?.(), catalogue);
        notice = [notice, error instanceof AIUnavailable && error.reason === 'busy' ? 'AI busy, used basic search.' : 'Used basic search; review the interpreted filters.'].filter(Boolean).join(' ');
      }
      if (parser === 'gemini') await this.options.intentCache?.set(key, prompt, intent);
    }
    const resolver = this.options.resolver ?? new DestinationResolver();
    const destinations = await Promise.all(intent.travelTargets.filter(t => t.kind === 'place' && t.query).map(async target => {
      const resolution = await resolver.resolve(target.query!, target.normalizedQuery);
      if (resolution.status === 'resolved') {
        target.resolved = resolution.destination.resolved;
        if (target.normalizedQuery) target.label = resolution.destination.label;
      }
      else delete target.resolved;
      return { targetId: target.id, resolution };
    }));
    for (const phrase of possibleIntersections(prompt)) {
      const resolved = intent.travelTargets.some(target => target.resolved && target.query?.toLowerCase() === phrase.toLowerCase());
      if (resolved) continue;
      // Replace a generic parse failure with a useful clarification, preserving other requests.
      intent.droppedRequests = intent.droppedRequests.filter(request => request.phrase !== phrase && !(request.phrase === prompt && request.reason === 'Basic parser could not identify supported constraints; edit filters or clarify.'));
      intent.droppedRequests.push({ phrase, reason: 'Did you mean an intersection? Confirm both full street names and directions, or provide an exact nearby address or pin. The intersection has not been confirmed.' });
    }
    const result = ParseResponseSchema.parse({ intent, destinations, parser, ...(notice ? { notice } : {}) });
    // Only successful AI interpretations are cached; temporary failures must be able to recover immediately.
    if (parser === 'gemini') this.cache.set(key, result);
    return result;
  }
}
