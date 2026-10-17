import { type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { civicAreaMatches, type CivicArea } from './civic-areas';
import { configuredAreas } from './fallback';
export function cleanAIIntent(intent: SearchIntent, prompt: string, catalogue: CivicArea[] = []): SearchIntent {
  const source = (key: string) => { const evidence = intent.fieldSources[key]; return evidence?.source === 'ai_prompt' && !!evidence.phrase && prompt.toLowerCase().includes(evidence.phrase.toLowerCase()); };
  const drop = (field: string) => intent.droppedRequests.push({ phrase: field, reason: 'AI interpretation lacked explicit source evidence; review this filter.' });
  for (const field of Object.keys(intent.criteria) as (keyof SearchIntent['criteria'])[]) {
    if (!source(`criteria.${field}`)) { delete intent.criteria[field]; drop(field); }
  }
  intent.areas = intent.areas.filter(area => {
    const evidence = intent.fieldSources.areas?.phrase?.toLowerCase() ?? '';
    const allowed = Object.entries(configuredAreas).some(([name, configured]) => JSON.stringify(configured) === JSON.stringify(area) && new RegExp(`\\b${name}\\b`, 'i').test(evidence)) || civicAreaMatches(prompt, catalogue).some(match => !match.ambiguous && JSON.stringify(match.area) === JSON.stringify(area) && evidence.includes(match.evidence.toLowerCase()));
    if (!source('areas') || !allowed) { drop('areas'); return false; } return true;
  });
  intent.travelTargets = intent.travelTargets.filter(t => {
    delete t.resolved;
    if (!source(`travelTargets.${t.id}`) || t.kind === 'place' && (!t.query || !prompt.toLowerCase().includes(t.query.toLowerCase()))) { drop(t.label); return false; } return true;
  });
  if (intent.household) {
    for (const field of ['annualIncomeCad', 'people'] as const) if (intent.household[field] !== undefined && !source(`household.${field}`)) { delete intent.household[field]; drop(`household.${field}`); }
    if (!Object.keys(intent.household).length) delete intent.household;
  }
  // Only the renter sets a safety limit (the slider); the AI never invents one.
  delete intent.safety.maxRelativeRate;
  if (intent.safety.enabled && (!source('safety') || !/\b(?:safety|safe|safer|crime|city rate)\b/i.test(prompt))) { intent.safety = { enabled:false,hard:false }; drop('safety'); }
  if (intent.sortBy !== 'best_match' && !source('sortBy')) { intent.sortBy = 'best_match'; drop('sortBy'); }
  if (intent.numericExtreme && (!source('numericExtreme') || intent.numericExtreme.field === 'travel' && !intent.travelTargets.some(t => t.id === intent.numericExtreme?.targetId))) { delete intent.numericExtreme; drop('numericExtreme'); }
  // Model-selected weights can add implicit preferences; deterministic score defaults own weights.
  delete intent.weights;
  intent.rawPrompt = prompt;
  return intent;
}
