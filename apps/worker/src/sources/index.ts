import { kijiji } from "./kijiji.ts";
import { realtorCa } from "./realtor-ca.ts";
import { rentalsCa } from "./rentals-network.ts";
import type { AdapterId, SourceAdapter } from "./types.ts";
import { zillow } from "./zillow.ts";

export const sources: Record<AdapterId, SourceAdapter> = {
  kijiji,
  rentals_ca: rentalsCa,
  zillow,
  realtor_ca: realtorCa,
};
