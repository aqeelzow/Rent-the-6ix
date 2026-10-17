import { ParseRequestSchema, ParseResponseSchema, SearchIntentSchema, type ParseResponse, type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { AIUnavailable, NoneProvider, type AIProvider } from '../ai/index';
import { cleanAIIntent } from './clean';
import { fallbackParse, configuredAreas } from './fallback';
import { parseInstruction } from './instruction';
import { DestinationResolver } from './resolve';
import { MemoryCache, IpLimiter, inputHash, type Cache } from './cache';
export { fallbackParse, configuredAreas } from './fallback';
export { DestinationResolver } from './resolve';
export { IpLimiter, RateLimitError, MemoryCache } from './cache';
export class ParseService {
  private cache: Cache<ParseResponse>;
  constructor(private options: { provider?: AIProvider; resolver?: DestinationResolver; cache?: Cache<ParseResponse>; limiter?: IpLimiter; now?: () => Date } = {}) { this.cache = options.cache ?? new MemoryCache<ParseResponse>(); }
  async parse(input: unknown, trustedIp: string): Promise<ParseResponse> {
    const { prompt } = ParseRequestSchema.parse(input);
    this.options.limiter?.check(trustedIp);
    const key = inputHash(`parse-v1:${(this.options.now?.() ?? new Date()).toISOString().slice(0, 10)}:${prompt}`);
    const cached = this.cache.get(key); if (cached) return cached;
    let intent: SearchIntent; let parser: ParseResponse['parser'] = 'fallback'; let notice: string | undefined;
    try {
      intent = SearchIntentSchema.parse(await (this.options.provider ?? new NoneProvider()).generateStructured({ schema: SearchIntentSchema, fast: true, system: parseInstruction + ` Today is ${(this.options.now?.() ?? new Date()).toISOString().slice(0, 10)}. Configured areas: ${JSON.stringify(configuredAreas)}`, prompt }));
      const targetCount = intent.travelTargets.length;
      intent = SearchIntentSchema.parse(cleanAIIntent(intent, prompt));
      // Lost travel constraints would silently widen the search; use the grounded basic interpretation.
      if (intent.travelTargets.length < targetCount) throw new AIUnavailable('invalid');
      const requiredTravel = fallbackParse(prompt, this.options.now?.()).travelTargets.filter(t => t.hard && t.maxMinutes !== undefined);
      if (requiredTravel.some(required => !intent.travelTargets.some(actual => actual.kind === required.kind && (required.kind === 'place' ? actual.query?.toLowerCase() === required.query?.toLowerCase() : actual.category === required.category) && actual.hard && actual.maxMinutes === required.maxMinutes))) throw new AIUnavailable('invalid');
      parser = 'gemini';
    } catch (error) {
      intent = fallbackParse(prompt, this.options.now?.());
      notice = error instanceof AIUnavailable && error.reason === 'busy' ? 'AI busy, used basic search.' : 'Used basic search; review the interpreted filters.';
    }
    const resolver = this.options.resolver ?? new DestinationResolver();
    const destinations = await Promise.all(intent.travelTargets.filter(t => t.kind === 'place' && t.query).map(async target => {
      const resolution = await resolver.resolve(target.query!);
      if (resolution.status === 'resolved') target.resolved = resolution.destination.resolved;
      else delete target.resolved;
      return { targetId: target.id, resolution };
    }));
    const result = ParseResponseSchema.parse({ intent, destinations, parser, ...(notice ? { notice } : {}) });
    // Only successful AI interpretations are cached; temporary failures must be able to recover immediately.
    if (parser === 'gemini') this.cache.set(key, result);
    return result;
  }
}
