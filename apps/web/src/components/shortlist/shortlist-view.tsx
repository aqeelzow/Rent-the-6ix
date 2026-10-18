"use client";

import { Building2, ClipboardPaste, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { fetchListingDetail } from "@/lib/store/actions";
import { clearMyData } from "@/lib/store/persist";
import type { SavedListing, ShortlistEntry } from "@/lib/store/searchSlice";
import { useAppStore } from "@/lib/store/store";

const s = (key: string, params?: Record<string, string | number>) =>
  t(`shortlist.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

function facts(listing: SavedListing): string[] {
  const parts: string[] = [];
  if (listing.bedrooms !== null) {
    parts.push(
      listing.bedrooms === 0 ? t("results.studio") : t("results.beds", { n: listing.bedrooms }),
    );
  }
  if (listing.bathrooms !== null) {
    parts.push(t("results.baths", { n: decimal.format(listing.bathrooms) }));
  }
  if (listing.sqft !== null) parts.push(t("results.sqft", { n: formatCount(listing.sqft) }));
  return parts;
}

function ShortlistItem({ entry }: { entry: ShortlistEntry }) {
  const remove = useAppStore((state) => state.removeFromShortlist);
  const setSavedImage = useAppStore((state) => state.setSavedImage);
  // Listings saved before the shortlist kept photos: look the photo up once and keep it.
  const missingImage = entry.kind === "listing" && entry.saved.imageUrl === undefined;
  useEffect(() => {
    if (!missingImage) return;
    const controller = new AbortController();
    void fetchListingDetail(entry.id, null, { signal: controller.signal }).then((result) => {
      if (result.ok) setSavedImage(entry.id, result.detail.listing.imageUrl ?? null);
    });
    return () => controller.abort();
  }, [missingImage, entry.id, setSavedImage]);
  const listing = entry.kind === "listing" ? entry.saved : entry.listing;
  const details = facts(listing);

  return (
    <article className="bg-card relative flex gap-3 rounded-xl border p-4">
      <div className="bg-muted text-muted-foreground grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg">
        {listing.imageUrl ? (
          // Hot-linked thumbnail from the source, only when its terms allow (SPEC 8.4).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : entry.kind === "pasted" ? (
          <ClipboardPaste aria-hidden className="size-5" />
        ) : (
          <Building2 aria-hidden className="size-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="figures text-lg leading-tight font-semibold">
          {formatCad(listing.monthlyRentCad)}
          <span className="text-muted-foreground text-sm font-normal">
            {listing.rentIsPerRoom ? t("results.perRoom") : t("results.perMonth")}
          </span>
        </p>
        <h2 className="truncate text-sm font-medium">
          {entry.kind === "listing" ? (
            // Stretched link: the whole card opens the listing's live page.
            <Link
              href={`/listing/${entry.id}`}
              className="after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {listing.title}
            </Link>
          ) : (
            listing.title
          )}
        </h2>
        {details.length > 0 && (
          <p className="text-muted-foreground figures text-sm">{details.join(" · ")}</p>
        )}
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {entry.kind === "pasted" && <Badge variant="secondary">{s("pasted")}</Badge>}
          <span>
            {t(`results.sources.${listing.source}` as MessageKey)} ·{" "}
            {s("savedOn", { date: formatDate(entry.addedAt) })}
          </span>
        </p>
      </div>
      <button
        type="button"
        aria-label={t("results.shortlistRemove", { title: listing.title })}
        onClick={() => remove(entry.id)}
        className="hover:bg-accent focus-visible:ring-ring/50 text-muted-foreground relative z-10 -mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-3"
      >
        <X aria-hidden className="size-5" />
      </button>
    </article>
  );
}

function ClearMyData({ onCleared }: { onCleared: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="self-start">
          <Trash2 aria-hidden />
          {s("clear.button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s("clear.title")}</DialogTitle>
          <DialogDescription>{s("clear.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{s("clear.cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              clearMyData();
              setOpen(false);
              onCleared();
            }}
          >
            {s("clear.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `/shortlist`: saved listings from this browser, newest first, and "Clear my data" (SPEC 15). */
export function ShortlistView() {
  const loaded = useAppStore((state) => state.shortlistLoaded);
  const shortlist = useAppStore((state) => state.shortlist);
  const [cleared, setCleared] = useState(false);
  const newestFirst = shortlist.toReversed();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{s("title")}</h1>
        <p className="text-muted-foreground">{s("intro")}</p>
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : newestFirst.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p>{s("empty")}</p>
          <Button asChild>
            <Link href="/#start">{s("startSearch")}</Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{s("asSaved")}</p>
          <ol className="flex flex-col gap-3">
            {newestFirst.map((entry) => (
              <li key={entry.id}>
                <ShortlistItem entry={entry} />
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="flex flex-col gap-2 border-t pt-6">
        {loaded && <ClearMyData onCleared={() => setCleared(true)} />}
        <p role="status" className="text-muted-foreground text-sm">
          {cleared && newestFirst.length === 0 ? s("clear.done") : null}
        </p>
      </div>
    </div>
  );
}
