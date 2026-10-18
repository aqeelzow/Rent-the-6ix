"use client";

import { t } from "@/lib/format/messages";
import { runSearch } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import { ChoiceList } from "./filters-panel";
import { chooseDestination } from "./filters";

export function DestinationChoices() {
  const intent = useAppStore((s) => s.intent);
  const destinations = useAppStore((s) => s.destinations);
  const status = useAppStore((s) => s.status);
  if (!intent || status !== "choosing") return null;

  return (
    <section aria-label={t("search.chooseLocation")} className="bg-card flex flex-col gap-4 rounded-xl border p-4">
      <p role="status" className="text-sm">{t("search.chooseLocation")}</p>
      {destinations.map(({ targetId, resolution }) => {
        const target = intent.travelTargets.find((target) => target.id === targetId && !target.resolved);
        if (!target || resolution.status !== "ambiguous") return null;
        return (
          <ChoiceList
            key={targetId}
            title={t("filters.panel.whichOne")}
            context={target.label}
            choices={resolution.choices}
            onChoose={(choice) => {
              appStore.getState().updateIntent((current) => chooseDestination(current, targetId, choice));
              void runSearch();
            }}
          />
        );
      })}
    </section>
  );
}
