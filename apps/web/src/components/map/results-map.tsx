"use client";

import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  Popup,
} from "maplibre-gl";
import { Layers, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/theme";
import type { AreaChoropleth, SearchResultItem } from "@/lib/store/types";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad } from "@/lib/format/number";
import { SafetyInfoButton } from "@/components/safety/safety-info";
import { CrimeDisclaimer } from "@/components/safety/crime-disclaimer";
import { fetchChoropleth } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import {
  BAND_COLORS,
  CRIME_COLORS,
  CRIME_NO_DATA,
  type MapTheme,
  CRIME_STEPS,
  choroplethToGeoJSON,
  MAP_MAX_BOUNDS,
  PLACE_COLOR,
  boundsOf,
  placePins,
  allAtSamePlace,
  listingsAtSamePlace,
  resultsToGeoJSON,
  routesToPlaces,
  type RouteToPlace,
  type ScoreBand,
} from "./map-data";
import { useAmenityPin } from "./amenity-pin";
import { fetchPath, pathFeatures, pathMiddle, ridden, type RoutedPath } from "./route-path";
import { ACTIVE_COLOR, amenityPinElement, greyBasemap, listingCard, pinElement } from "./map-pins";

// Basemap: MapTiler with a key, else OpenFreeMap (no key needed). SPEC 3.
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const STYLE_URLS = MAPTILER_KEY
  ? {
      light: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
      dark: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`,
    }
  : {
      light: "https://tiles.openfreemap.org/styles/positron",
      dark: "https://tiles.openfreemap.org/styles/dark",
    };
/** Uptown Waterloo, between the two universities. */
const WATERLOO: [number, number] = [-80.53, 43.472];

const bandColor: ExpressionSpecification = [
  "match",
  ["get", "band"],
  "high",
  BAND_COLORS.high,
  "mid",
  BAND_COLORS.mid,
  BAND_COLORS.low,
];

/** The crime fill for one theme: the five bands by relative rate, grey where TPS has no rate. */
function crimeColor(theme: MapTheme): ExpressionSpecification {
  const colors = CRIME_COLORS[theme];
  return [
    "case",
    ["==", ["typeof", ["get", "value"]], "number"],
    [
      "step",
      ["get", "value"],
      colors[0],
      CRIME_STEPS[0],
      colors[1],
      CRIME_STEPS[1],
      colors[2],
      CRIME_STEPS[2],
      colors[3],
      CRIME_STEPS[3],
      colors[4],
    ],
    CRIME_NO_DATA[theme],
  ];
}

type CrimeState =
  { status: "idle" | "loading" | "error" } | { status: "ok"; layer: AreaChoropleth };
type CrimeHover = { name: string; value: number | null } | null;

/**
 * Results map (SPEC 12): clustered pins, listing uncertainty circles and
 * place pins. Hover and select are shared with the list through the store.
 * An opt-in "Crime rates" layer shades neighbourhoods by police-reported
 * crime relative to the city, with its caveats beside it (SPEC 7.6).
 */
/** The trip on a route line: an estimate from distance, so it says so, with the distance. */
function routeLabel(route: RouteToPlace): string {
  return t("results.map.routeEstimate", {
    minutes: route.minutes,
    mode: t(`filters.modes.${route.mode}` as MessageKey),
    km: new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(route.distanceM / 1000),
  });
}

/** The routed trip on a line, once OpenTripPlanner has answered (#24): real minutes, no "Est.". */
function routedLabel(route: RouteToPlace, path: RoutedPath): string {
  const routes = ridden(path);
  const params = {
    minutes: path.minutes,
    mode: t(`filters.modes.${route.mode}` as MessageKey),
    km: new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(path.distanceM / 1000),
  };
  return routes.length
    ? t("results.map.routeRoutedVia", { ...params, routes: routes.join(", ") })
    : t("results.map.routeRouted", params);
}

/** How close the map comes in on a place pin that's clicked (a few blocks around it). */
const PLACE_ZOOM = 15;

/** How close the map comes in on a listing hovered in the list (street level). */
const HOVER_ZOOM = 14.5;

export function ResultsMap({
  className = "",
  pinCards = true,
}: {
  className?: string;
  /** Open the selected listing's card on its pin. Off where the page shows its own card. */
  pinCards?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const popups = useRef<Popup[]>([]);
  const routeMarkers = useRef<Marker[]>([]);
  const pins = useRef(new Map<string, Pin>());
  const syncPins = useRef<() => void>(() => {});
  const card = useRef<Popup | null>(null);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const results = useAppStore((s) => s.results);
  const targets = useAppStore((s) => s.intent?.travelTargets);
  const hovered = useAppStore((s) => s.hoveredListingId);
  const selected = useAppStore((s) => s.selectedListingId);
  const amenity = useAmenityPin((s) => s.pin);
  // The layer is offered only while "Consider reported crime levels" is on; off on every visit,
  // and loaded the first time the renter turns it on. Turning the preference off hides it too.
  const crimeOffered = useAppStore((s) => s.intent?.safety.enabled ?? false);
  const [crimeToggled, setCrimeOn] = useState(false);
  const crimeOn = crimeOffered && crimeToggled;
  const [crimeHover, setCrimeHover] = useState<CrimeHover>(null);
  // Turning the preference off also turns the layer off, so turning it back on starts clean.
  const [offeredBefore, setOfferedBefore] = useState(crimeOffered);
  if (crimeOffered !== offeredBefore) {
    setOfferedBefore(crimeOffered);
    if (!crimeOffered) {
      setCrimeOn(false);
      setCrimeHover(null);
    }
  }
  const [crime, setCrime] = useState<CrimeState>({ status: "idle" });

  const toggleCrime = () => {
    const next = !crimeOn;
    setCrimeOn(next);
    if (!next) setCrimeHover(null);
    if (next && (crime.status === "idle" || crime.status === "error")) {
      setCrime({ status: "loading" });
      void fetchChoropleth("neighbourhood", "crime").then((result) =>
        setCrime(result.ok ? { status: "ok", layer: result.layer } : { status: "error" }),
      );
    }
  };

  const theme = useTheme();

  // Create the map, again when the theme changes (the basemap and its layers are rebuilt).
  // MapLibre touches `window`, so it's imported in the browser only.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    void import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !container.current) return;
        maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        map = new maplibregl.Map({
          container: container.current,
          style: STYLE_URLS[theme],
          center: WATERLOO,
          zoom: 12.5,
          maxBounds: MAP_MAX_BOUNDS,
          attributionControl: { compact: true },
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
        map.on("error", (event) => {
          // A missing tile is fine; a style that never loads means no map at all.
          if (!map?.isStyleLoaded() && event.error?.message?.includes("style")) setFailed(true);
        });
        map.on("load", () => {
          if (!map) return;
          if (theme === "dark") greyBasemap(map);
          addLayers(map);
          bindEvents(map, maplibregl);
          syncPins.current = bindPins(map, maplibregl, pins.current);
          mapRef.current = map;
          // Lets browser tests find pins on screen; never in production builds.
          if (process.env.NODE_ENV !== "production") Object.assign(window, { __resultsMap: map });
          setReady(true);
        });
      })
      .catch(() => setFailed(true));
    const pinMap = pins.current;
    return () => {
      cancelled = true;
      pinMap.clear();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [theme]);

  // New results: redraw and fit to listings and places.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const { points, areas: approximateAreas } = resultsToGeoJSON(results);
    (map.getSource("listings") as GeoJSONSource | undefined)?.setData(points);
    (map.getSource("approx") as GeoJSONSource | undefined)?.setData(approximateAreas);

    const places = placePins(targets ?? []);
    void import("maplibre-gl").then((maplibregl) => {
      markers.current.forEach((marker) => marker.remove());
      // Popups are opened by hand (not bound to the marker), so they go separately.
      popups.current.forEach((popup) => popup.remove());
      popups.current = [];
      markers.current = places.map((place) => {
        // The place's name in a popup: shown while hovered, kept open by a click or Enter.
        // Built from text nodes, since the label is the renter's own words.
        const content = document.createElement("div");
        const name = document.createElement("p");
        name.className = "place-popup-name";
        name.textContent = place.label;
        const kind = document.createElement("p");
        kind.className = "place-popup-kind";
        kind.textContent = t("results.map.placePopup");
        content.append(name, kind);
        const popup = new maplibregl.Popup({
          offset: 36,
          closeButton: false,
          maxWidth: "240px",
          className: "place-popup",
        }).setDOMContent(content);
        popups.current.push(popup);
        const marker = new maplibregl.Marker({ color: PLACE_COLOR })
          .setLngLat([place.lng, place.lat])
          .addTo(map);
        const element = marker.getElement();
        element.setAttribute("aria-label", place.label);
        element.setAttribute("role", "button");
        element.tabIndex = 0;
        element.style.cursor = "pointer";
        let pinned = false;
        element.addEventListener("mouseenter", () => {
          if (!popup.isOpen()) popup.setLngLat(marker.getLngLat()).addTo(map);
        });
        element.addEventListener("mouseleave", () => {
          if (!pinned) popup.remove();
        });
        // A click zooms in on the place and keeps its popup open until clicked again or the
        // map is clicked elsewhere.
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          pinned = !pinned;
          if (pinned && !popup.isOpen()) popup.setLngLat(marker.getLngLat()).addTo(map);
          // Opening a place also brings the map in close around it.
          if (pinned) {
            map.easeTo({
              center: [place.lng, place.lat],
              zoom: Math.max(map.getZoom(), PLACE_ZOOM),
              duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
            });
          }
          if (!pinned) popup.remove();
        });
        element.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          element.click();
        });
        popup.on("close", () => (pinned = false));
        return marker;
      });
    });

    const bounds = boundsOf(results, places);
    if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }, [ready, results, targets]);

  // Hovering a card in the list zooms the map to that listing, after a short pause so scrolling
  // past cards doesn't swing the map around; leaving the list returns to the view from before.
  // Hovers that start on the map itself never move it.
  const homeView = useRef<{ center: [number, number]; zoom: number } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    // A selected listing owns the view (see below); hovering doesn't move it.
    if (!ready || !map || selected || map.getContainer().matches(":hover")) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const listing = hovered ? results.find((r) => r.listing.id === hovered)?.listing : undefined;
    const timer = window.setTimeout(
      () => {
        if (listing) {
          if (!homeView.current) {
            const center = map.getCenter();
            homeView.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
          }
          map.easeTo({
            center: [listing.location.lng, listing.location.lat],
            zoom: Math.max(map.getZoom(), HOVER_ZOOM),
            duration: reduce ? 0 : 600,
          });
        } else if (homeView.current) {
          map.easeTo({ ...homeView.current, duration: reduce ? 0 : 600 });
          homeView.current = null;
        }
      },
      listing ? 250 : 600,
    );
    return () => window.clearTimeout(timer);
  }, [ready, hovered, selected, results]);

  // Selecting a listing (its card or its pin) draws a line to each of the renter's places,
  // labelled with the trip, and fits the map around them; unselecting returns to the view before.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const result = selected ? results.find((r) => r.listing.id === selected) : undefined;
    const routes = result ? routesToPlaces(result, targets ?? []) : [];
    const lines: FeatureCollection = {
      type: "FeatureCollection",
      features: routes.map((route) => ({
        type: "Feature",
        properties: { id: route.id },
        geometry: { type: "LineString", coordinates: [route.from, route.to] },
      })),
    };
    (map.getSource("routes") as GeoJSONSource | undefined)?.setData(lines);
    // The trip sits on each line's midpoint in a small label.
    let stale = false;
    void import("maplibre-gl").then((maplibregl) => {
      if (stale) return;
      routeMarkers.current.forEach((marker) => marker.remove());
      routeMarkers.current = routes.map((route) => {
        const element = document.createElement("div");
        element.className = "route-label";
        element.textContent = routeLabel(route);
        return new maplibregl.Marker({ element })
          .setLngLat([(route.from[0] + route.to[0]) / 2, (route.from[1] + route.to[1]) / 2])
          .addTo(map);
      });
      // Then the real trips, along the streets and transit lines, as the router answers. A trip
      // it can't route keeps its straight line and estimate.
      void Promise.all(routes.map((route) => fetchPath(route.from, route.to, route.mode))).then(
        (paths) => {
          if (stale) return;
          const features = routes.flatMap((route, i) => {
            const path = paths[i];
            if (!path?.legs.length) return lines.features[i] ? [lines.features[i]] : [];
            const marker = routeMarkers.current[i];
            const middle = pathMiddle(path);
            if (marker) {
              marker.getElement().textContent = routedLabel(route, path);
              if (middle) marker.setLngLat(middle);
            }
            return pathFeatures(route.id, path);
          });
          (map.getSource("routes") as GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features,
          });
          // Real paths bend away from the straight line: fit the view to them.
          if (!paths.some(Boolean)) return;
          const points = features.flatMap((feature) =>
            feature.geometry.type === "LineString"
              ? (feature.geometry.coordinates as [number, number][])
              : [],
          );
          const lngs = points.map((point) => point[0]);
          const lats = points.map((point) => point[1]);
          map.fitBounds(
            [
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)],
            ],
            {
              padding: 80,
              maxZoom: 15,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
            },
          );
        },
      );
    });

    const cleanup = () => {
      stale = true;
    };
    if (!result) {
      if (homeView.current) {
        map.easeTo({ ...homeView.current, duration: reduce ? 0 : 600 });
        homeView.current = null;
      }
      return cleanup;
    }
    if (!homeView.current) {
      const center = map.getCenter();
      homeView.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
    }
    const { lng, lat } = result.listing.location;
    if (routes.length === 0) {
      map.easeTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), HOVER_ZOOM),
        duration: reduce ? 0 : 600,
      });
      return cleanup;
    }
    const points = [[lng, lat], ...routes.map((route) => route.to)];
    const lngs = points.map((point) => point[0]!);
    const lats = points.map((point) => point[1]!);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 15, duration: reduce ? 0 : 700 },
    );
    return cleanup;
  }, [ready, selected, results, targets]);

  // New results replace the view to return to.
  useEffect(() => {
    homeView.current = null;
  }, [results]);

  // The crime layer: added once its data arrives, then shown or hidden with the toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (crime.status === "ok" && !map.getSource("crime")) {
      addCrimeLayer(map, choroplethToGeoJSON(crime.layer), setCrimeHover, theme);
    }
    if (map.getLayer("crime-fill")) {
      const visibility = crimeOn ? "visible" : "none";
      map.setLayoutProperty("crime-fill", "visibility", visibility);
      map.setLayoutProperty("crime-line", "visibility", visibility);
    }
  }, [ready, crimeOn, crime, theme]);

  // Hover and selection from the list highlight the matching pin or circle, and fade the rest.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ids = [hovered, selected].filter((id): id is string => id !== null);
    const filter: FilterSpecification = ["in", ["get", "id"], ["literal", ids]];
    map.setFilter("approx-fill", filter);
    map.setFilter("approx-line", filter);
    map.setFilter("approx-active-fill", filter);
    map.setFilter("approx-active", filter);
    // The pointed-at listing gets its own pin even inside a cluster.
    syncPins.current();
  }, [ready, hovered, selected, results]);

  // A hovered trip line ("Est. 2 min walk to groceries") pins that place, with a line to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const line: FeatureCollection = {
      type: "FeatureCollection",
      features: amenity
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [
                  [amenity.from.lng, amenity.from.lat],
                  [amenity.location.lng, amenity.location.lat],
                ],
              },
            },
          ]
        : [],
    };
    (map.getSource("amenity-line") as GeoJSONSource | undefined)?.setData(line);
    if (!amenity) return;
    let marker: Marker | null = null;
    let ours = true;
    // The walk itself, along the streets, once the router answers.
    void fetchPath(
      [amenity.from.lng, amenity.from.lat],
      [amenity.location.lng, amenity.location.lat],
      "walk",
    ).then((path) => {
      if (!ours || !path?.legs.length) return;
      (map.getSource("amenity-line") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: pathFeatures("amenity", path),
      });
    });
    void import("maplibre-gl").then((maplibregl) => {
      if (!ours) return;
      marker = new maplibregl.Marker({
        element: amenityPinElement(amenity.name, amenity.distanceM),
        anchor: "left",
        offset: [-7, 0],
      })
        .setLngLat([amenity.location.lng, amenity.location.lat])
        .addTo(map);
    });
    return () => {
      ours = false;
      marker?.remove();
    };
  }, [ready, amenity]);

  // The selected listing's card opens on its pin; closing it (or clicking the map) unselects.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const result = selected ? results.find((r) => r.listing.id === selected) : undefined;
    let ours = true;
    let popup: Popup | null = null;
    void import("maplibre-gl").then((maplibregl) => {
      if (!ours || !result || !pinCards) return;
      const { lng, lat } = result.listing.location;
      popup = new maplibregl.Popup({
        // Clear of the pin's photo above the point and its chip below.
        offset: {
          top: [0, 46],
          "top-left": [0, 46],
          "top-right": [0, 46],
          bottom: [0, -26],
          "bottom-left": [0, -26],
          "bottom-right": [0, -26],
          left: [26, 0],
          right: [-26, 0],
          center: [0, 0],
        },
        closeButton: false,
        maxWidth: "300px",
        className: "map-card-popup",
      })
        .setLngLat([lng, lat])
        .setDOMContent(listingCard(result, (href) => router.push(href)))
        .addTo(map);
      popup.on("close", () => {
        if (ours && appStore.getState().selectedListingId === result.listing.id) {
          appStore.getState().setSelectedListingId(null);
        }
      });
      card.current = popup;
    });
    return () => {
      ours = false;
      popup?.remove();
      card.current = null;
    };
  }, [ready, selected, results, router, pinCards]);

  return (
    <div className={`bg-muted relative ${className}`}>
      {/* MapLibre sets position: relative on its container, so size it, don't position it. */}
      <div
        ref={container}
        role="region"
        aria-label={t("results.map.label")}
        className="size-full"
      />
      {failed ? (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center p-6 text-center text-sm">
          {t("results.map.unavailable")}
        </p>
      ) : (
        <>
          {crimeOffered && (
            <div className="absolute top-2 left-2 flex max-w-[15rem] flex-col items-start gap-2">
              <button
                type="button"
                aria-pressed={crimeOn}
                onClick={toggleCrime}
                className={`focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm outline-none focus-visible:ring-3 ${crimeOn ? "bg-primary text-primary-foreground border-primary" : "bg-card/95 hover:bg-accent"}`}
              >
                {crime.status === "loading" ? (
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <Layers aria-hidden className="size-3.5" />
                )}
                {t("results.map.crime.toggle")}
              </button>
              {crimeOn && <CrimeLegend state={crime} hover={crimeHover} theme={theme} />}
            </div>
          )}
          <Legend />
        </>
      )}
    </div>
  );
}

function addCrimeLayer(
  map: MapLibreMap,
  data: FeatureCollection,
  onHover: (hover: CrimeHover) => void,
  theme: MapTheme,
) {
  map.addSource("crime", { type: "geojson", data });
  // Beneath the listing circles and pins, so listings stay on top.
  map.addLayer(
    {
      id: "crime-fill",
      type: "fill",
      source: "crime",
      layout: { visibility: "none" },
      paint: { "fill-color": crimeColor(theme), "fill-opacity": theme === "dark" ? 0.6 : 0.55 },
    },
    "approx-fill",
  );
  map.addLayer(
    {
      id: "crime-line",
      type: "line",
      source: "crime",
      layout: { visibility: "none" },
      paint: { "line-color": "#6b7280", "line-width": 0.6, "line-opacity": 0.6 },
    },
    "approx-fill",
  );
  const show = (event: { features?: { properties?: Record<string, unknown> }[] }) => {
    const properties = event.features?.[0]?.properties;
    if (!properties) return;
    const value = properties.value;
    onHover({ name: String(properties.name), value: typeof value === "number" ? value : null });
  };
  map.on("mousemove", "crime-fill", show);
  map.on("click", "crime-fill", show);
  map.on("mouseleave", "crime-fill", () => onHover(null));
}

const rate = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

/** The crime layer's key: five bands relative to the city, the area under the cursor, the caveats. */
function CrimeLegend({
  state,
  hover,
  theme,
}: {
  state: CrimeState;
  hover: CrimeHover;
  theme: MapTheme;
}) {
  const c = (key: string, params?: Record<string, string | number>) =>
    t(`results.map.crime.${key}` as MessageKey, params);
  if (state.status === "error") {
    return <p className="bg-card/95 rounded-lg border p-2 text-xs shadow-sm">{c("unavailable")}</p>;
  }
  if (state.status !== "ok") return null;
  const labels = ["band0", "band1", "band2", "band3", "band4"];
  return (
    <div className="bg-card/95 flex flex-col gap-1 rounded-lg border p-2 text-xs shadow-sm">
      <p className="font-medium">{c("title")}</p>
      <CrimeDisclaimer className="-mx-0.5" />
      {CRIME_COLORS[theme].map((color, index) => (
        <p key={color} className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm border" style={{ background: color }} />
          {c(labels[index]!)}
        </p>
      ))}
      <p className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-3 rounded-sm border"
          style={{ background: CRIME_NO_DATA[theme] }}
        />
        {c("noData")}
      </p>
      <p role="status" className="figures min-h-4 font-medium">
        {hover
          ? hover.value === null
            ? c("hoverNoData", { name: hover.name })
            : c("hover", { name: hover.name, rate: rate.format(hover.value) })
          : c("hint")}
      </p>
      <p className="text-muted-foreground">
        {c("source", { years: state.layer.period ?? "" })}{" "}
        <SafetyInfoButton caveats={state.layer.caveats} />
      </p>
    </div>
  );
}

function addLayers(map: MapLibreMap) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource("listings", {
    type: "geojson",
    data: empty,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 14,
  });
  map.addSource("approx", { type: "geojson", data: empty });

  // Approximate-area circles are hidden until their listing is selected or hovered.
  map.addLayer({
    id: "approx-fill",
    type: "fill",
    source: "approx",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: { "fill-color": bandColor, "fill-opacity": 0.25 },
  });
  map.addLayer({
    id: "approx-line",
    type: "line",
    source: "approx",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: { "line-color": bandColor, "line-width": 1.5 },
  });
  map.addLayer({
    id: "approx-active-fill",
    type: "fill",
    source: "approx",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: { "fill-color": ACTIVE_COLOR, "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: "approx-active",
    type: "line",
    source: "approx",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: { "line-color": ACTIVE_COLOR, "line-width": 4 },
  });
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "listings",
    filter: ["has", "point_count"],
    // A dark disc with a light ring, in the pins' style.
    paint: {
      "circle-color": "#1c1c1f",
      "circle-opacity": 0.95,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
      "circle-stroke-color": "#f4f4f5",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "listings",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff" },
  });
  // A dashed line from a listing to the nearest place behind its hovered trip line.
  map.addSource("amenity-line", { type: "geojson", data: empty });
  map.addLayer(
    {
      id: "amenity-line",
      type: "line",
      source: "amenity-line",
      layout: { "line-cap": "round" },
      paint: { "line-color": "#f4f4f5", "line-width": 2, "line-dasharray": [1.5, 1.5] },
    },
    "clusters",
  );
  // Lines from the selected listing to the renter's places (their labels are HTML markers).
  map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // A soft glow under a solid line, in the selection colour.
  // Ridden legs (and the straight line before a route arrives) glow; walked legs are dashed.
  const riddenLegs: FilterSpecification = ["!=", ["get", "walk"], true];
  map.addLayer(
    {
      id: "routes-walk",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "walk"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ACTIVE_COLOR, "line-width": 3, "line-dasharray": [0.5, 2] },
    },
    "clusters",
  );
  map.addLayer(
    {
      id: "routes-glow",
      type: "line",
      source: "routes",
      filter: riddenLegs,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ACTIVE_COLOR,
        "line-width": 12,
        "line-blur": 8,
        "line-opacity": 0.45,
      },
    },
    "clusters",
  );
  map.addLayer(
    {
      id: "routes",
      type: "line",
      source: "routes",
      filter: riddenLegs,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ACTIVE_COLOR, "line-width": 3 },
    },
    "clusters",
  );
}

/**
 * A list of the listings at one spot (often units in the same building), opened from their dot.
 * Picking one selects it, as clicking a lone dot does. Built from text nodes: titles come from
 * listings, which are untrusted.
 */
function openPlaceList(
  map: MapLibreMap,
  maplibregl: typeof import("maplibre-gl"),
  at: [number, number],
  group: SearchResultItem[],
) {
  placeList?.remove();
  const { setSelectedListingId } = appStore.getState();
  const content = document.createElement("div");
  const heading = document.createElement("p");
  heading.className = "text-muted-foreground mb-1 text-xs font-semibold";
  heading.textContent = t("results.map.unitsHere", { count: group.length });
  const list = document.createElement("ul");
  list.className = "-mx-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto";
  for (const { listing } of group) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "unit-list-item hover:bg-accent focus-visible:bg-accent flex w-full cursor-pointer flex-col rounded-lg p-1.5 text-left outline-none";
    const rent = document.createElement("span");
    rent.className = "figures text-sm font-semibold";
    rent.textContent = `${formatCad(listing.monthlyRentCad)}${
      listing.rentIsPerRoom ? t("results.perRoom") : t("results.perMonth")
    }`;
    const rooms =
      listing.bedrooms === null
        ? null
        : listing.bedrooms === 0
          ? t("results.studio")
          : t("results.beds", { n: listing.bedrooms });
    const title = document.createElement("span");
    title.className = "text-muted-foreground truncate text-xs";
    title.textContent = rooms ? `${rooms}, ${listing.title}` : listing.title;
    button.append(rent, title);
    button.addEventListener("click", () => {
      setSelectedListingId(listing.id);
      placeList?.remove();
    });
    item.append(button);
    list.append(item);
  }
  content.append(heading, list);
  placeList = new maplibregl.Popup({
    offset: 14,
    closeButton: false,
    maxWidth: "300px",
    className: "place-popup unit-list-popup",
  })
    .setLngLat(at)
    .setDOMContent(content)
    .addTo(map);
}
let placeList: Popup | null = null;

function bindEvents(map: MapLibreMap, maplibregl: typeof import("maplibre-gl")) {
  map.on("click", "clusters", async (event) => {
    const feature = event.features?.[0];
    const clusterId = feature?.properties?.cluster_id;
    if (typeof clusterId !== "number" || feature?.geometry.type !== "Point") return;
    const source = map.getSource("listings") as GeoJSONSource;
    const center = feature.geometry.coordinates as [number, number];
    // A cluster that is really one building can't be split by zooming: list its units.
    const leaves = await source.getClusterLeaves(clusterId, 200, 0);
    const ids = leaves.flatMap((leaf) =>
      typeof leaf.properties?.id === "string" ? [leaf.properties.id] : [],
    );
    const { results } = appStore.getState();
    if (allAtSamePlace(results, ids)) {
      const here = new Set(ids);
      openPlaceList(
        map,
        maplibregl,
        center,
        results.filter((result) => here.has(result.listing.id)),
      );
      return;
    }
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center, zoom });
  });
  map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));
}

/** One listing's HTML pin, kept with the result it was drawn from so new results redraw it. */
interface Pin {
  marker: Marker;
  element: HTMLButtonElement;
  result: SearchResultItem;
}

/** Highlight a pin that's hovered or selected; fade the others while any is. */
function markPin(element: HTMLElement, id: string, active: string[]) {
  element.classList.toggle("is-active", active.includes(id));
  element.classList.toggle("is-faded", active.length > 0 && !active.includes(id));
}

/**
 * Photo pins for listings that aren't in a cluster, plus the hovered or selected one wherever it
 * is. The clustered GeoJSON source decides which listings stand alone at this zoom; after every
 * move and data change the pins follow it. Returns the sync, for hover and selection changes.
 */
function bindPins(
  map: MapLibreMap,
  maplibregl: typeof import("maplibre-gl"),
  pins: Map<string, Pin>,
): () => void {
  const { setHoveredListingId, setSelectedListingId } = appStore.getState();
  // Hovering an approximate-location pin says how approximate it is.
  const approxTip = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 30,
    className: "approx-tip",
  });

  const create = (result: SearchResultItem): Pin => {
    const { id, location, locationPrecision } = result.listing;
    const element = pinElement(result);
    element.addEventListener("mouseenter", () => {
      setHoveredListingId(id);
      if (locationPrecision !== "exact") {
        const m = resultsToGeoJSON([result]).points.features[0]?.properties.radiusM ?? 0;
        approxTip
          .setLngLat([location.lng, location.lat])
          .setText(t("results.map.approxTip", { m }))
          .addTo(map);
      }
    });
    element.addEventListener("mouseleave", () => {
      setHoveredListingId(null);
      approxTip.remove();
    });
    element.addEventListener("click", (event) => {
      // Keep the map's own click (which closes the card) from firing too.
      event.stopPropagation();
      // Several units in the same building: list them instead of picking one.
      const group = listingsAtSamePlace(appStore.getState().results, id);
      if (group.length > 1) {
        openPlaceList(map, maplibregl, [location.lng, location.lat], group);
        return;
      }
      // Clicking the selected listing again unselects it.
      setSelectedListingId(appStore.getState().selectedListingId === id ? null : id);
    });
    const marker = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat([location.lng, location.lat])
      .addTo(map);
    return { marker, element, result };
  };

  const sync = () => {
    if (!map.getSource("listings") || !map.isSourceLoaded("listings")) return;
    const { results, hoveredListingId, selectedListingId } = appStore.getState();
    const byId = new Map(results.map((result) => [result.listing.id, result]));
    const alone = new Set<string>();
    for (const feature of map.querySourceFeatures("listings")) {
      const id = feature.properties?.id;
      if (!feature.properties?.point_count && typeof id === "string" && byId.has(id)) alone.add(id);
    }
    const active = [hoveredListingId, selectedListingId].filter((id): id is string => !!id);
    for (const id of active) if (byId.has(id)) alone.add(id);
    for (const [id, pin] of pins) {
      if (!alone.has(id) || pin.result !== byId.get(id)) {
        pin.marker.remove();
        pins.delete(id);
      }
    }
    for (const id of alone) {
      const pin = pins.get(id) ?? create(byId.get(id)!);
      pins.set(id, pin);
      markPin(pin.element, id, active);
    }
  };
  map.on("moveend", sync);
  map.on("sourcedata", (event) => {
    if (event.sourceId === "listings" && event.isSourceLoaded) sync();
  });
  return sync;
}

/** How opaque an approximate-location dot is, against 1 for a confirmed address. */
const APPROX_OPACITY = 0.45;

function Legend() {
  const bands: ScoreBand[] = ["high", "mid", "low"];
  return (
    // Bottom-left above the scale bar; the attribution box opens at bottom-right.
    <details className="bg-card/95 absolute bottom-9 left-2 rounded-lg border text-xs shadow-sm">
      <summary className="focus-visible:ring-ring/50 flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium outline-none hover:bg-accent focus-visible:ring-3">
        <Layers aria-hidden className="size-3.5" />
        {t("results.map.legendTitle")}
      </summary>
      <div className="flex flex-col gap-1 px-2.5 pt-1 pb-2.5">
        {bands.map((band) => (
          <p key={band} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-3 rounded-full border-2 border-white"
              style={{ background: BAND_COLORS[band] }}
            />
            {t(`results.map.${band}` as MessageKey)}
          </p>
        ))}
        <p className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-full" style={{ background: PLACE_COLOR }} />
          {t("results.map.place")}
        </p>
        <p className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-3 rounded-full border-2 border-white"
            style={{ background: BAND_COLORS.high, opacity: APPROX_OPACITY }}
          />
          {t("results.map.approx")}
        </p>
      </div>
    </details>
  );
}
