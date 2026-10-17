"use client";

import {
  CARBON_CAVEATS,
  CARBON_FACTORS,
  COMMUTE_DAYS_PER_YEAR,
  commuteCarbon,
} from "@rentthe6ix/shared/engine/carbon";
import {
  distanceToPreferredArea,
  preferredReference,
} from "@rentthe6ix/shared/engine/preferred-area";
import { Leaf, MapPin } from "lucide-react";
import { modeIcons } from "@/components/mode-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";
import { travelSummaries } from "./card-data";
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
  // The card's own travel line already prints the straight-line kilometres when a trip could not
  // be routed, so this line stays quiet then instead of repeating the same number twice.
  const alreadyShown = travelSummaries(result, targets).some(
    (summary) => summary.kind === "straight_line" && summary.target === reference?.label,
  );
  const carbon = carbonSummary(commuteCarbon(targets, result.travel));
  const ModeIcon = carbon.kind === "figure" ? modeIcons[carbon.mode] : null;

  return (
    <div className={`text-muted-foreground flex flex-col gap-1 text-sm ${className}`}>
      {distance && !alreadyShown && (
        <p className="figures flex items-start gap-2">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {distance.place
              ? t("travel.preferred.distance", { km: distance.distance, place: distance.place })
              : t("travel.preferred.distanceArea", { km: distance.distance })}
          </span>
        </p>
      )}

      <p className="flex items-start gap-2">
        {ModeIcon ? (
          <ModeIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        ) : (
          <Leaf aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}
        <span className={carbon.kind === "figure" || carbon.kind === "carFree" ? "figures" : ""}>
          {carbon.kind === "carFree" && c("carFree")}
          {carbon.kind === "figure" &&
            c("figure", {
              co2e: formatCo2e(carbon.grams),
              mode: t(`filters.modes.${carbon.mode}` as MessageKey),
            })}
          {carbon.kind === "transitUnknown" &&
            (carbon.driveGrams === null
              ? c("transitUnknown")
              : c("transitUnknownDrive", { co2e: formatCo2e(carbon.driveGrams) }))}
          {carbon.kind === "unrouted" && c("unrouted")}
        </span>
      </p>
      <CarbonInfoButton className="self-start text-xs" />
    </div>
  );
}

/**
 * "How carbon is counted" — every figure's source, what it covers, and what it leaves out.
 * Caveat text lives in D's engine so every screen shows the same words.
 */
export function CarbonInfoButton({ className = "" }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`text-primary focus-visible:ring-ring/50 relative z-10 rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-3 ${className}`}
        >
          {c("open")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{c("title")}</DialogTitle>
          <DialogDescription>{c("what")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p>{c("method", { days: formatCount(COMMUTE_DAYS_PER_YEAR) })}</p>
          <h3 className="font-semibold">{c("factorsTitle")}</h3>
          <ul className="flex flex-col gap-2">
            {CARBON_FACTORS.map((factor) => (
              <li key={factor.mode}>
                <span className="font-medium">
                  {t(`filters.modes.${factor.mode}` as MessageKey)}:{" "}
                  {factor.gramsPerKm === null
                    ? c("factorUnknown")
                    : c("factorValue", { grams: formatCount(factor.gramsPerKm) })}
                </span>
                . <span className="text-muted-foreground">{factor.basis}</span>{" "}
                {factor.sourceUrl && (
                  <a
                    href={factor.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="relative z-10 underline underline-offset-2"
                  >
                    {c("source")}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <h3 className="font-semibold">{c("caveatsTitle")}</h3>
          <ul className="flex flex-col gap-2">
            {CARBON_CAVEATS.map((caveat) => (
              <li key={caveat.code}>
                <span className="font-medium">{caveat.title}.</span>{" "}
                <span className="text-muted-foreground">{caveat.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
