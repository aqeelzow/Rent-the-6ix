import type { AIProvider } from './index';
import { inputHash } from '../parse/cache';

export type BriefingIndicator = { indicatorId: string; value: number; unit: string; period: string; sourceId: string; sourceTitle: string; sourceUrl: string; note: string | null };
export type BriefingFacts = { area: { kind: 'ward' | 'neighbourhood'; id: string; name: string; number: number | null }; indicators: BriefingIndicator[]; cityIndicators: BriefingIndicator[] };
export type BriefingResponse = BriefingFacts & { status: 'available' | 'insufficient_data'; paragraphs: string[]; source: 'gemini' | 'template' };

const groups = [
  /rent|afford|shelter|income/i,
  /housing|building|condition|rentsafe|dwelling|tenure/i,
  /develop|construction|growth|population/i,
];
const political = /\b(?:candidate|part(?:y|ies)|campaign|vote|voting|election|councillor|mayor|liberal|conservative|ndp|green party|endorse|elect)\b/i;
const numbers = (text: string) => [...text.matchAll(/(?<![\w])[-+]?\d[\d,]*(?:\.\d+)?%?/g)].map(m => Number(m[0].replace(/[, %]/g, '')));

export function canBrief(facts: BriefingFacts): boolean {
  return groups.every(group => facts.indicators.some(i => group.test(i.indicatorId)) && facts.cityIndicators.some(i => group.test(i.indicatorId) && facts.indicators.some(a => a.indicatorId === i.indicatorId && a.unit === i.unit && a.period === i.period)));
}

export function validBriefing(paragraphs: string[], facts: BriefingFacts): boolean {
  if (paragraphs.length !== 3 || paragraphs.some(p => !p.trim() || p.length > 500) || political.test(paragraphs.join(' '))) return false;
  const allowed = new Set([facts.area.number, ...[...facts.indicators, ...facts.cityIndicators].flatMap(i => [i.value, ...numbers(i.period)])].filter((n): n is number => n !== null));
  return paragraphs.every((p, index) => groups[index].test(p) && numbers(p).every(n => allowed.has(n)));
}

export function templateBriefing(facts: BriefingFacts): BriefingResponse {
  const descriptions = ['rents and affordability', 'housing stock and conditions', 'growth and development'];
  const paragraphs = descriptions.map((description, index) => {
    const row = facts.indicators.find(i => groups[index].test(i.indicatorId));
    if (!row) return `Not enough data is available to describe ${description} in ${facts.area.name}.`;
    const city = facts.cityIndicators.find(i => i.indicatorId === row.indicatorId && i.unit === row.unit && i.period === row.period);
    return city
      ? `For ${description}, ${row.indicatorId.replace(/[_:]/g, ' ')} is ${row.value} ${row.unit} in ${facts.area.name} and ${city.value} ${city.unit} in Toronto (${row.period}; ${row.sourceTitle}; ${city.sourceTitle}).`
      : `The available ${description} data for ${facts.area.name} includes ${row.indicatorId.replace(/[_:]/g, ' ')}: ${row.value} ${row.unit} (${row.period}; ${row.sourceTitle}). Further sourced context is needed for a full comparison with Toronto.`;
  });
  return { ...facts, status: canBrief(facts) ? 'available' : 'insufficient_data', paragraphs, source: 'template' };
}

export function briefingKey(facts: BriefingFacts, model: string): string { return inputHash(`area.briefing:v1:${model}:${JSON.stringify(facts)}`); }

export async function writeBriefing(facts: BriefingFacts, provider: AIProvider): Promise<BriefingResponse> {
  if (!canBrief(facts)) return templateBriefing(facts);
  const prompt = JSON.stringify(facts);
  const system = 'Write exactly three short paragraphs separated by blank lines: rents and affordability; housing stock and conditions; growth and development. Use only the supplied area and city indicators, periods and sources. Mention data years. Be neutral and factual. Do not discuss candidates, parties, voting, politics or policy recommendations. Do not infer a value from a missing indicator or use crime as a housing indicator. Every number must be present in the supplied facts.';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const paragraphs = (await provider.generateText({ system, prompt })).trim().split(/\n\s*\n/).map(p => p.trim());
      if (validBriefing(paragraphs, facts)) return { ...facts, status: 'available', paragraphs, source: 'gemini' };
    } catch { break; }
  }
  return templateBriefing(facts);
}
