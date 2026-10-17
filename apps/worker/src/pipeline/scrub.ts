// Contact scrubbing and the 280-char excerpt (SPEC 8.4). Contact happens on the source site,
// so emails, phone numbers, links and names after "ask for / contact / call" are removed.
export const EXCERPT_MAX = 280;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// North American numbers in the usual spellings: 416-555-0199, (647) 555 0199, +1 437.555.0199.
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
// Verb in either case, name capitalized (so "call today" is left alone).
const NAME_AFTER =
  /\b([Aa]sk for|[Cc]ontact|[Cc]all|[Tt]ext|[Ee]mail|[Mm]essage|[Ll]andlord|[Aa]gent|[Rr]ealtor)(:?\s+)([A-Z][a-z]+(\s+[A-Z][a-z]+)?)/g;

export function scrub(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(URL, "[link removed]")
    .replace(PHONE, "[phone removed]")
    .replace(NAME_AFTER, (_, verb: string, gap: string) => `${verb}${gap}[name removed]`)
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(text: string | null): string {
  if (!text) return "";
  const clean = scrub(text);
  if (clean.length <= EXCERPT_MAX) return clean;
  const cut = clean.slice(0, EXCERPT_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 200 ? cut.lastIndexOf(" ") : cut.length)}…`;
}
