import { Info } from "lucide-react";
import { t } from "@/lib/format/messages";

/**
 * The disclaimer shown wherever police-reported crime figures appear (the map layer, the safety
 * preference, results, the listing and ward pages): a higher reported rate doesn't make a
 * neighbourhood a worse place to live, and statistics don't reflect any one person's experience.
 */
export function CrimeDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`bg-caveat-info text-caveat-info-foreground flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs ${className}`}
    >
      <Info aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{t("results.crimeDisclaimer")}</span>
    </p>
  );
}
