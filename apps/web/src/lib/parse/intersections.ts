const word = String.raw`[\p{L}][\p{L}'’.-]*`;
const street = String.raw`(?:${word}(?:\s+${word}){0,2}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|crescent|cres)\.?(?:\s+(?:east|west|north|south|[news]))?|${word})`;
const pair = new RegExp(String.raw`(?:\b(?:near|around|at|intersection of)\s+|^)(${street}\s+(?:and|&)\s+${street})(?=\s*(?:$|[,;!?]|\b(?:under|over|with|within|for|and)\b))`, 'giu');
const nonStreet = /\b(?:apartments?|condos?|houses?|townhouses?|basements?|rooms?|studios?|bedrooms?|bathrooms?|parks?|schools?|grocer(?:y|ies)|supermarkets?|librar(?:y|ies)|pharmac(?:y|ies)|clinics?|subway|transit|parking|laundry|pets?|cats?|dogs?|furnished|unfurnished|quiet|safe|cheap|spacious)\b/i;

export function possibleIntersections(prompt: string): string[] {
  // shortcut: recognize short street pairs, not arbitrary prose; use a street catalogue for broader detection.
  return [...new Set([...prompt.matchAll(pair)].map(match => match[1]).filter(phrase => !nonStreet.test(phrase)))];
}
