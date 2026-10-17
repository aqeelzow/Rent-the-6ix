"use client";

import { Bike, Car, Footprints, TramFront, Trash2, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t, type MessageKey } from "@/lib/format/messages";
import { runSearch } from "@/lib/store/actions";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent } from "@/lib/store/types";
import {
  MODES,
  buildChips,
  removeChip,
  setChipHard,
  setTargetMinutes,
  setTargetModes,
  type Chip,
  type Mode,
} from "./chips";

const modeIcons: Record<Mode, LucideIcon> = {
  transit: TramFront,
  drive: Car,
  walk: Footprints,
  bike: Bike,
};

/** Must-have solid, preference outlined, default dashed (SPEC 6 step 2). */
function chipStyle(chip: Chip): string {
  if (chip.source === "default")
    return "border-dashed border-input text-muted-foreground bg-transparent";
  if (chip.hard === true || chip.kind === "area")
    return "border-primary bg-primary text-primary-foreground";
  if (chip.hard === false) return "border-primary bg-card text-primary";
  return "border-border bg-secondary text-secondary-foreground";
}

/** Editable chips for the current search. Every edit re-runs search without calling the parser. */
export function FilterChips({ intent }: { intent: SearchIntent }) {
  const updateIntent = useAppStore((s) => s.updateIntent);
  const chips = buildChips(intent);
  if (!chips.length) return null;

  const edit = (update: (current: SearchIntent) => SearchIntent) => {
    updateIntent(update);
    void runSearch();
  };

  return (
    <section aria-labelledby="filters-label" className="flex flex-col gap-2">
      <h2 id="filters-label" className="sr-only">
        {t("filters.label")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key} className="max-w-full">
            <ChipButton chip={chip} intent={intent} onEdit={edit} />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">{t("filters.legend")}</p>
    </section>
  );
}

function ChipButton({
  chip,
  intent,
  onEdit,
}: {
  chip: Chip;
  intent: SearchIntent;
  onEdit: (update: (current: SearchIntent) => SearchIntent) => void;
}) {
  const kind = chip.hard === null ? null : t(chip.hard ? "filters.mustHave" : "filters.preference");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={kind ? t("filters.chipAria", { label: chip.label, kind }) : chip.label}
          className={`focus-visible:ring-ring/50 inline-flex h-8 max-w-full items-center rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-3 ${chipStyle(chip)}`}
        >
          <span className="truncate">{chip.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{chip.label}</p>
          <SourceLine chip={chip} />
        </div>

        {chip.hard !== null && (
          <HardSwitch chip={chip} onChange={(hard) => onEdit((i) => setChipHard(i, chip, hard))} />
        )}

        {chip.kind === "travel" && chip.targetId && (
          <TravelEditor
            target={intent.travelTargets.find((target) => target.id === chip.targetId)}
            onModes={(modes) => onEdit((i) => setTargetModes(i, chip.targetId!, modes))}
            onMinutes={(minutes) => onEdit((i) => setTargetMinutes(i, chip.targetId!, minutes))}
          />
        )}

        <Button
          variant="destructive"
          size="sm"
          className="self-start"
          onClick={() => onEdit((i) => removeChip(i, chip))}
        >
          <Trash2 aria-hidden data-icon="inline-start" />
          {t("filters.remove")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SourceLine({ chip }: { chip: Chip }) {
  const lines: string[] = [];
  if (chip.phrase) lines.push(t("filters.fromPrompt", { phrase: chip.phrase }));
  if (chip.source === "user") lines.push(t(chip.phrase ? "filters.edited" : "filters.fromUser"));
  if (chip.source === "default") lines.push(t("filters.fromDefault"));
  if (!lines.length) return null;
  return <p className="text-muted-foreground text-sm">{lines.join(" · ")}</p>;
}

function HardSwitch({ chip, onChange }: { chip: Chip; onChange: (hard: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{t("filters.mustHave")}</Label>
        <Switch id={id} checked={chip.hard === true} onCheckedChange={onChange} />
      </div>
      <p className="text-muted-foreground text-xs">{t("filters.mustHaveHelp")}</p>
    </div>
  );
}

export function TravelEditor({
  target,
  onModes,
  onMinutes,
}: {
  target: SearchIntent["travelTargets"][number] | undefined;
  onModes: (modes: Mode[]) => void;
  onMinutes: (minutes: number | null) => void;
}) {
  const id = useId();
  const [minutes, setMinutes] = useState(target?.maxMinutes ? String(target.maxMinutes) : "");
  if (!target) return null;
  const modes = [target.mode, ...(target.alternativeModes ?? [])];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id={`${id}-modes`}>
          {t("filters.travelModes")}
        </p>
        <ToggleGroup
          type="multiple"
          variant="outline"
          aria-labelledby={`${id}-modes`}
          value={modes}
          onValueChange={(value) => onModes(value as Mode[])}
          className="flex-wrap"
        >
          {MODES.map((mode) => {
            const Icon = modeIcons[mode];
            return (
              <ToggleGroupItem key={mode} value={mode} className="px-2.5">
                <Icon aria-hidden />
                {t(`filters.modes.${mode}` as MessageKey)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(minutes);
          onMinutes(minutes.trim() && Number.isFinite(value) && value > 0 ? value : null);
        }}
      >
        <Label htmlFor={`${id}-minutes`}>{t("filters.minutes")}</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-minutes`}
            type="number"
            inputMode="numeric"
            min={1}
            max={180}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className="figures w-24"
          />
          <Button type="submit" variant="outline">
            {t("filters.apply")}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t("filters.minutesHelp")}</p>
      </form>
    </div>
  );
}
