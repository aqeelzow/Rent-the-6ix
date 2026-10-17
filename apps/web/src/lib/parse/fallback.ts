import { SearchIntentSchema, type SearchIntent, type TravelTarget, type AreaFilter } from '../../../../../packages/shared/schemas/index';

// shortcut: configured search boxes are approximate, replace with agreed D-owned geographic areas when available.
export const configuredAreas: Record<string, AreaFilter> = {
  downtown: { kind: 'configured', id: 'search-downtown-v1', label: 'Downtown approximate configured search boundary (not an official boundary)', bounds: [-79.425, 43.635, -79.345, 43.675] },
  scarborough: { kind: 'configured', id: 'search-scarborough-v1', label: 'Scarborough approximate configured search boundary (not an official boundary)', bounds: [-79.30, 43.68, -79.10, 43.86] },
};
const amount = (n: string) => Number(n.replace(/[$,\s]/g, '').replace(/k$/i, '')) * (/k$/i.test(n) ? 1000 : 1);
const modes = (s: string): TravelTarget['mode'][] => [...new Set([...s.toLowerCase().matchAll(/\b(transit|ttc|subway|commute|bus|car|drive|driving|walk|walking|bike|biking|cycling)\b/g)].map(m => /car|driv/.test(m[0]) ? 'drive' as const : /walk/.test(m[0]) ? 'walk' as const : /bik|cycl/.test(m[0]) ? 'bike' as const : 'transit' as const))];
const soft = /\b(prefer|ideally|nice|would like|around|close|about)\b/i;
export function fallbackParse(rawPrompt: string, now = new Date()): SearchIntent {
  const intent: SearchIntent = { schemaVersion: 1, rawPrompt, areas: [], criteria: {}, travelTargets: [], safety: { enabled: false, hard: false }, sortBy: 'best_match', fieldSources: {}, droppedRequests: [] };
  const source = (field: string, phrase: string) => { intent.fieldSources[field] = { source: 'ai_prompt', phrase }; };
  const hard = (phrase: string, index = rawPrompt.indexOf(phrase)) => !soft.test(rawPrompt.slice(Math.max(rawPrompt.lastIndexOf('.', index), rawPrompt.lastIndexOf(',', index), rawPrompt.lastIndexOf(';', index)) + 1, index) + phrase);
  const put = <K extends keyof SearchIntent['criteria']>(field: K, value: NonNullable<SearchIntent['criteria'][K]>['value'], phrase: string, isHard = hard(phrase)) => { Object.assign(intent.criteria, { [field]: { value, hard: isHard } }); source(`criteria.${field}`, phrase); };
  const drop = (phrase: string, reason: string) => intent.droppedRequests.push({ phrase, reason });
  for (const [name, area] of Object.entries(configuredAreas)) { const m = rawPrompt.match(new RegExp(`\\b${name}\\b`, 'i')); if (m) { intent.areas.push(area); source('areas', m[0]); } }
  const income = rawPrompt.match(/(?:make|earn|income(?: of| is)?)\s+(?:about\s+)?(\$?[\d,]+(?:\.\d+)?k?)/i);
  if (income) { intent.household = { annualIncomeCad: amount(income[1]) }; source('household.annualIncomeCad', income[0]); }
  const people = rawPrompt.match(/\b(\d+)\s+(?:people|persons|of us)\b/i);
  if (people) { intent.household = { ...intent.household, people: Number(people[1]) }; source('household.people', people[0]); }
  const money = String.raw`\$?\d[\d,]*(?:\.\d+)?k?`;
  const nonRentUnit = /^\s*[-+]?\s*(?:sqft|sq\.?\s*ft|square feet|bedrooms?|beds?|bathrooms?|baths?|rooms?|years?|min(?:ute)?s?|results?)\b|^\s*%/i;
  const rentRange = [...rawPrompt.matchAll(new RegExp(`(?:between\\s+)?(${money})\\s*(?:-|–|to|and)\\s*(${money})(?:\\s*(?:per|a|\\/)?\\s*(?:month|monthly|mo)\\b|\\s+per\\b)?`, 'gi'))].find(m =>
    !(income && m.index >= income.index! && m.index < income.index! + income[0].length) &&
    !nonRentUnit.test(rawPrompt.slice(m.index + m[0].length)) &&
    (/[$k]|\bper\b|month/i.test(m[0]) || /rent|budget|price/i.test(rawPrompt.slice(Math.max(0, m.index - 20), m.index)))
  );
  if (rentRange) {
    const a = amount(rentRange[1]), b = amount(rentRange[2]);
    // A shared trailing k applies to both ends of an abbreviated range such as 3–5k.
    const min = /k$/i.test(rentRange[2]) && !/k$/i.test(rentRange[1]) && a < 100 ? a * 1000 : a;
    if (min <= b) put('rent', { min, max: b }, rentRange[0]); else drop(rentRange[0], 'Rent bounds are reversed; clarify the range.');
  } else {
    const rent = [...rawPrompt.matchAll(new RegExp(`(under|below|less than|no more than|at most|max(?:imum)?(?: rent)?|over|above|at least|min(?:imum)?(?: rent)?)\\s+(${money})`, 'gi'))].find(m =>
      !(income && m.index >= income.index! && m.index < income.index! + income[0].length) &&
      !nonRentUnit.test(rawPrompt.slice(m.index + m[0].length)) &&
      (/[$k]/i.test(m[2]) || amount(m[2]) >= 100 || /rent|budget|price|per month/i.test(rawPrompt.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20)))
    );
    if (rent) put('rent', /over|above|at least|^min/i.test(rent[1]) ? { min: amount(rent[2]) } : { max: amount(rent[2]) }, rent[0]);
  }
  if (!intent.criteria.rent) {
    const budget = rawPrompt.match(new RegExp(`\\b(?:budget|maximum rent|max rent)(?:\\s+(?:of|is))?\\s*:?\\s*(${money})`, 'i'));
    if (budget && !nonRentUnit.test(rawPrompt.slice(budget.index! + budget[0].length))) put('rent', { max: amount(budget[1]) }, budget[0]);
  }
  for (const [field, noun] of [['bedrooms', 'bedrooms?|beds?|rooms?'], ['bathrooms', 'bathrooms?|baths?'], ['sizeSqft', 'sq\\.?\\s*ft|square feet|sqft']] as const) {
    const m = rawPrompt.match(new RegExp(`(?:(at least|minimum|min|over|at most|maximum|max|under)\\s+)?(\\d+(?:\\.\\d+)?)(?:\\s*(-|–|to)\\s*(\\d+(?:\\.\\d+)?))?\\s*[-+]?\\s*(?:${noun})\\b`, 'i'));
    if (m) { const value = Number(m[2]); put(field, m[4] ? { min: value, max: Number(m[4]) } : /at most|maximum|max|under/i.test(m[1] ?? '') ? { max: value } : /at least|minimum|min|over/i.test(m[1] ?? '') || m[0].includes('+') ? { min: value } : { min: value, max: value }, m[0]); }
  }
  const excludedTypes: string[] = [];
  const types = [...rawPrompt.matchAll(/\b(apartments?|condos?|basements?|houses?|townhouses?|room|studio)\b/gi)].filter(m => {
    if (/no\s*$|not\s*$/i.test(rawPrompt.slice(Math.max(0, m.index! - 6), m.index))) { excludedTypes.push(m[0].toLowerCase().replace(/s$/, '')); return false; }
    return m[0].toLowerCase() !== 'room' || !/\d+\s*$/.test(rawPrompt.slice(0, m.index));
  }).map(m => ({ phrase: m[0], value: m[0].toLowerCase().replace(/s$/, '') }));
  if (types.length || excludedTypes.length) {
    const allowed = (types.length ? [...new Set(types.map(t => t.value))] : ['apartment','condo','basement','house','townhouse','room']).filter(t => !excludedTypes.includes(t));
    if (!allowed.length) drop(rawPrompt, 'Unit-type requirements contradict each other; choose allowed types.');
    else put('unitTypes', allowed as NonNullable<SearchIntent['criteria']['unitTypes']>['value'], excludedTypes.length ? rawPrompt : rawPrompt.slice(Math.min(...types.map(t => rawPrompt.indexOf(t.phrase))), Math.max(...types.map(t => rawPrompt.indexOf(t.phrase) + t.phrase.length))));
  }
  const built = rawPrompt.match(/built\s+(after|before|since|in)\s+(\d{4})/i);
  if (built) { const y = Number(built[2]); put('buildingAge', built[1].toLowerCase() === 'in' ? { builtAfter: y, builtBefore: y } : /after|since/i.test(built[1]) ? { builtAfter: y } : { builtBefore: y }, built[0]); }
  else {
    const age = rawPrompt.match(/(less than|under|no more than|at most|maximum|more than|over|older than|at least|minimum|no less than)\s+(\d+)\s+years?\s+old|new build/i);
    if (age) {
      const year = now.getUTCFullYear() - Number(age[2] ?? 10);
      if (year < 1800 || year > 2100) drop(age[0], 'Building age is outside supported construction years; clarify the age.');
      else put('buildingAge', /^(?:more than|over|older than|at least|minimum|no less than)$/i.test(age[1] ?? '') ? { builtBefore: year } : { builtAfter: year }, age[0]);
    }
  }
  const ac = rawPrompt.match(/\b(?:central\s+(?:air|ac)|air conditioning|a\/c|ac)\b/i); if (ac) { if (/no\s*$/i.test(rawPrompt.slice(Math.max(0, ac.index! - 4), ac.index))) drop(ac[0], 'No-AC exclusion is unsupported; clarify.'); else put('airConditioning', /central/i.test(ac[0]) ? 'central' : 'any', ac[0]); }
  const pet = rawPrompt.match(/\b(?:cat(?:s)?[- ]friendly|dog(?:s)?[- ]friendly|cats?(?: allowed)?|dogs?(?: allowed)?|pet[- ]friendly|pets allowed)\b/i); if (pet) { if (/no\s*$/i.test(rawPrompt.slice(Math.max(0, pet.index! - 4), pet.index))) drop(pet[0], 'Pet exclusion is unsupported; clarify.'); else put('petsAllowed', /cat/i.test(pet[0]) ? 'cats' : /dog/i.test(pet[0]) ? 'dogs' : 'any', pet[0]); }
  for (const [field, pattern] of [['furnished', /\b(?:unfurnished|furnished)\b/i], ['parking', /\b(?:no parking|parking)\b/i], ['laundryInSuite', /\b(?:no in[- ]suite laundry|in[- ]suite laundry)\b/i], ['utilitiesIncluded', /\b(?:utilities (?:not )?included)\b/i]] as const) { const m = rawPrompt.match(pattern); if (m) put(field, !/^(no|un)|not/i.test(m[0]), m[0]); }
  const fairness = rawPrompt.match(/\b(?:only underpriced|not overpriced|reasonably priced|good deal|underpriced|overpriced)\b/i);
  if (fairness) put('priceFairness', /not overpriced/i.test(fairness[0]) ? ['underpriced', 'reasonable'] : /reasonably/i.test(fairness[0]) ? ['reasonable'] : /^overpriced/i.test(fairness[0]) ? ['overpriced'] : ['underpriced'], fairness[0], /only/i.test(fairness[0]) || (!/good deal/i.test(fairness[0]) && hard(fairness[0])));
  const safety = rawPrompt.match(/\b(?:safety|safe (?:neighbourhood|area)|low crime|safer|below (?:the )?city (?:crime )?rate)\b/i); if (safety) { intent.safety = { enabled: true, hard: /below/i.test(safety[0]) }; source('safety', safety[0]); }
  const cheapest = rawPrompt.match(/\b(?:cheapest|lowest (?:rent|cost))\b/i); if (cheapest) { intent.sortBy = 'lowest_rent'; source('sortBy', cheapest[0]); }
  if (!cheapest) {
    const value = rawPrompt.match(/\bbest value\b/i);
    const newest = rawPrompt.match(/\b(?:newest listings?|latest listings?|most recently (?:listed|seen)|recently listed|newest first)\b/i);
    if (value || newest) { intent.sortBy = value ? 'best_value' : 'newest'; source('sortBy', (value ?? newest)![0]); }
  }
  const placeCount = [...rawPrompt.matchAll(/\b(?:university of toronto|uoft|u of t|york university|eaton cent(?:er|re)|union station|toronto general hospital|financial district|TD(?: Canada)?\s+(?:on|at))/gi)].length;
  const placeContext = rawPrompt.replace(/\d+\s*(?:minutes?|mins?)\s+(?:by\s+)?(?:transit|drive|walk|bike|car|walking|biking)\s+to\s+(?:(?:a|the|nearest)\s+)?(?:supermarkets?|grocer(?:y|ies)|public schools?|schools?|parks?|subway|librar(?:y|ies)|pharmac(?:y|ies)|clinics?)\b/gi, '');
  const globalModes = placeCount <= 1 ? modes(placeContext) : [];
  const globalTime = placeContext.match(/(?:within|under|no (?:longer|more) than|at most)?\s*(\d+)\s*(?:minutes?|mins?)\b/i);
  const addTarget = (query: string, phrase: string, category?: TravelTarget['category'], localText = phrase) => {
    const existing = intent.travelTargets.find(t => t.query?.toLowerCase() === query.toLowerCase() || category && t.category === category);
    const selectedModes = modes(localText); const targetModes = selectedModes.length ? selectedModes : category ? ['walk' as const] : globalModes.length ? globalModes : ['transit' as const];
    const time = localText.match(/(\d+)\s*(?:minutes?|mins?)/i) ?? (!category && placeCount <= 1 ? globalTime : null);
    if (existing) { if (time) { existing.mode = targetModes[0]; existing.alternativeModes = targetModes.length > 1 ? targetModes.slice(1) : undefined; existing.maxMinutes = Number(time[1]); existing.hard = hard(time[0]); source(`travelTargets.${existing.id}`, localText.trim()); } return; }
    const id = `target-${intent.travelTargets.length + 1}`;
    intent.travelTargets.push({ id, kind: category ? 'amenity' : 'place', label: query, ...(category ? { category, ...(category === 'school' ? { schoolLevel: 'any' as const } : {}) } : { query }), mode: targetModes[0], ...(targetModes.length > 1 ? { alternativeModes: targetModes.slice(1) } : {}), ...(time ? { maxMinutes: Number(time[1]) } : {}), hard: time ? hard(time[0]) : false }); source(`travelTargets.${id}`, phrase);
  };
  const placePattern = /\b(?:university of toronto(?:\s+(?:st\.? george|scarborough|mississauga))?|uoft(?:\s+(?:st\.? george|scarborough|mississauga))?|u of t|york university(?:\s+(?:keele|glendon|markham))?|eaton cent(?:er|re)|union station|toronto general hospital|financial district|TD(?: Canada)?\s+(?:on|at)\s+bay\s*(?:st(?:reet)?\.?)?\s+and\s+queens?\s*(?:st(?:reet)?\.?)?\s*w\.?)\b/gi;
  for (const m of rawPrompt.matchAll(placePattern)) {
    const before = rawPrompt.slice(0, m.index); const after = rawPrompt.slice(m.index! + m[0].length);
    const clause = before.slice(Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf(' and ')) + 1) + m[0] + after.split(/[,;.]|\band\b/i)[0];
    addTarget(m[0], m[0], undefined, clause);
  }
  for (const [category, re] of [['grocery', /\b(?:groceries|grocery|supermarkets?)\b/gi], ['school', /\b(?:public school|schools?)\b/gi], ['park', /\bparks?\b/gi], ['rapid_transit', /\bsubway\b/gi], ['library', /\blibrar(?:y|ies)\b/gi], ['pharmacy', /\bpharmac(?:y|ies)\b/gi], ['clinic', /\bclinics?\b/gi]] as const) {
    for (const m of rawPrompt.matchAll(re)) { if (category === 'rapid_transit' && /by\s*$/i.test(rawPrompt.slice(0, m.index))) continue; const before = rawPrompt.slice(0, m.index); const clause = before.slice(Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf(' and ')) + 1) + m[0]; addTarget(m[0], m[0], category, clause); }
  }
  // Explicit mode/time-to arbitrary addresses complements the small known-place vocabulary.
  for (const m of rawPrompt.matchAll(/(\d+\s*(?:minutes?|mins?)\s+(?:by\s+)?(?:transit|drive|walk|bike|car|walking|biking)\s+to\s+)([^,;.]+)/gi)) {
    const amenity = /^(?:(?:a|the|nearest)\s+)?(supermarkets?|grocer(?:y|ies)|public schools?|schools?|parks?|subway|librar(?:y|ies)|pharmac(?:y|ies)|clinics?)\b/i.exec(m[2].trim());
    const category: TravelTarget['category'] | undefined = amenity ? /supermarket|grocer/i.test(amenity[1]) ? 'grocery' : /school/i.test(amenity[1]) ? 'school' : /park/i.test(amenity[1]) ? 'park' : /subway/i.test(amenity[1]) ? 'rapid_transit' : /librar/i.test(amenity[1]) ? 'library' : /pharmac/i.test(amenity[1]) ? 'pharmacy' : 'clinic' : undefined;
    if (category || !intent.travelTargets.some(t => t.query && m[2].toLowerCase().includes(t.query.toLowerCase()))) addTarget(m[2].trim(), m[0], category, m[0]);
  }
  const extremes = [...rawPrompt.matchAll(/\b(top|bottom)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?(cheapest|most expensive|rent|price|largest|smallest|size|bedrooms?|bathrooms?|oldest|newest|age|shortest|longest|travel|commute)(?:\s+(?:times?|trips?))?/gi)];
  if (extremes.length > 1) for (const m of extremes) drop(m[0], 'Multiple percentile fields require clarification; select one field.');
  else if (extremes.length) {
    const m = extremes[0], name = m[3].toLowerCase(); const field = /bed/.test(name) ? 'bedrooms' : /bath/.test(name) ? 'bathrooms' : /size|largest|smallest/.test(name) ? 'sizeSqft' : /old|new|age/.test(name) ? 'buildingAge' : /short|long|travel|commute/.test(name) ? 'travel' : 'rent';
    const minimum = rawPrompt.match(/min(?:imum)?\s+(\d+)\s+results/i); const percentage = Number(m[2]);
    if (percentage <= 0 || percentage > 100 || minimum && !Number(minimum[1])) drop(m[0], 'Percentile must be greater than 0 through 100 and minimum count positive.');
    else if (field === 'travel' && intent.travelTargets.length !== 1) drop(m[0], 'Travel percentile requires exactly one destination choice.');
    else { intent.numericExtreme = { field, direction: /cheapest|smallest|shortest|newest/.test(name) ? 'min' : /expensive|largest|longest|oldest/.test(name) ? 'max' : m[1].toLowerCase() === 'bottom' ? 'min' : 'max', percentage, minimumCount: minimum ? Number(minimum[1]) : 10, ...(field === 'travel' ? { targetId: intent.travelTargets[0].id } : {}) }; source('numericExtreme', m[0]); }
  }
  for (const m of rawPrompt.matchAll(/\b(?:available|move[- ]in|lease|short[- ]term|12[- ]month)[^,.]*/gi)) drop(m[0], 'Basic parser cannot confirm this availability or lease request; edit the supported filter.');
  const unclearExtreme = rawPrompt.match(/\b(?:top|bottom)\s+\d+(?:\.\d+)?\s*%/i); if (unclearExtreme && !extremes.length) drop(unclearExtreme[0], 'Specify the numeric field and direction for the percentile.');
  for (const m of rawPrompt.matchAll(/\b(?:no pets|balcony|balconies|big|spacious|luxury|quiet)\b/gi)) drop(m[0], 'No measurable supported criterion; clarify a numeric requirement.');
  if (!Object.keys(intent.criteria).length && !intent.travelTargets.length && !intent.areas.length && !intent.numericExtreme && !intent.safety.enabled && intent.sortBy === 'best_match' && !intent.droppedRequests.length) drop(rawPrompt, 'Basic parser could not identify supported constraints; edit filters or clarify.');
  return SearchIntentSchema.parse(intent);
}
