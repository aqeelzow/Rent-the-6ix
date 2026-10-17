"use client";

import { Share2 } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/lib/format/messages";
import { sharedSearchPath } from "@/lib/store/share";
import { useAppStore } from "@/lib/store/store";

type ShareState = { kind: "idle" } | { kind: "copied" } | { kind: "manual"; url: string };

/**
 * "Share search": a link that opens this search with its edited filters (SPEC 15). Phones get the
 * system share sheet; elsewhere the link is copied, or shown to copy by hand if that's blocked.
 */
export function ShareSearch() {
  const intent = useAppStore((s) => s.intent);
  const hideUnconfirmed = useAppStore((s) => s.hideUnconfirmed);
  const [state, setState] = useState<ShareState>({ kind: "idle" });
  const inputId = useId();
  if (!intent) return null;

  const share = async () => {
    const url = new URL(sharedSearchPath({ intent, hideUnconfirmed }), window.location.origin).href;
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: "copied" });
    } catch {
      setState({ kind: "manual", url });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        className="text-primary focus-visible:ring-ring/50 flex items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3"
      >
        <Share2 aria-hidden className="size-3.5" />
        {t("search.share.button")}
      </button>
      <div role="status" className="basis-full text-sm empty:hidden">
        {state.kind === "copied" && (
          <p className="text-muted-foreground">{t("search.share.copied")}</p>
        )}
        {state.kind === "manual" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-muted-foreground">
              {t("search.share.manual")}
            </label>
            <input
              id={inputId}
              readOnly
              value={state.url}
              onFocus={(event) => event.currentTarget.select()}
              className="bg-background figures w-full rounded-md border px-2 py-1 text-xs"
            />
          </div>
        )}
      </div>
    </>
  );
}
