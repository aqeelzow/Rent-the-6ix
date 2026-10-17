import { z } from 'zod';
import type { AreaFilter } from '../../../../../packages/shared/schemas/index';

export const civicAreaRow = z.object({ kind: z.enum(['neighbourhood', 'ward']), id: z.string().trim().min(1), name: z.string().trim().min(1), number: z.number().int().positive().nullable() });
export type CivicArea = z.infer<typeof civicAreaRow>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function civicAreaMatches(prompt: string, catalogue: CivicArea[]) {
  const matches: { area: AreaFilter; phrase: string; evidence: string; ambiguous: boolean }[] = [];
  for (const area of catalogue) {
    const name = escape(area.name);
    const named = new RegExp(`\\b(?:(?:in\\s+(?:the\\s+)?(?:(neighbourhood|ward)\\s+)?)|(?:(neighbourhood|ward)\\s+))(${name})(?![\\w-])`, 'gi');
    const mentions = [...prompt.matchAll(named)].filter(m => !/\b(?:near|to|not|outside)\s*$/i.test(prompt.slice(0, m.index)) && (!(m[1] ?? m[2]) || (m[1] ?? m[2]).toLowerCase() === area.kind)).map(m => ({ phrase: m[0], evidence: m[3], explicit: !!(m[1] ?? m[2]) }));
    if (prompt.trim().toLowerCase() === area.name.toLowerCase()) mentions.push({ phrase: prompt.trim(), evidence: prompt.trim(), explicit: false });
    if (area.kind === 'ward' && area.number !== null) for (const m of prompt.matchAll(/\bward\s+(\d{1,2})\b/gi)) {
      if (Number(m[1]) === area.number && !/\b(?:near|to|not(?:\s+in)?|outside)\s*$/i.test(prompt.slice(0, m.index))) mentions.push({ phrase: m[0], evidence: m[0], explicit: true });
    }
    for (const mention of mentions) {
      const ambiguous = !mention.explicit && catalogue.filter(a => a.name.toLowerCase() === area.name.toLowerCase()).length > 1;
      matches.push({ area: { kind: area.kind, id: area.id }, phrase: mention.phrase, evidence: mention.evidence, ambiguous });
    }
  }
  return matches;
}
