"use client";

import { t } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import { useAppStore } from "@/lib/store/store";

/** The number of saved listings, beside the Shortlist link. Hidden when nothing is saved. */
export function ShortlistCount() {
  const count = useAppStore((s) => s.shortlist.length);
  if (count === 0) return null;
  return (
    <>
      <span
        aria-hidden
        className="bg-primary text-primary-foreground figures min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold"
      >
        {formatCount(count)}
      </span>
      <span className="sr-only">, {t("shortlist.count", { n: formatCount(count) })}</span>
    </>
  );
}
