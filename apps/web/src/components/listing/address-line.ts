import type { Listing } from "@rentkdubs/shared/schemas";

/**
 * The line under a listing's title: "ICON · 330 Phillip St" when the listing is in a named
 * building (#30), else the address. The name is left out when the title already says it
 * ("2 bed at Vogue Residences"). Null when there is nothing beyond the title to show.
 */
export function addressLine(
  listing: Pick<Listing, "title" | "addressText" | "buildingName">,
): string | null {
  const address = listing.addressText !== listing.title ? listing.addressText : null;
  const name = listing.buildingName;
  if (!name || listing.title.toLowerCase().includes(name.toLowerCase())) return address;
  return address ? `${name} · ${address}` : name;
}
