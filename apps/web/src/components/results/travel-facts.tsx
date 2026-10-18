"use client";

import { commuteCarbon } from "@rentthe6ix/shared/engine/carbon";
import {
  distanceToPreferredArea,
  preferredReference,
} from "@rentthe6ix/shared/engine/preferred-area";
import { Leaf, MapPin } from "lucide-react";
import { modeIcons } from "@/components/mode-icons";
import { t, type MessageKey } from "@/lib/format/messages";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";
import { carbonSummary, formatCo2e, preferredAreaText } from "./travel-facts-data";

const c = (key: string, params?: Record<string, string | number>) =>
  t(`travel.carbon.${key}` as MessageKey, params);

/**
 * "How far is this from the place I care about, and what would getting there emit?" (owner D)
 *
 * Both figures come from data the result already carries — the renter's own resolved place and
 * the travel rows — so nothing extra is requested and nothing is guessed: the distance is
 * straight-line and labelled as such, and the carbon figure appears only where the router
 * answered (see `packages/shared/engine/carbon.ts`).
 */
export function TravelFacts({
  result,
  targets,
  areas = [],
  className = "",
}: {
  result: SearchResultItem;
  targets: SearchIntent["travelTargets"];
  areas?: SearchIntent["areas"];
  className?: string;
}) {
  const reference = preferredReference({ areas, travelTargets: targets });
  const distance = preferredAreaText(
    distanceToPreferredArea({ location: result.listing.location }, reference),
    reference,
  );
  const carbon = carbonSummary(commuteCarbon(targets, result.travel));
  const ModeIcon = carbon.kind === "figure" ? modeIcons[carbon.mode] : null;

  return (
    <div className={`text-muted-foreground flex flex-col gap-1 text-sm ${className}`}>
      {distance && (
        <p className="figures flex items-start gap-2">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {distance.place
              ? t("travel.preferred.distance", { km: distance.distance, place: distance.place })
              : t("travel.preferred.distanceArea", { km: distance.distance })}
          </span>
        </p>
      )}

      {/* Time estimates do not establish the routed distance needed for carbon figures. */}
      {carbon.kind !== "unrouted" && <p className="flex items-start gap-2">
        {ModeIcon ? (
          <ModeIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        ) : (
          <Leaf aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}
        <span className={carbon.kind === "figure" || carbon.kind === "carFree" ? "figures" : ""}>
          {carbon.kind === "carFree" && c("carFree")}
          {carbon.kind === "figure" &&
            c("figure", { co2e: formatCo2e(carbon.grams), mode: t(`filters.modes.${carbon.mode}` as MessageKey) })}
          {carbon.kind === "transitUnknown" &&
            (carbon.driveGrams === null
              ? c("transitUnknown")
              : c("transitUnknownDrive", { co2e: formatCo2e(carbon.driveGrams) }))}
        </span>
      </p>}
    </div>
  );
}

