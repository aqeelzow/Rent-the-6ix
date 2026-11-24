"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format/date";
import { formatCount } from "@/lib/format/number";
import { PoliceActivitySchema, policeMapUrl } from "@/lib/police-activity";
import { DetailSection } from "./detail-sections";

export function PoliceActivity({ lat, lng }: { lat: number; lng: number }) {
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [data, setData] = useState<ReturnType<typeof PoliceActivitySchema.parse> | null>(null);

  async function load() {
    setState("loading");
    try {
      const params = new URLSearchParams({ lat: lat.toFixed(3), lng: lng.toFixed(3) });
      const response = await fetch(`/api/police-activity?${params}`);
      if (!response.ok) throw new Error("Police activity unavailable");
      setData(PoliceActivitySchema.parse(await response.json()));
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <DetailSection id="police-activity" title="Police activity nearby">
      <p className="text-muted-foreground text-sm">
        Waterloo Regional Police calls for service in an approximately 1 km square around this
        listing. Calls include non-criminal activity. Locations are approximate and classifications
        may change.
      </p>
      {!data && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state === "loading"}
            onClick={load}
          >
            {state === "loading" ? "Loading police activity…" : "Load police activity"}
          </Button>
        </div>
      )}
      <div aria-live="polite">
        {state === "failed" && (
          <p className="text-sm">Police activity is temporarily unavailable.</p>
        )}
        {data && (
          <>
            <p className="text-sm font-medium">
              {formatCount(data.total)} calls · {formatDate(data.start)} – {formatDate(data.end)}
            </p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {data.categories.map(({ category, count }) => (
                <div key={category} className="contents">
                  <dt className="lowercase first-letter:uppercase">{category}</dt>
                  <dd className="text-right tabular-nums">{formatCount(count)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
      <a href={policeMapUrl} className="text-sm underline underline-offset-2">
        Open the WRPS Crime Map
      </a>
    </DetailSection>
  );
}
