// Scam-indicator text rules (SPEC 7.7), shared by the engine and the worker. No imports, so the
// worker can load it under plain Node and run it on full descriptions at ingest.

// A money word and a "before the viewing" phrase in the same sentence, in either order.
const MONEY = String.raw`\b(?:deposit|e-?transfer|etransfer|interac|first (?:and|&) last|payment|wire|western union|gift cards?|bitcoin|crypto)\b`;
const BEFORE_VIEWING = String.raw`\b(?:before|prior to|to (?:book|schedule|arrange|secure|hold|reserve))\b[^.!?]{0,40}?\b(?:view(?:ing)?|showing|visit|tour|see (?:it|the (?:unit|place|apartment))|keys?)\b`;
const MONEY_BEFORE_VIEWING = new RegExp(
  `${MONEY}[^.!?]{0,80}?${BEFORE_VIEWING}|${BEFORE_VIEWING}[^.!?]{0,80}?${MONEY}`,
  "i",
);

// "Send the deposit and I'll mail you the keys": the landlord never shows the unit.
const KEYS_BY_MAIL = /\b(?:mail|courier|ship|post)(?:ed)? (?:you )?the keys?\b/i;

export function asksForMoneyBeforeViewing(text: string): boolean {
  return (
    MONEY_BEFORE_VIEWING.test(text) ||
    (KEYS_BY_MAIL.test(text) && new RegExp(MONEY, "i").test(text))
  );
}
