"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { displayName, formatDistance, orderedCategories } from "@/components/listing/nearby-data";
import { t, type MessageKey } from "@/lib/format/messages";
import type { FoundPlace } from "@/lib/geo/place-search";
import { fetchNearby } from "@/lib/store/actions";
import type { NearbyResponse } from "@/lib/store/types";

// What's around the selected listing, over the results map: a rail of categories (groceries,
// parks, schools…) on the left, the active one large with its count, and that category's nearest
// places as cards along the bottom. Scrolling over the rail (or the arrow keys) steps through
// categories; picking a card, or its numbered pin on the map, shows the walk there. The search
// button at the end of the cards finds a specific place instead ("Walmart"), nearest first.
// The map draws the pins and the route from `onShow`.

type Group = NearbyResponse["categories"][number];

export interface NearbyFocus {
  places: { name: string; location: { lng: number; lat: number } }[];
  active: number;
  /** Pick place `index` of this list, as clicking its card does (the map's numbered pins). */
  pick: (index: number) => void;
}

/** A card in the strip: a nearby place of the category, or a search result. */
type Card = { key: string; name: string; distanceM: number; address: string | null };

type SearchState =
  | { status: "closed" }
  | { status: "open" | "loading"; query: string }
  | { status: "done"; query: string; places: FoundPlace[] }
  | { status: "error"; query: string };

/** Wheel steps closer together than this count as one, so a flick doesn't skip categories. */
const WHEEL_GAP_MS = 350;

const n = (key: string, params?: Record<string, string | number>) =>
  t(`results.map.nearby.${key}` as MessageKey, params);

export function NearbyPanel({
  listingId,
  near,
  onShow,
}: {
  listingId: string;
  /** The listing's point, which a place search is measured from. */
  near: { lng: number; lat: number };
  onShow: (focus: NearbyFocus | null) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null | undefined>(undefined);
  const [category, setCategory] = useState(0);
  const [place, setPlace] = useState(0);
  const [search, setSearch] = useState<SearchState>({ status: "closed" });
  const lastWheel = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  // The panel is keyed by listing, so this runs once per listing.
  useEffect(() => {
    const controller = new AbortController();
    void fetchNearby(listingId, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted)
        setGroups(result.ok ? orderedCategories(result.nearby) : null);
    });
    return () => controller.abort();
  }, [listingId]);

  // Search results replace the category's places while they're shown.
  const found = search.status === "done" ? search.places : null;
  const group = groups?.[category];
  const cards: Card[] = found
    ? found.map((p, i) => ({
        key: `${p.name}-${i}`,
        name: p.name,
        distanceM: p.distanceM,
        address: p.address,
      }))
    : (group?.places ?? []).map((p) => ({
        key: p.id,
        name: displayName(p.name),
        distanceM: p.distanceM,
        address: null,
      }));
  // `found` and `group` are state (or read from it), so they only change when the list does.
  useEffect(() => {
    const places = found
      ? found.map((p) => ({ name: p.name, location: p.location }))
      : (group?.places ?? []).map((p) => ({ name: displayName(p.name), location: p.location }));
    onShow(places.length ? { places, active: place, pick: setPlace } : null);
  }, [found, group, place, onShow]);
  useEffect(() => () => onShow(null), [onShow]);

  if (groups === undefined) return null;
  if (!groups?.length && search.status === "closed") return null;

  const pickCategory = (index: number) => {
    setCategory(index);
    setPlace(0);
    setSearch({ status: "closed" });
  };
  const step = (by: number) =>
    pickCategory(Math.min((groups?.length ?? 1) - 1, Math.max(0, category + by)));

  const runSearch = async (query: string) => {
    if (query.trim().length < 2) return;
    setSearch({ status: "loading", query });
    const params = new URLSearchParams({ q: query.trim(), near: `${near.lat},${near.lng}` });
    try {
      const response = await fetch(`/api/places/search?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { places: FoundPlace[] };
      setPlace(0);
      setSearch({ status: "done", query, places: body.places });
    } catch {
      setSearch({ status: "error", query });
    }
  };

  const searching = search.status !== "closed";

  return (
    <>
      {!!groups?.length && (
        <nav
          aria-label={n("label")}
          className={found ? "nearby-rail is-dimmed" : "nearby-rail"}
          onWheel={(event) => {
            const now = Date.now();
            if (now - lastWheel.current < WHEEL_GAP_MS || Math.abs(event.deltaY) < 4) return;
            lastWheel.current = now;
            step(event.deltaY > 0 ? 1 : -1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") step(1);
            else if (event.key === "ArrowUp") step(-1);
            else return;
            event.preventDefault();
          }}
        >
          <p className="nearby-rail-title">{n("title")}</p>
          <ol>
            {groups.map((g, i) => {
              const active = i === category && !found;
              return (
                <li key={g.category}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => pickCategory(i)}
                    className={active ? "is-active" : undefined}
                  >
                    {t(`listing.nearby.categories.${g.category}` as MessageKey)}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="nearby-strip" aria-label={n("places")}>
        {cards.length > 0 && (
          <p className="nearby-strip-count">
            {n("count", { n: Math.min(place, cards.length - 1) + 1, total: cards.length })}
          </p>
        )}
        {searching && (
          <form
            className="nearby-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(input.current?.value ?? "");
            }}
          >
            <Search aria-hidden className="size-4 shrink-0 opacity-70" />
            <input
              ref={input}
              type="search"
              defaultValue={search.query}
              placeholder={n("searchPlaceholder")}
              aria-label={n("search")}
              maxLength={80}
              autoFocus
            />
            <button
              type="button"
              aria-label={n("searchClose")}
              onClick={() => {
                setSearch({ status: "closed" });
                setPlace(0);
              }}
            >
              <X aria-hidden className="size-4" />
            </button>
          </form>
        )}
        {search.status === "loading" && <p className="nearby-search-note">{n("searching")}</p>}
        {search.status === "error" && <p className="nearby-search-note">{n("searchError")}</p>}
        {search.status === "done" && !cards.length && (
          <p className="nearby-search-note">{n("searchNone", { q: search.query })}</p>
        )}
        {(search.status === "closed" || found) && cards.length > 0 && (
          <ol>
            {cards.map((card, i) => (
              <li key={card.key}>
                <button
                  type="button"
                  aria-current={i === place ? "true" : undefined}
                  onClick={() => setPlace(i)}
                  className={i === place ? "is-active" : undefined}
                >
                  <span className="nearby-badge">{String(i + 1).padStart(2, "0")}</span>
                  <span className="nearby-card-text">
                    <span className="nearby-card-name">{card.name}</span>
                    <span className="nearby-card-distance">
                      {formatDistance(card.distanceM)}
                      {card.address && <> · {card.address}</>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {!searching && (
          <button
            type="button"
            className="nearby-search-open"
            aria-label={n("search")}
            title={n("search")}
            onClick={() => setSearch({ status: "open", query: "" })}
          >
            <Search aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </>
  );
}
