"use client";

import { MapPin, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SAFETY } from "@rentthe6ix/shared/engine/config";
import { SafetyInfoButton } from "@/components/safety/safety-info";
import { SafetyLimit } from "@/components/safety/safety-limit";
import { Switch } from "@/components/ui/switch";
import { t, type MessageKey } from "@/lib/format/messages";
import { resolveDestination, runSearch } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import type { DestinationResolution, SearchIntent } from "@/lib/store/types";
import {
  buildChips,
  removeChip,
  setChipHard,
  setTargetMinutes,
  setTargetModes,
  travelLabel,
  type Chip,
} from "./chips";
import {
  CheckboxGroup,
  CriterionField,
  PanelSection,
  RangeInputs,
  SelectInput,
} from "./filter-fields";
import { TravelEditor } from "./filter-chips";
import {
  AMENITY_CATEGORIES,
  activeFilterCount,
  addAmenityTarget,
  addPlaceTarget,
  chooseDestination,
  isValidIntent,
  parseNumber,
  range,
  setCriterion,
  setCriterionHard,
  setSafety,
  type AmenityCategory,
  type CriterionField as Field,
  type ResolvedPlace,
} from "./filters";

type Edit = (update: (draft: SearchIntent) => SearchIntent) => void;
type Target = SearchIntent["travelTargets"][number];

const p = (key: string, params?: Record<string, string | number>) =>
  t(`filters.panel.${key}` as MessageKey, params);
const chipText = (key: string) => t(`filters.chips.${key}` as MessageKey);

const travelChip = (target: Target): Chip => ({
  key: `travelTargets.${target.id}`,
  kind: "travel",
  targetId: target.id,
  label: target.label,
  hard: target.hard,
  source: null,
  phrase: null,
});

/**
 * The Filters button and panel (SPEC 11.2): every criterion with a must-have switch. Edits go to a
 * draft; "Show results" applies it and re-runs search without calling the parser.
 */
export function FiltersPanel() {
  const intent = useAppStore((s) => s.intent);
  const hideUnconfirmed = useAppStore((s) => s.hideUnconfirmed);
  const destinations = useAppStore((s) => s.destinations);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SearchIntent | null>(null);
  const [draftHide, setDraftHide] = useState(false);
  if (!intent) return null;

  const count = activeFilterCount(intent);
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(intent);
      setDraftHide(hideUnconfirmed);
    }
    setOpen(next);
  };
  const edit: Edit = (update) => setDraft((current) => (current ? update(current) : current));
  const valid = draft ? isValidIntent(draft) : true;
  const apply = () => {
    if (!draft || !valid) return;
    const store = appStore.getState();
    store.setIntent(draft);
    store.setHideUnconfirmed(draftHide);
    setOpen(false);
    void runSearch();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" className="rounded-full">
          <SlidersHorizontal aria-hidden data-icon="inline-start" />
          {count ? p("openWithCount", { count }) : p("open")}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg font-semibold">{p("title")}</SheetTitle>
          <SheetDescription>{p("description")}</SheetDescription>
        </SheetHeader>

        {draft && (
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <HideUnconfirmed checked={draftHide} onChange={setDraftHide} />
            <PriceSection draft={draft} edit={edit} />
            <HomeSection draft={draft} edit={edit} />
            <TravelSection draft={draft} edit={edit} destinations={destinations} />
            <SafetySection draft={draft} edit={edit} />
            <AreaSection draft={draft} edit={edit} />
          </div>
        )}

        <SheetFooter className="bg-popover border-t">
          {!valid && (
            <p role="alert" className="text-destructive text-sm">
              {p("invalid")}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              {p("cancel")}
            </Button>
            <Button className="flex-1" onClick={apply} disabled={!valid}>
              {p("apply")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function HideUnconfirmed({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="mb-5 flex flex-col gap-1 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{p("hideUnconfirmed")}</Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-muted-foreground text-xs">{p("hideUnconfirmedHelp")}</p>
    </div>
  );
}

/** Props shared by the sections: the draft and a way to edit it. */
type SectionProps = { draft: SearchIntent; edit: Edit };

function hardOf(draft: SearchIntent, field: Field): boolean | null {
  return draft.criteria[field]?.hard ?? null;
}

function PriceSection({ draft, edit }: SectionProps) {
  const { rent, priceFairness } = draft.criteria;
  return (
    <PanelSection title={p("sections.price")}>
      <CriterionField
        label={p("rent")}
        hard={hardOf(draft, "rent")}
        onHardChange={(hard) => edit((d) => setCriterionHard(d, "rent", hard))}
      >
        <RangeInputs
          field={p("rent")}
          min={rent?.value.min}
          max={rent?.value.max}
          step={50}
          onChange={(min, max) =>
            edit((d) => setCriterion(d, "rent", range(parseNumber(min), parseNumber(max))))
          }
        />
      </CriterionField>
      <CriterionField
        label={p("priceFairness")}
        help={p("priceFairnessHelp")}
        hard={hardOf(draft, "priceFairness")}
        onHardChange={(hard) => edit((d) => setCriterionHard(d, "priceFairness", hard))}
      >
        <CheckboxGroup
          options={(["underpriced", "reasonable", "overpriced"] as const).map((value) => ({
            value,
            label: chipText(`fairness.${value}`),
          }))}
          value={priceFairness?.value}
          onChange={(next) =>
            edit((d) => setCriterion(d, "priceFairness", next.length ? next : undefined))
          }
        />
      </CriterionField>
    </PanelSection>
  );
}

const BOOLEAN_FIELDS = [
  ["furnished", "furnished"],
  ["parking", "parking"],
  ["laundryInSuite", "laundry"],
  ["utilitiesIncluded", "utilities"],
] as const;

function HomeSection({ draft, edit }: SectionProps) {
  const c = draft.criteria;
  const field = (key: Field, label: string, control: React.ReactNode, help?: string) => (
    <CriterionField
      key={key}
      label={label}
      help={help}
      hard={hardOf(draft, key)}
      onHardChange={(hard) => edit((d) => setCriterionHard(d, key, hard))}
    >
      {control}
    </CriterionField>
  );

  return (
    <PanelSection title={p("sections.home")}>
      {field(
        "bedrooms",
        p("bedrooms"),
        <RangeInputs
          field={p("bedrooms")}
          min={c.bedrooms?.value.min}
          max={c.bedrooms?.value.max}
          onChange={(min, max) => {
            const lo = parseNumber(min),
              hi = parseNumber(max);
            edit((d) =>
              setCriterion(d, "bedrooms", range(lo && Math.round(lo), hi && Math.round(hi))),
            );
          }}
        />,
        p("bedroomsHelp"),
      )}
      {field(
        "bathrooms",
        p("bathrooms"),
        <RangeInputs
          field={p("bathrooms")}
          min={c.bathrooms?.value.min}
          max={c.bathrooms?.value.max}
          step={0.5}
          onChange={(min, max) =>
            edit((d) => setCriterion(d, "bathrooms", range(parseNumber(min), parseNumber(max))))
          }
        />,
      )}
      {field(
        "sizeSqft",
        p("size"),
        <RangeInputs
          field={p("size")}
          min={c.sizeSqft?.value.min}
          max={c.sizeSqft?.value.max}
          step={50}
          onChange={(min, max) =>
            edit((d) => setCriterion(d, "sizeSqft", range(parseNumber(min), parseNumber(max))))
          }
        />,
      )}
      {field(
        "unitTypes",
        p("unitTypes"),
        <CheckboxGroup
          options={(
            ["apartment", "condo", "basement", "house", "townhouse", "room", "studio"] as const
          ).map((value) => ({ value, label: chipText(`unitTypes.${value}`) }))}
          value={c.unitTypes?.value}
          onChange={(next) =>
            edit((d) => setCriterion(d, "unitTypes", next.length ? next : undefined))
          }
        />,
      )}
      {field(
        "buildingAge",
        p("buildingAge"),
        <YearRange
          after={c.buildingAge?.value.builtAfter}
          before={c.buildingAge?.value.builtBefore}
          onChange={(after, before) =>
            edit((d) =>
              setCriterion(
                d,
                "buildingAge",
                after === undefined && before === undefined
                  ? undefined
                  : {
                      ...(after !== undefined ? { builtAfter: after } : {}),
                      ...(before !== undefined ? { builtBefore: before } : {}),
                    },
              ),
            )
          }
        />,
      )}
      {field(
        "airConditioning",
        p("airConditioning"),
        <SelectInput
          label={p("airConditioning")}
          options={[
            { value: "any", label: p("acAny") },
            { value: "central", label: p("acCentral") },
          ]}
          value={c.airConditioning?.value ?? ""}
          onChange={(v) => edit((d) => setCriterion(d, "airConditioning", v || undefined))}
        />,
      )}
      {field(
        "petsAllowed",
        p("pets"),
        <SelectInput
          label={p("pets")}
          options={[
            { value: "cats", label: p("petsCats") },
            { value: "dogs", label: p("petsDogs") },
            { value: "any", label: p("petsAny") },
          ]}
          value={c.petsAllowed?.value ?? ""}
          onChange={(v) => edit((d) => setCriterion(d, "petsAllowed", v || undefined))}
        />,
      )}
      {BOOLEAN_FIELDS.map(([key, label]) =>
        field(
          key,
          p(label),
          <SelectInput
            label={p(label)}
            options={[
              { value: "yes", label: p("yes") },
              { value: "no", label: p("no") },
            ]}
            value={c[key] === undefined ? "" : c[key].value ? "yes" : "no"}
            onChange={(v) => edit((d) => setCriterion(d, key, v === "" ? undefined : v === "yes"))}
          />,
        ),
      )}
      {field(
        "availableBy",
        p("availableBy"),
        <Input
          type="date"
          aria-label={p("availableBy")}
          value={c.availableBy?.value ?? ""}
          onChange={(event) =>
            edit((d) => setCriterion(d, "availableBy", event.target.value || undefined))
          }
        />,
      )}
      {field(
        "leaseTerm",
        p("leaseTerm"),
        <SelectInput
          label={p("leaseTerm")}
          options={[
            { value: "12_months", label: p("lease12") },
            { value: "short_term", label: p("leaseShort") },
          ]}
          value={c.leaseTerm?.value ?? ""}
          onChange={(v) => edit((d) => setCriterion(d, "leaseTerm", v || undefined))}
        />,
      )}
    </PanelSection>
  );
}

function YearRange({
  after,
  before,
  onChange,
}: {
  after: number | undefined;
  before: number | undefined;
  onChange: (after: number | undefined, before: number | undefined) => void;
}) {
  const year = (text: string) => {
    const value = parseNumber(text);
    return value !== undefined && value >= 1800 && value <= 2100 ? Math.round(value) : undefined;
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        placeholder={p("builtAfter")}
        aria-label={`${p("buildingAge")}: ${p("builtAfter")}`}
        value={after ?? ""}
        onChange={(event) => onChange(year(event.target.value), before)}
        className="figures"
      />
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
      <Input
        type="number"
        inputMode="numeric"
        placeholder={p("builtBefore")}
        aria-label={`${p("buildingAge")}: ${p("builtBefore")}`}
        value={before ?? ""}
        onChange={(event) => onChange(after, year(event.target.value))}
        className="figures"
      />
    </div>
  );
}

function TravelSection({
  draft,
  edit,
  destinations,
}: SectionProps & { destinations: { targetId: string; resolution: DestinationResolution }[] }) {
  return (
    <PanelSection title={p("sections.travel")}>
      <p className="text-muted-foreground text-xs">{p("travelHelp")}</p>
      {draft.travelTargets.length === 0 && (
        <p className="text-muted-foreground text-sm">{p("noTargets")}</p>
      )}
      <ul className="flex flex-col gap-3">
        {draft.travelTargets.map((target) => (
          <li key={target.id} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{travelLabel(target)}</p>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={p("removeTarget", { label: target.label })}
                onClick={() => edit((d) => removeChip(d, travelChip(target)))}
              >
                <X aria-hidden />
              </Button>
            </div>
            {target.kind === "place" && !target.resolved && (
              <DestinationChoice
                target={target}
                resolution={destinations.find((d) => d.targetId === target.id)?.resolution}
                onChoose={(choice) => edit((d) => chooseDestination(d, target.id, choice))}
              />
            )}
            <TargetHard target={target} edit={edit} />
            <TravelEditor
              key={`${target.id}-${target.maxMinutes ?? ""}`}
              target={target}
              onModes={(modes) => edit((d) => setTargetModes(d, target.id, modes))}
              onMinutes={(minutes) => edit((d) => setTargetMinutes(d, target.id, minutes))}
            />
          </li>
        ))}
      </ul>
      <AddPlace edit={edit} />
      <AddAmenity edit={edit} />
    </PanelSection>
  );
}

function TargetHard({ target, edit }: { target: Target; edit: Edit }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {t("filters.mustHave")}
      </Label>
      <Switch
        id={id}
        size="sm"
        checked={target.hard}
        onCheckedChange={(hard) => edit((d) => setChipHard(d, travelChip(target), hard))}
      />
    </div>
  );
}

/** "Which one do you mean?" for a parsed place the resolver found several matches for. */
function DestinationChoice({
  target,
  resolution,
  onChoose,
}: {
  target: Target;
  resolution: DestinationResolution | undefined;
  onChoose: (choice: { label: string; resolved: ResolvedPlace }) => void;
}) {
  if (resolution?.status !== "ambiguous") {
    return <p className="text-caveat-warning-foreground text-xs">{p("unresolved")}</p>;
  }
  return (
    <ChoiceList
      title={p("whichOne")}
      choices={resolution.choices}
      onChoose={(choice) => onChoose({ label: choice.label, resolved: choice.resolved })}
      context={target.label}
    />
  );
}

export function ChoiceList({
  title,
  choices,
  onChoose,
  context,
}: {
  title: string;
  choices: Extract<DestinationResolution, { status: "ambiguous" }>["choices"];
  onChoose: (
    choice: Extract<DestinationResolution, { status: "ambiguous" }>["choices"][number],
  ) => void;
  context: string;
}) {
  return (
    <div role="group" aria-label={`${title} ${context}`} className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{context}</p>
      <div className="flex flex-col gap-1.5">
        {choices.map((choice) => (
          <Button
            key={choice.id}
            variant="outline"
            size="sm"
            className="h-auto justify-start py-1.5 text-left whitespace-normal"
            onClick={() => onChoose(choice)}
          >
            <MapPin aria-hidden data-icon="inline-start" />
            {choice.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function AddPlace({ edit }: { edit: Edit }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "finding" }
    | { kind: "choices"; resolution: Extract<DestinationResolution, { status: "ambiguous" }> }
    | { kind: "message"; text: string }
  >({ kind: "idle" });

  const add = (label: string, resolved: ResolvedPlace) => {
    edit((d) => addPlaceTarget(d, { query: query.trim(), label, resolved }));
    setQuery("");
    setState({ kind: "idle" });
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const text = query.trim();
        if (!text) return;
        setState({ kind: "finding" });
        const result = await resolveDestination(text);
        if (!result.ok) return setState({ kind: "message", text: p("lookupFailed") });
        const { resolution } = result;
        if (resolution.status === "resolved")
          add(resolution.destination.label, resolution.destination.resolved);
        else if (resolution.status === "ambiguous") setState({ kind: "choices", resolution });
        else setState({ kind: "message", text: p("notFound", { query: text }) });
      }}
    >
      <Label htmlFor={id}>{p("addPlace")}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={query}
          maxLength={500}
          placeholder={p("placePlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={state.kind === "finding" || !query.trim()}
        >
          {state.kind === "finding" ? p("finding") : p("find")}
        </Button>
      </div>
      {state.kind === "choices" && (
        <ChoiceList
          title={p("whichOne")}
          context={state.resolution.query}
          choices={state.resolution.choices}
          onChoose={(choice) => add(choice.label, choice.resolved)}
        />
      )}
      {state.kind === "message" && (
        <p role="status" className="text-muted-foreground text-xs">
          {state.text}
        </p>
      )}
    </form>
  );
}

function AddAmenity({ edit }: { edit: Edit }) {
  const id = useId();
  const [category, setCategory] = useState<AmenityCategory | "">("");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{p("addAmenity")}</Label>
      <div className="flex gap-2">
        <select
          id={id}
          value={category}
          onChange={(event) => setCategory(event.target.value as AmenityCategory | "")}
          className="border-input bg-card focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
        >
          <option value="">{p("amenityLabel")}</option>
          {AMENITY_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {p(`amenities.${value}`)}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={!category}
          onClick={() => {
            if (!category) return;
            edit((d) => addAmenityTarget(d, category, p(`amenities.${category}`)));
            setCategory("");
          }}
        >
          {p("add")}
        </Button>
      </div>
    </div>
  );
}

function SafetySection({ draft, edit }: SectionProps) {
  const id = useId();
  const { enabled, hard } = draft.safety;
  return (
    <PanelSection title={p("sections.safety")}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${id}-on`}>{p("safetyToggle")}</Label>
          <Switch
            id={`${id}-on`}
            checked={enabled}
            onCheckedChange={(on) => edit((d) => setSafety(d, { enabled: on, hard: false }))}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {p("safetyHelp")} <SafetyInfoButton />
        </p>
      </div>
      {enabled && (
        <SafetyLimit
          value={hard ? (draft.safety.maxRelativeRate ?? SAFETY.hardMaxRelativeRate) : null}
          onChange={(limit) =>
            edit((d) =>
              setSafety(d, {
                enabled: true,
                hard: limit !== null,
                maxRelativeRate: limit ?? undefined,
              }),
            )
          }
        />
      )}
    </PanelSection>
  );
}

function AreaSection({ draft, edit }: SectionProps) {
  const areaChips = buildChips(draft).filter((chip) => chip.kind === "area");
  return (
    <PanelSection title={p("sections.area")}>
      {areaChips.length === 0 ? (
        <p className="text-muted-foreground text-sm">{p("noAreas")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {areaChips.map((chip) => (
            <li
              key={chip.key}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <span className="min-w-0 text-sm">{chip.label}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={p("removeArea", { label: chip.label })}
                onClick={() => edit((d) => removeChip(d, chip))}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{p("areaHelp")}</p>
    </PanelSection>
  );
}
