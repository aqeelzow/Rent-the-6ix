import { z } from "zod";

export const policeMapUrl =
  "https://crimemap-prod-gsfpgegygeccduda.canadacentral-01.azurewebsites.net/maps/waterloo";

export const PoliceActivitySchema = z.object({
  start: z.iso.date(),
  end: z.iso.date(),
  total: z.number().int().nonnegative(),
  categories: z.array(
    z.object({
      category: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});
