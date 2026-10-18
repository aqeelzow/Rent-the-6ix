"use client";

import { SAFETY, engineConfig } from "@rentthe6ix/shared/engine/config";
import { SAFETY_CAVEATS } from "@rentthe6ix/shared/engine/safety";
import { CrimeDisclaimer } from "./crime-disclaimer";
import type { Caveat } from "@rentthe6ix/shared/schemas";
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

const s = (key: string, params?: Record<string, string | number>) =>
  t(`results.safetyInfo.${key}` as MessageKey, params);

/**
 * "How this works" for the opt-in safety preference (SPEC 7.6): what the figure is, how it
 * affects ranking, and every caveat. Caveat text comes from D's engine (one source for all
 * screens); pass a result's own caveats to include how its city rate was worked out.
 */
export function SafetyInfoButton({
  caveats = SAFETY_CAVEATS,
  className = "",
}: {
  caveats?: Caveat[];
  className?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`text-primary focus-visible:ring-ring/50 relative z-10 rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-3 ${className}`}
        >
          {s("open")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{s("title")}</DialogTitle>
          <DialogDescription>{s("what")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <CrimeDisclaimer />
          <p>{s("measure")}</p>
          <p>
            {s("ranking", {
              weight: formatCount(engineConfig.safetyWeight),
              full: SAFETY.fullScoreAt,
              zero: SAFETY.zeroScoreAt,
            })}
          </p>
          <p>{s("mustHave")}</p>
          <p>{s("never")}</p>
          <h3 className="font-semibold">{s("caveatsTitle")}</h3>
          <ul className="flex flex-col gap-2">
            {caveats.map((caveat) => (
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
