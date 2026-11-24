"use client";

import { useEffect, useRef, useState } from "react";
import { displayName, formatDistance, orderedCategories } from "@/components/listing/nearby-data";
import { t, type MessageKey } from "@/lib/format/messages";
import { fetchNearby } from "@/lib/store/actions";
import type { NearbyResponse } from "@/lib/store/types";

// What's around the selected listing, over the results map: a rail of categories (groceries,
// parks, schools…) on the left, the active one large with its count, and that category's nearest
// places as cards along the bottom. Scrolling over the rail (or the arrow keys) steps through
// categories; picking a card shows that place on the map with the walk to it. The map draws the
// pins and the route from `onShow`.

type Group = NearbyResponse["categories"][number];

export interface NearbyFocus {
  places: { name: string; location: { lng: number; lat: number } }[];
  active: number;
}

/** Wheel steps closer together than this count as one, so a flick doesn't skip categories. */
const WHEEL_GAP_MS = 350;

export function NearbyPanel({
  listingId,
  onShow,
}: {
  listingId: string;
  onShow: (focus: NearbyFocus | null) => void;
}) {
  const [state, setState] = useState<{ id: string; groups: Group[] | null } | null>(null);
  const [view, setView] = useState({ id: listingId, category: 0, place: 0 });
  const lastWheel = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchNearby(listingId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setState({ id: listingId, groups: result.ok ? orderedCategories(result.nearby) : null });
    });
    return () => controller.abort();
  }, [listingId]);

  const groups = state?.id === listingId ? state.groups : undefined;
  // A different listing starts at its first category.
  const { category, place } = view.id === listingId ? view : { category: 0, place: 0 };
  const group = groups?.[category];

  useEffect(() => {
    if (!group) {
      onShow(null);
      return;
    }
    onShow({
      places: group.places.map((p) => ({ name: displayName(p.name), location: p.location })),
      active: place,
    });
  }, [group, place, onShow]);
  useEffect(() => () => onShow(null), [onShow]);

  if (groups === undefined) return null;
  if (!groups?.length) return null;

  const step = (by: number) =>
    setView({
      id: listingId,
      category: Math.min(groups.length - 1, Math.max(0, category + by)),
      place: 0,
    });

  return (
    <>
      <nav
        aria-label={t("results.map.nearby.label")}
        className="nearby-rail"
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
        <p className="nearby-rail-title">{t("results.map.nearby.title")}</p>
        <ol>
          {groups.map((g, i) => {
            const active = i === category;
            return (
              <li key={g.category}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setView({ id: listingId, category: i, place: 0 })}
                  className={active ? "is-active" : undefined}
                >
                  {t(`listing.nearby.categories.${g.category}` as MessageKey)}
                  {active && <sup>({g.places.length})</sup>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {group && (
        <div className="nearby-strip" aria-label={t("results.map.nearby.places")}>
          <p className="nearby-strip-count">
            {t("results.map.nearby.count", { n: place + 1, total: group.places.length })}
          </p>
          <ol>
            {group.places.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={i === place ? "true" : undefined}
                  onClick={() => setView({ id: listingId, category, place: i })}
                  className={i === place ? "is-active" : undefined}
                >
                  <span className="nearby-badge">{String(i + 1).padStart(2, "0")}</span>
                  <span className="nearby-card-text">
                    <span className="nearby-card-name">{displayName(p.name)}</span>
                    <span className="nearby-card-distance">{formatDistance(p.distanceM)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
