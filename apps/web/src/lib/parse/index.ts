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
import { targetModes } from '../../../../../packages/shared/engine/travel';
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
      try {
        intent = SearchIntentSchema.parse(await (this.options.provider ?? new NoneProvider()).generateStructured({ schema: SearchIntentSchema, fast: true, system: parseInstruction + ` Today is ${(this.options.now?.() ?? new Date()).toISOString().slice(0, 10)}. Configured areas: ${JSON.stringify(configuredAreas)}. Official civic areas: ${JSON.stringify(catalogue)}. Known place labels: ${JSON.stringify(knownPlaces.map(p => p.label))}`, prompt }));
        const targetCount = intent.travelTargets.length;
        intent = SearchIntentSchema.parse(cleanAIIntent(intent, prompt, catalogue));
        // Lost travel constraints would silently widen the search; use the grounded basic interpretation.
        if (intent.travelTargets.length < targetCount) throw new AIUnavailable('invalid');
        const basic = fallbackParse(prompt, this.options.now?.(), catalogue);
        if (namedParkMentions(prompt).some(park => !intent.travelTargets.some(target => target.kind === 'place' && target.query?.toLowerCase().includes(park.phrase.toLowerCase())))) throw new AIUnavailable('invalid');
        if (basic.droppedRequests.some(request => request.reason === 'Area name is ambiguous; specify neighbourhood or ward.')) throw new AIUnavailable('invalid');
        if (basic.areas.some(required => !intent.areas.some(actual => JSON.stringify(actual) === JSON.stringify(required)))) throw new AIUnavailable('invalid');
        const requiredTravel = basic.travelTargets.filter(t => t.hard && t.maxMinutes !== undefined);
        if (requiredTravel.some(required => !intent.travelTargets.some(actual => actual.kind === required.kind && (required.kind === 'place' ? actual.query?.toLowerCase() === required.query?.toLowerCase() : actual.category === required.category) && actual.hard && actual.maxMinutes === required.maxMinutes && targetModes(actual).length === targetModes(required).length && targetModes(actual).every(mode => targetModes(required).includes(mode))))) throw new AIUnavailable('invalid');
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
