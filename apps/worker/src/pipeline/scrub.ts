// Contact scrubbing and the 280-char excerpt (SPEC 8.4). Contact happens on the source site,
// so emails, phone numbers, links, messaging handles and personal names are removed.
// Names are found by context (after "ask for", "my name is", "Mr.", a sign-off), never by a
// name list, so a capitalized word that isn't in one of those spots is left alone.
export const EXCERPT_MAX = 280;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// North American numbers in the usual spellings: 416-555-0199, (647) 555 0199, +1 437.555.0199.
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
// "WeChat: abc123", "WhatsApp ID - abc", "IG: @handle"; and bare @handles.
const MESSAGING =
  /\b(WeChat|WhatsApp|Telegram|Instagram|IG|Line|Kakao|Signal)(\s*(?:ID|id|handle))?\s*[:：-]\s*@?[\w.-]{3,}/gi;
const HANDLE = /(^|\s)@[A-Za-z0-9_.]{3,}/g;

// Capitalized words that follow "contact" / "call" etc. but aren't names ("Contact Us Today").
const NOT_A_NAME =
  "(?!(?:Us|Me|Now|Today|Tomorrow|Our|The|Your|For|To|Anytime|Any|Office|Management|Leasing|Property|Superintendent|Super|Info|Inquiries|Please|Directly|Here|Him|Her|Them|Owner|Landlord|Agent|Realtor|Home|Out|This|That|It|Again|Soon|Back|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Toronto)\\b)";
// "Maria", "O'Brien", "Jean-Luc"; a lone capital letter is never a name.
const NAME = `${NOT_A_NAME}[A-Z](?:[a-z]+|['’][A-Z][a-z]+)(?:-[A-Z][a-z]+)?`;
const FULL_NAME = `${NAME}(?:\\s+${NAME})?`;

const NAME_RULES: RegExp[] = [
  // Verb in either case, name capitalized (so "call today" is left alone).
  new RegExp(
    `\\b((?:[Aa]sk for|[Cc]ontact(?: person)?|[Cc]all|[Tt]ext|[Ee]mail|[Mm]essage|[Ss]peak (?:to|with)|[Rr]each out to|DM|[Dd]m|[Ll]andlord|[Aa]gent|[Rr]ealtor|[Nn]ame)(?::?\\s+))(${FULL_NAME})`,
    "g",
  ),
  new RegExp(`\\b((?:[Mm]y name is|I['’]m|I am)\\s+)(${FULL_NAME})(?=[\\s,.!;)]|$)`, "g"),
  // Not "Miss" ("Don't Miss Out") or "Dr" (usually Drive).
  new RegExp(`\\b((?:Mr|Mrs|Ms)\\.?\\s+)(${FULL_NAME})`, "g"),
  // A sign-off is only a sign-off at the end, or right before removed contact details.
  new RegExp(
    `\\b((?:Thanks|Thank you|Regards|Best regards|Kind regards|Cheers|Sincerely)[,!.]?\\s+)(${FULL_NAME})(?=\\s*(?:[-,.:]?\\s*\\[(?:phone|email) removed\\]|[.!]?\\s*$))`,
    "g",
  ),
];

// "Deniz Rousta, Leasing manager": a name right before a role.
const NAME_BEFORE_ROLE = new RegExp(
  `\\b(${FULL_NAME})(\\s*[,-]?\\s+(?:[Ll]easing|[Pp]roperty|[Bb]uilding) (?:[Mm]anager|[Aa]gent|[Cc]onsultant)|\\s*[,-]?\\s+[Ss]uperintendent)\\b`,
  "g",
);

export function scrub(text: string): string {
  let out = text
    .replace(EMAIL, "[email removed]")
    .replace(URL, "[link removed]")
    .replace(MESSAGING, (_, app: string) => `${app} [contact removed]`)
    .replace(HANDLE, (_, gap: string) => `${gap}[contact removed]`)
    .replace(PHONE, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim();
  for (const rule of NAME_RULES)
    out = out.replace(rule, (_, lead: string) => `${lead}[name removed]`);
  return out.replace(NAME_BEFORE_ROLE, (_, name: string, role: string) => `[name removed]${role}`);
}

export function excerpt(text: string | null): string {
  if (!text) return "";
  const clean = scrub(text);
  if (clean.length <= EXCERPT_MAX) return clean;
  const cut = clean.slice(0, EXCERPT_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 200 ? cut.lastIndexOf(" ") : cut.length)}…`;
}
