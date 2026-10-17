import { kijiji } from "./kijiji.ts";
import { realtorCa } from "./realtor-ca.ts";
import { rentalsCa, torontoRentals } from "./rentals-network.ts";
import type { AdapterId, SourceAdapter } from "./types.ts";
import { zillow } from "./zillow.ts";

export const sources: Record<AdapterId, SourceAdapter> = {
  kijiji,
  torontorentals: torontoRentals,
  rentals_ca: rentalsCa,
  zillow,
  realtor_ca: realtorCa,
};
