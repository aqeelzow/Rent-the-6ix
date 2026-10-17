import { z } from 'zod';

const text = z.string().trim().min(1);
const nonnegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const year = z.number().int().min(1800).max(2100);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const url = z.url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol), 'HTTP(S) URL required');
export const CoordinateSchema = z.strictObject({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) });
export const ModeSchema = z.enum(['transit', 'drive', 'walk', 'bike']);
export const UnitTypeSchema = z.enum(['apartment', 'condo', 'basement', 'house', 'townhouse', 'room']);
export const SearchUnitTypeSchema = z.enum(['apartment', 'condo', 'basement', 'house', 'townhouse', 'room', 'studio']);
export const PriceLabelSchema = z.enum(['underpriced', 'reasonable', 'overpriced']);
const tri = z.enum(['yes', 'no', 'unknown']);
const pref = <T extends z.ZodType>(value: T) => z.strictObject({ value, hard: z.boolean() });
const range = (bound: z.ZodNumber = nonnegative) => z.strictObject({ min: bound.optional(), max: bound.optional() }).refine(v => v.min !== undefined || v.max !== undefined, 'At least one bound required').refine(v => v.min === undefined || v.max === undefined || v.min <= v.max, 'min must not exceed max');
const unique = <T extends z.ZodType>(item: T) => z.array(item).min(1).refine(v => new Set(v).size === v.length, 'Duplicate values');

// DRAFT: root names AreaFilter without a complete shape; publish with A/D before integration.
export const AreaFilterSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('neighbourhood'), id: text }),
  z.strictObject({ kind: z.literal('ward'), id: text }),
  z.strictObject({ kind: z.literal('near'), point: CoordinateSchema, radiusM: positive }),
  z.strictObject({ kind: z.literal('configured'), id: text, label: text, bounds: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]).refine(v => v[0] < v[2] && v[1] < v[3], 'Bounds out of order') }),
]);
export const ResolvedDestinationSchema = CoordinateSchema.extend({ source: z.enum(['address_points', 'maptiler', 'known_place']), representativePoint: z.boolean().optional(), label: text.optional() }).refine(v => !v.representativePoint || !!v.label, 'Representative points need a label');
export const TravelTargetSchema = z.strictObject({
  id: text, kind: z.enum(['place', 'amenity']), label: text,
  query: text.max(500).optional(), normalizedQuery: text.max(500).optional(), resolved: ResolvedDestinationSchema.optional(),
  category: z.enum(['grocery', 'school', 'university', 'library', 'park', 'community_centre', 'pharmacy', 'clinic', 'rapid_transit']).optional(),
  schoolLevel: z.enum(['elementary', 'secondary', 'any']).optional(),
  mode: ModeSchema, alternativeModes: unique(ModeSchema).optional(), maxMinutes: positive.optional(), hard: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.kind === 'place' && (!v.query && !v.resolved || v.category || v.schoolLevel)) ctx.addIssue({ code: 'custom', message: 'Place requires query or resolved coordinates, without amenity fields' });
  if (v.normalizedQuery && !v.query) ctx.addIssue({ code: 'custom', message: 'Normalized query requires an original place query' });
  if (v.kind === 'amenity' && (!v.category || v.query || v.normalizedQuery || v.resolved)) ctx.addIssue({ code: 'custom', message: 'Amenity requires category, without place fields' });
  if (v.schoolLevel && v.category !== 'school') ctx.addIssue({ code: 'custom', message: 'schoolLevel only applies to school' });
  if (v.alternativeModes?.includes(v.mode)) ctx.addIssue({ code: 'custom', message: 'Alternative modes must differ from primary mode' });
});
export const NumericExtremeSchema = z.strictObject({
  field: z.enum(['rent', 'bedrooms', 'bathrooms', 'sizeSqft', 'buildingAge', 'travel']),
  direction: z.enum(['min', 'max']), percentage: positive.max(100), minimumCount: z.number().int().positive().default(10),
  targetId: text.optional(),
}).refine(v => v.field === 'travel' ? !!v.targetId : !v.targetId, 'targetId required only for travel');
export const WeightsSchema = z.strictObject({ value: nonnegative, price: nonnegative, travel: nonnegative, home: nonnegative, safety: nonnegative }).refine(v => Object.values(v).some(n => n > 0), 'At least one weight must be positive');
export const SearchIntentSchema = z.strictObject({
  schemaVersion: z.literal(1), rawPrompt: z.string().max(4000), areas: z.array(AreaFilterSchema),
  criteria: z.strictObject({
    rent: pref(range()).optional(), priceFairness: pref(unique(PriceLabelSchema)).optional(),
    bedrooms: pref(range(nonnegative.int())).optional(), bathrooms: pref(range()).optional(), sizeSqft: pref(range()).optional(),
    unitTypes: pref(unique(SearchUnitTypeSchema)).optional(),
    buildingAge: pref(z.strictObject({ builtAfter: year.optional(), builtBefore: year.optional() }).refine(v => v.builtAfter !== undefined || v.builtBefore !== undefined, 'At least one year required').refine(v => v.builtAfter === undefined || v.builtBefore === undefined || v.builtAfter <= v.builtBefore, 'Years out of order')).optional(),
    airConditioning: pref(z.enum(['any', 'central'])).optional(), petsAllowed: pref(z.enum(['cats', 'dogs', 'any'])).optional(),
    furnished: pref(z.boolean()).optional(), parking: pref(z.boolean()).optional(), laundryInSuite: pref(z.boolean()).optional(), utilitiesIncluded: pref(z.boolean()).optional(),
    availableBy: pref(date).optional(), leaseTerm: pref(z.enum(['short_term', '12_months'])).optional(),
  }),
  travelTargets: z.array(TravelTargetSchema), safety: z.strictObject({ enabled: z.boolean(), hard: z.boolean(), maxRelativeRate: positive.max(5).optional() }).refine(v => v.enabled || !v.hard, 'Hard safety requires opt-in'),
  household: z.strictObject({ annualIncomeCad: positive.optional(), people: z.number().int().positive().optional() }).optional(),
  weights: WeightsSchema.optional(), sortBy: z.enum(['best_match', 'lowest_rent', 'best_value', 'shortest_trips', 'lowest_true_cost', 'newest']),
  fieldSources: z.record(text, z.strictObject({ source: z.enum(['ai_prompt', 'user', 'default']), phrase: text.optional() })),
  droppedRequests: z.array(z.strictObject({ phrase: text, reason: text })), numericExtreme: NumericExtremeSchema.optional(),
}).superRefine((v, ctx) => {
  if (new Set(v.travelTargets.map(t => t.id)).size !== v.travelTargets.length) ctx.addIssue({ code: 'custom', message: 'Travel target IDs must be unique' });
  if (v.numericExtreme?.field === 'travel' && !v.travelTargets.some(t => t.id === v.numericExtreme?.targetId)) ctx.addIssue({ code: 'custom', message: 'Unknown percentile travel target' });
  if (!v.safety.enabled && v.weights?.safety) ctx.addIssue({ code: 'custom', message: 'Safety weight requires opt-in' });
});
export const ListingSchema = z.strictObject({
  id: z.uuid(), source: z.enum(['kijiji', 'torontorentals', 'rentals_ca', 'zillow', 'realtor_ca', 'manual', 'pasted']), sourceListingId: text, sourceUrl: url,
  title: text, excerpt: z.string().max(280), monthlyRentCad: positive, rentIsPerRoom: z.boolean(), bedrooms: nonnegative.int().nullable(), bathrooms: nonnegative.nullable(),
  unitType: UnitTypeSchema.nullable(), sqft: positive.nullable(), yearBuilt: year.nullable(), yearBuiltSource: z.enum(['listing', 'rentsafeto', 'ai_extracted']).nullable(),
  airConditioning: z.enum(['central', 'yes', 'no', 'unknown']), location: CoordinateSchema, locationPrecision: z.enum(['exact', 'street', 'area']),
  addressText: text.nullable(), addressPointId: text.nullable(), buildingId: text.nullable(),
  // Null until D's boundaries are loaded; area requirements stay unconfirmed and safety unavailable.
  neighbourhoodId: text.nullable(), wardId: text.nullable(),
  utilitiesIncluded: z.enum(['yes', 'partial', 'no', 'unknown']), parking: tri, petsAllowed: z.enum(['yes', 'no', 'unknown', 'cats_only', 'dogs_only']), furnished: tri, laundryInSuite: tri,
  availableFrom: date.nullable(), leaseTerm: text.nullable(), imageUrl: url.nullable(), firstSeenAt: timestamp, lastSeenAt: timestamp, updatedAt: timestamp,
  status: z.enum(['active', 'stale', 'removed']), duplicateOf: z.uuid().nullable(), dataStatus: z.enum(['live', 'snapshot', 'demo']),
  fieldEvidence: z.record(text, z.enum(['structured', 'parsed_from_text', 'ai_extracted'])),
}).superRefine((v, ctx) => {
  if (Date.parse(v.firstSeenAt) > Date.parse(v.lastSeenAt)) ctx.addIssue({ code: 'custom', message: 'Listing observation timestamps out of order' });
  if (v.duplicateOf === v.id) ctx.addIssue({ code: 'custom', message: 'Listing cannot duplicate itself' });
});
export const CaveatSchema = z.strictObject({ severity: z.enum(['info', 'warning', 'high']), code: text, title: text, explanation: text });
// `code` and `count` are optional so an adjustment written by another producer still validates.
export const AdjustmentSchema = z.strictObject({
  code: text.optional(), amountCad: z.number().finite(), count: nonnegative.int().optional(), label: text,
});
export const ValuationSchema = z.strictObject({
  status: z.enum(['ok', 'insufficient_data']), estimatedRentCad: positive.optional(), lowCad: positive.optional(), highCad: positive.optional(), differenceCad: z.number().finite().optional(), differencePct: z.number().finite().optional(),
  priceLabel: z.enum(['underpriced', 'reasonable', 'overpriced', 'unknown']),
  // Candidates the engine considered. `comparables` may be a subset (empty when data is insufficient).
  comparableCount: nonnegative.int(),
  // Candidates after the same-building cap (SPEC 7.2): this is the count behind the five-comparable
  // floor and the confidence, so it can be lower than `comparableCount`.
  effectiveCount: nonnegative.int(),
  radiusM: nonnegative, windowDays: positive.int(), confidence: z.enum(['low', 'medium', 'high']),
  comparables: z.array(z.strictObject({ listingId: z.uuid(), rentCad: positive, adjustedRentCad: positive, distanceM: nonnegative, weight: positive, lastSeenAt: timestamp })),
  adjustments: z.array(AdjustmentSchema),
  // Context only (SPEC 7.2), never the estimate; null until D's benchmarks seed exists (P2.15).
  benchmark: z.strictObject({ label: text, valueCad: positive, period: text, sourceId: text }).nullable(), method: text,
}).superRefine((v, ctx) => {
  if (v.comparables.length > v.comparableCount || v.effectiveCount > v.comparableCount) ctx.addIssue({ code: 'custom', message: 'Comparable counts out of order' });
  if (v.status === 'ok' && (v.effectiveCount < 5 || v.estimatedRentCad === undefined || v.lowCad === undefined || v.highCad === undefined || v.differenceCad === undefined || v.differencePct === undefined || v.priceLabel === 'unknown')) ctx.addIssue({ code: 'custom', message: 'Successful valuation needs five effective comparables and computed amounts' });
  if (v.status === 'insufficient_data' && (v.priceLabel !== 'unknown' || v.effectiveCount >= 5 || [v.estimatedRentCad, v.lowCad, v.highCad, v.differenceCad, v.differencePct].some(n => n !== undefined))) ctx.addIssue({ code: 'custom', message: 'Insufficient data cannot claim computed value' });
  if (v.lowCad !== undefined && v.highCad !== undefined && v.lowCad > v.highCad) ctx.addIssue({ code: 'custom', message: 'Valuation bounds out of order' });
  if (v.estimatedRentCad !== undefined && v.differenceCad !== undefined && v.differencePct !== undefined && Math.abs(v.differencePct - 100 * v.differenceCad / v.estimatedRentCad) > 0.1) ctx.addIssue({ code: 'custom', message: 'Valuation difference mismatch' });
});
// DRAFT application row, not a claim about D-owned SQL columns or cache keys.
export const TravelTimeRowSchema = z.strictObject({ listingId: z.uuid(), targetId: text, mode: ModeSchema, distanceM: nonnegative, poiId: text.nullable(), computedAt: timestamp,
  method: z.enum(['otp', 'straight_line']), minutes: nonnegative.nullable(),
}).refine(v => v.method === 'straight_line' ? v.minutes === null : v.minutes !== null, 'Only routed OTP rows may contain minutes');
// DRAFT application shape: D has not published a concrete Safety result type.
export const SafetySchema = z.strictObject({ areaId: text, rate: nonnegative.nullable(), relativeRate: nonnegative.nullable(), byType: z.record(text, nonnegative.nullable()), years: unique(year), caveats: z.array(CaveatSchema).min(1) }).refine(v => (v.rate === null) === (v.relativeRate === null), 'Safety rate and relative rate availability must agree');
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(4).refine(v => v[0][0] === v[v.length - 1][0] && v[0][1] === v[v.length - 1][1], 'Polygon ring must close');
export const AreaSchema = z.strictObject({ id: text, kind: z.enum(['neighbourhood', 'ward']), name: text, number: positive.int().optional(), geometry: z.strictObject({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }), isNIA: z.boolean().optional() });
export const AreaIndicatorSchema = z.strictObject({ areaId: text, indicatorId: text, value: z.number().finite().nullable(), unit: text, period: text, sourceId: text, sampleSize: nonnegative.int().optional(), note: text.optional() });
export const MatchScoreSchema = z.strictObject({ total: nonnegative.int().max(100), parts: z.array(z.strictObject({ id: z.enum(['value', 'price', 'travel', 'home', 'safety']), score: nonnegative.max(100).nullable(), weight: nonnegative, effectiveWeight: nonnegative.max(1), evidence: z.array(text) })).length(5), hardFilterNotes: z.array(text), caveats: z.array(CaveatSchema) }).superRefine((v, ctx) => {
  if (new Set(v.parts.map(p => p.id)).size !== 5) ctx.addIssue({ code: 'custom', message: 'Each score part required exactly once' });
  const weightSum = v.parts.reduce((n, p) => n + (p.score === null ? 0 : p.weight), 0);
  if (v.parts.some(p => Math.abs(p.effectiveWeight - (p.score === null || !weightSum ? 0 : p.weight / weightSum)) > 1e-6)) ctx.addIssue({ code: 'custom', message: 'Effective weights must renormalize known parts' });
  if (v.total !== Math.round(v.parts.reduce((n, p) => n + (p.score ?? 0) * p.effectiveWeight, 0))) ctx.addIssue({ code: 'custom', message: 'Score total mismatch' });
});

export const DestinationChoiceSchema = z.strictObject({ id: text, label: text, resolved: ResolvedDestinationSchema });
export const DestinationResolutionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('resolved'), query: text, destination: DestinationChoiceSchema }),
  z.strictObject({ status: z.literal('ambiguous'), query: text, choices: z.array(DestinationChoiceSchema).min(2) }),
  z.strictObject({ status: z.literal('unavailable'), query: text, reason: text }),
]);
export const ParseRequestSchema = z.strictObject({ prompt: text.max(4000) });
export const ParseResponseSchema = z.strictObject({ intent: SearchIntentSchema, destinations: z.array(z.strictObject({ targetId: text, resolution: DestinationResolutionSchema })), parser: z.enum(['gemini', 'fallback']), notice: text.optional() });
export const SearchRequestSchema = z.strictObject({ intent: SearchIntentSchema, hideUnconfirmed: z.boolean().default(false) });
export const SearchResultSchema = z.strictObject({ listing: ListingSchema, valuation: ValuationSchema, travel: z.array(TravelTimeRowSchema), safety: SafetySchema.nullable(), matchScore: MatchScoreSchema }).refine(v => v.travel.every(t => t.listingId === v.listing.id), 'Travel rows must match listing').refine(v => v.valuation.status !== 'ok' || Math.abs(v.valuation.estimatedRentCad! - v.listing.monthlyRentCad - v.valuation.differenceCad!) < .01, 'Valuation difference must match listing rent').refine(v => !v.safety || v.safety.areaId === v.listing.neighbourhoodId, 'Safety must match listing neighbourhood');
export const SearchResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('completed'), results: z.array(SearchResultSchema), eligibleCount: nonnegative.int(), notices: z.array(text) }).refine(v => v.results.length <= v.eligibleCount, 'Result count exceeds eligible pool'),
  z.strictObject({ status: z.literal('pending'), jobToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/), pollUrl: z.string().regex(/^\/api\/listings\/search\/jobs\/[A-Za-z0-9_-]{32,128}$/), expiresAt: timestamp }).refine(v => v.pollUrl.endsWith('/' + v.jobToken), 'Poll token mismatch'),
  z.strictObject({ status: z.literal('unavailable'), reason: z.enum(['timeout', 'routing_incomplete', 'capacity']), message: text }),
]);
export const ErrorResponseSchema = z.strictObject({ error: z.strictObject({ code: text, message: text, issues: z.array(z.strictObject({ path: z.array(z.union([z.string(), z.number().int()])), message: text })).optional(), retryAfterSeconds: positive.int().optional() }) });
export const JobExpiredResponseSchema = z.strictObject({ error: z.strictObject({ code: z.literal('search_job_expired'), message: text }) });
// RentSafeTO fields mirror D's buildings table and published loader; colours are passed through.
export const BuildingSchema = z.strictObject({ id: text, address: text, addressPointId: text.nullable(), location: CoordinateSchema.nullable(), yearBuilt: year.nullable(), storeys: nonnegative.int().nullable(), units: nonnegative.int().nullable(), propertyType: z.enum(['private', 'social_housing', 'tchc']).nullable(), latestScore: nonnegative.max(100).nullable(), scoreDate: z.iso.date().nullable(), signColour: text.nullable(), previousScores: z.array(z.strictObject({ year, score: nonnegative.max(100) })), sourceId: text.nullable() });
export const DetailResponseSchema = SearchResultSchema.safeExtend({ building: BuildingSchema.nullable().optional(), areas: z.array(AreaSchema), indicators: z.array(AreaIndicatorSchema), duplicates: z.array(ListingSchema) });

export type Listing = z.infer<typeof ListingSchema>;
export type SearchIntent = z.infer<typeof SearchIntentSchema>;
export type TravelTarget = z.infer<typeof TravelTargetSchema>;
export type TravelTimeRow = z.infer<typeof TravelTimeRowSchema>;
export type Valuation = z.infer<typeof ValuationSchema>;
export type Adjustment = z.infer<typeof AdjustmentSchema>;
export type Safety = z.infer<typeof SafetySchema>;
export type Area = z.infer<typeof AreaSchema>;
export type AreaIndicator = z.infer<typeof AreaIndicatorSchema>;
export type MatchScore = z.infer<typeof MatchScoreSchema>;
export type Caveat = z.infer<typeof CaveatSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type DetailResponse = z.infer<typeof DetailResponseSchema>;
export type DestinationResolution = z.infer<typeof DestinationResolutionSchema>;
export type AreaFilter = z.infer<typeof AreaFilterSchema>;
export type NumericExtreme = z.infer<typeof NumericExtremeSchema>;
export type ParseRequest = z.infer<typeof ParseRequestSchema>;
export type ParseResponse = z.infer<typeof ParseResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
