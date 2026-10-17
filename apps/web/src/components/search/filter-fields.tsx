"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/format/messages";

// Small form pieces for the filters panel. Labels are always visible (SPEC 18 accessibility).

export function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b py-5 first:pt-0 last:border-b-0">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** One criterion: its label, its control and, once it's set, the must-have switch. */
export function CriterionField({
  label,
  help,
  hard,
  onHardChange,
  children,
}: {
  label: string;
  help?: string;
  /** null when the criterion isn't set (the switch is hidden). */
  hard: boolean | null;
  onHardChange: (hard: boolean) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        {hard !== null && (
          <span className="flex items-center gap-2">
            <Label htmlFor={`${id}-hard`} className="text-muted-foreground text-xs font-normal">
              {t("filters.mustHave")}
            </Label>
            <Switch id={`${id}-hard`} size="sm" checked={hard} onCheckedChange={onHardChange} />
          </span>
        )}
      </div>
      {children}
      {help && <p className="text-muted-foreground text-xs">{help}</p>}
    </div>
  );
}

/** Two number inputs for a { min, max } range; empty means no bound. */
export function RangeInputs({
  field,
  min,
  max,
  step = 1,
  onChange,
}: {
  field: string;
  min: number | undefined;
  max: number | undefined;
  step?: number;
  onChange: (min: string, max: string) => void;
}) {
  const minText = min === undefined ? "" : String(min);
  const maxText = max === undefined ? "" : String(max);
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        placeholder={t("filters.panel.min")}
        aria-label={t("filters.panel.minOf", { field })}
        value={minText}
        onChange={(event) => onChange(event.target.value, maxText)}
        className="figures"
      />
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        placeholder={t("filters.panel.max")}
        aria-label={t("filters.panel.maxOf", { field })}
        value={maxText}
        onChange={(event) => onChange(minText, event.target.value)}
        className="figures"
      />
    </div>
  );
}

/** Checkboxes for a set of allowed values; an empty set clears the criterion. */
export function CheckboxGroup<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: readonly V[] | undefined;
  onChange: (next: V[]) => void;
}) {
  const id = useId();
  const selected = new Set(value ?? []);
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <div key={option.value} className="flex items-center gap-2">
          <Checkbox
            id={`${id}-${option.value}`}
            checked={selected.has(option.value)}
            onCheckedChange={(checked) => {
              const next = new Set(selected);
              if (checked === true) next.add(option.value);
              else next.delete(option.value);
              onChange(options.map((o) => o.value).filter((v) => next.has(v)));
            }}
          />
          <Label htmlFor={`${id}-${option.value}`} className="font-normal">
            {option.label}
          </Label>
        </div>
      ))}
    </div>
  );
}

/** A native select: easy to use on phones and with screen readers. */
export function SelectInput<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V | "";
  onChange: (next: V | "") => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as V | "")}
      className="border-input bg-card focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
    >
      <option value="">{t("filters.panel.any")}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
