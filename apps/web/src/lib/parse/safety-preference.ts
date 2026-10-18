/** Safety language shared by both parsers and saved-search recovery; later requests take precedence. */
export function safetyPreference(prompt: string): { enabled: boolean; phrase: string; hard: boolean } | null {
  const mentions = /\b(?:(?:crime(?:\s+rates?)?\s+(?:below|under|lower than)\s+|(?:below|under)\s+)(?:the\s+)?city(?:['’]s)?\s+(?:crime\s+)?(?:rate|average)|(?:avoid|away from)\s+(?:high[-\s]+crime|crime|unsafe|dangerous)(?:\s+(?:areas?|neighbou?rhoods?))?|(?:low(?:er|est)?[-\s]+|less\s+)crime(?:\s+rates?)?|safe(?:r|st)?(?:\s+(?:neighbou?rhood|area))?|safety|crime(?:\s+rates?)?|secure\s+(?:neighbou?rhood|area))\b/gi;
  let preference: ReturnType<typeof safetyPreference> = null;
  for (const match of prompt.matchAll(mentions)) {
    const before = prompt.slice(0, match.index).split(/[,.!?;]|\b(?:and|but|however)\b/i).at(-1) ?? '';
    const after = prompt.slice(match.index + match[0].length);
    const unrelated = /\b(?:fire|electrical|food|workplace|road|traffic|pet|child)[-\s]+$/i.test(before) ||
      /^\s+(?:deposit(?:\s+box)?|box|for\s+(?:pets|cats|dogs)|(?:bike|bicycle)\s+storage|podcasts?|novels?)\b/i.test(after);
    if (unrelated) continue;
    const negated = /\b(?:no(?:\s+(?:need|preference|requirement|concern)(?:\s+(?:for|about))?)?|not(?:\s+(?:concerned|worried)(?:\s+about)?)?|without|ignore|ignoring|(?:don['’]t|do not)\s+(?:care(?:\s+about)?|need|want|require|prioritize|consider))\s*(?:a\s+)?$/i.test(before) ||
      /^\s+(?:(?:is|are)\s+not\s+(?:important|required|necessary|a priority|a concern)|(?:isn['’]t|aren['’]t)\s+(?:important|required|necessary|a priority|a concern)|(?:doesn['’]t|does not)\s+matter)\b/i.test(after);
    preference = { enabled: !negated, phrase: match[0], hard: !negated && /\bcity\b/i.test(match[0]) };
  }
  return preference;
}
