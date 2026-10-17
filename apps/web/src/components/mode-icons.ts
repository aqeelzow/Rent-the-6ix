import { Bike, Car, Footprints, TramFront, type LucideIcon } from "lucide-react";

/** One icon per travel mode, used by chips, filters, cards and the map. */
export const modeIcons: Record<"transit" | "drive" | "walk" | "bike", LucideIcon> = {
  transit: TramFront,
  drive: Car,
  walk: Footprints,
  bike: Bike,
};
