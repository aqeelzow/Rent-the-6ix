"use client";

import { Bookmark, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { PriceBadge } from "@/components/results/price-badge";
import { ScoreBar } from "@/components/results/score-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { clientErrorCodes, importPastedListing } from "@/lib/store/actions";
import { selectIsShortlisted } from "@/lib/store/searchSlice";
import { useAppStore } from "@/lib/store/store";
import type { ApiError, SearchResultItem } from "@/lib/store/types";
import { useLastSearch } from "@/lib/store/use-last-search";
import { MAX_TEXT, isHttpLink } from "./paste-input";

const p = (key: string, params?: Record<string, string | number>) =>
  t(`paste.${key}` as MessageKey, params);

type Outcome =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "error"; error: ApiError }
  | { kind: "result"; result: SearchResultItem };

const knownErrors = new Set(["rate_limited", "service_unavailable", "network_error"]);

function PastedResult({ result }: { result: SearchResultItem }) {
  const { listing, valuation, matchScore } = result;
  const saved = useAppStore(selectIsShortlisted(listing.id));
  const save = useAppStore((s) => s.addPastedListing);
  return (
    <article className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <p className="figures text-lg leading-tight font-semibold">
          {formatCad(listing.monthlyRentCad)}
          <span className="text-muted-foreground text-sm font-normal">
            {listing.rentIsPerRoom ? t("results.perRoom") : t("results.perMonth")}
          </span>
        </p>
        <h2 className="text-sm font-medium">{listing.title}</h2>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PriceBadge valuation={valuation} />
        <ScoreBar matchScore={matchScore} className="w-36 pt-0.5" />
      </div>
      <Button
        variant={saved ? "secondary" : "default"}
        disabled={saved}
        onClick={() => save(listing)}
        className="self-start"
      >
        <Bookmark aria-hidden className={saved ? "fill-current" : undefined} />
        {saved ? p("saved") : p("save")}
      </Button>
    </article>
  );
}

/**
 * `/paste` (SPEC 10.3): listing text or a public link → B's import route, which extracts, geocodes
 * and scores it against the renter's search. Until that route exists, the page says so plainly.
 * Nothing pasted is stored on the server; a saved one lives in this browser's shortlist.
 */
export function PasteView() {
  const intent = useAppStore((s) => s.intent);
  const last = useLastSearch();
  const search = intent?.rawPrompt ? intent : (last?.intent ?? null);
  const [mode, setMode] = useState<"text" | "link">("text");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [linkTouched, setLinkTouched] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const textId = useId();
  const linkId = useId();
  const linkHelpId = useId();

  const linkValid = isHttpLink(link);
  const ready = mode === "text" ? text.trim().length > 0 : linkValid;
  const checking = outcome.kind === "checking";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || checking) return;
    setOutcome({ kind: "checking" });
    const reply = await importPastedListing(
      mode === "text" ? { text: text.trim() } : { url: link.trim() },
      search,
    );
    if (reply.ok) setOutcome({ kind: "result", result: reply.result });
    else if (reply.error.code === clientErrorCodes.notAvailable)
      setOutcome({ kind: "unavailable" });
    else setOutcome({ kind: "error", error: reply.error });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("layout.nav.paste")}</h1>
        <p className="text-muted-foreground max-w-prose">{p("intro")}</p>
      </div>

      <form
        onSubmit={(event) => void submit(event)}
        className="bg-card flex flex-col gap-4 rounded-xl border p-4"
      >
        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value as "text" | "link");
            if (!checking) setOutcome({ kind: "idle" });
          }}
        >
          <TabsList>
            <TabsTrigger value="text">{p("tabText")}</TabsTrigger>
            <TabsTrigger value="link">{p("tabLink")}</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="flex flex-col gap-2 pt-2">
            <Label htmlFor={textId}>{p("textLabel")}</Label>
            <Textarea
              id={textId}
              value={text}
              maxLength={MAX_TEXT}
              rows={8}
              placeholder={p("textPlaceholder")}
              onChange={(event) => {
                setText(event.target.value);
                if (!checking) setOutcome({ kind: "idle" });
              }}
            />
            <p className="text-muted-foreground figures text-xs">
              {p("textCount", { n: formatCount(text.length), max: formatCount(MAX_TEXT) })}
            </p>
          </TabsContent>
          <TabsContent value="link" className="flex flex-col gap-2 pt-2">
            <Label htmlFor={linkId}>{p("linkLabel")}</Label>
            <Input
              id={linkId}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              placeholder="https://"
              aria-describedby={linkHelpId}
              aria-invalid={linkTouched && link !== "" && !linkValid}
              onChange={(event) => {
                setLink(event.target.value);
                if (!checking) setOutcome({ kind: "idle" });
              }}
              onBlur={() => setLinkTouched(true)}
            />
            <p id={linkHelpId} className="text-muted-foreground text-xs">
              {linkTouched && link !== "" && !linkValid ? (
                <span className="text-destructive">{p("linkInvalid")}</span>
              ) : (
                p("linkHelp")
              )}
            </p>
          </TabsContent>
        </Tabs>

        <p className="text-muted-foreground text-sm">
          {search ? p("againstSearch", { prompt: search.rawPrompt }) : p("noSearch")}
        </p>
        <Button type="submit" disabled={!ready || checking} className="self-start">
          {checking && <LoaderCircle aria-hidden className="animate-spin" />}
          {checking ? p("checking") : p("submit")}
        </Button>
        <p className="text-muted-foreground text-xs">{p("privacy")}</p>
      </form>

      <div aria-live="polite">
        {outcome.kind === "unavailable" && (
          <div className="bg-card flex flex-col gap-1 rounded-xl border p-4">
            <h2 className="font-semibold">{p("unavailableTitle")}</h2>
            <p className="text-muted-foreground text-sm">{p("unavailable")}</p>
          </div>
        )}
        {outcome.kind === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {p(`errors.${knownErrors.has(outcome.error.code) ? outcome.error.code : "default"}`, {
              seconds: outcome.error.retryAfterSeconds ?? 30,
            })}
          </p>
        )}
        {outcome.kind === "result" && <PastedResult result={outcome.result} />}
      </div>
    </div>
  );
}
