import { kijiji } from "./kijiji.ts";
import { realtorCa } from "./realtor-ca.ts";
import { rentalsCa, torontoRentals } from "./rentals-network.ts";
import type { SourceAdapter, SourceId } from "./types.ts";
import { zillow } from "./zillow.ts";

export const sources: Record<SourceId, SourceAdapter> = {
  kijiji,
  torontorentals: torontoRentals,
  rentals_ca: rentalsCa,
  zillow,
  realtor_ca: realtorCa,
};
