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
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/theme";
import type { AreaChoropleth, SearchResultItem } from "@/lib/store/types";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad } from "@/lib/format/number";
import { SafetyInfoButton } from "@/components/safety/safety-info";
import { fetchChoropleth } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import {
  BAND_COLORS,
  CRIME_COLORS,
  CRIME_NO_DATA,
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
const TORONTO: [number, number] = [-79.383, 43.68];

const bandColor: ExpressionSpecification = [
  "match",
  ["get", "band"],
  "high",
  BAND_COLORS.high,
  "mid",
  BAND_COLORS.mid,
  BAND_COLORS.low,
];

const crimeColor: ExpressionSpecification = [
  "case",
  ["==", ["typeof", ["get", "value"]], "number"],
  [
    "step",
    ["get", "value"],
    CRIME_COLORS[0],
    CRIME_STEPS[0],
    CRIME_COLORS[1],
    CRIME_STEPS[1],
    CRIME_COLORS[2],
    CRIME_STEPS[2],
    CRIME_COLORS[3],
    CRIME_STEPS[3],
    CRIME_COLORS[4],
  ],
  CRIME_NO_DATA,
];

type CrimeState =
  { status: "idle" | "loading" | "error" } | { status: "ok"; layer: AreaChoropleth };
type CrimeHover = { name: string; value: number | null } | null;

/**
 * Results map (SPEC 12): clustered pins, listing uncertainty circles and
 * place pins. Hover and select are shared with the list through the store.
 * An opt-in "Crime rates" layer shades neighbourhoods by police-reported
 * crime relative to the city, with its caveats beside it (SPEC 7.6).
 */
/** The highlighted listing's ring: a warm orange no score band or place pin uses. */
const ACTIVE_COLOR = "#e8590c";

/** The trip on a route line: an estimate from distance, so it says so, with the distance. */
function routeLabel(route: RouteToPlace): string {
  return t("results.map.routeEstimate", {
    minutes: route.minutes,
    mode: t(`filters.modes.${route.mode}` as MessageKey),
    km: new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(route.distanceM / 1000),
  });
}

/** How close the map comes in on a place pin that's clicked (a few blocks around it). */
const PLACE_ZOOM = 15;

/** How close the map comes in on a listing hovered in the list (street level). */
const HOVER_ZOOM = 14.5;

export function ResultsMap({ className = "" }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const popups = useRef<Popup[]>([]);
  const routeMarkers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const results = useAppStore((s) => s.results);
  const targets = useAppStore((s) => s.intent?.travelTargets);
  const hovered = useAppStore((s) => s.hoveredListingId);
  const selected = useAppStore((s) => s.selectedListingId);
  // Off on every visit; loaded the first time the renter turns it on.
  const [crimeOn, setCrimeOn] = useState(false);
  const [crime, setCrime] = useState<CrimeState>({ status: "idle" });
  const [crimeHover, setCrimeHover] = useState<CrimeHover>(null);

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
          center: TORONTO,
          zoom: 10.5,
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
          addLayers(map);
          bindEvents(map, maplibregl);
          mapRef.current = map;
          // Lets browser tests find pins on screen; never in production builds.
          if (process.env.NODE_ENV !== "production") Object.assign(window, { __resultsMap: map });
          setReady(true);
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
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
      addCrimeLayer(map, choroplethToGeoJSON(crime.layer), setCrimeHover);
    }
    if (map.getLayer("crime-fill")) {
      const visibility = crimeOn ? "visible" : "none";
      map.setLayoutProperty("crime-fill", "visibility", visibility);
      map.setLayoutProperty("crime-line", "visibility", visibility);
    }
  }, [ready, crimeOn, crime]);

  // Hover and selection from the list highlight the matching pin or circle.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ids = [hovered, selected].filter((id): id is string => id !== null);
    const filter: FilterSpecification = ["in", ["get", "id"], ["literal", ids]];
    const pinFilter: FilterSpecification = ["all", ["!", ["has", "point_count"]], filter];
    map.setFilter("pins-active", pinFilter);
    map.setFilter("approx-fill", filter);
    map.setFilter("approx-line", filter);
    map.setFilter("approx-active-fill", filter);
    map.setFilter("approx-active", filter);
    // A halo and centre dot mark each highlighted listing, approximate circles included.
    const focus: FeatureCollection = {
      type: "FeatureCollection",
      features: results
        .filter((result) => ids.includes(result.listing.id))
        .map((result) => ({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [result.listing.location.lng, result.listing.location.lat],
          },
        })),
    };
    (map.getSource("focus") as GeoJSONSource | undefined)?.setData(focus);
    // Fade every other listing while one is pointed at, so the active one stands out.
    const active: ExpressionSpecification = ["in", ["get", "id"], ["literal", ids]];
    const faded = (on: number, off: number): ExpressionSpecification | number =>
      ids.length ? ["case", active, on, off] : on;
    map.setPaintProperty("pins", "circle-opacity", faded(1, 0.3));
    map.setPaintProperty("pins", "circle-stroke-opacity", faded(1, 0.3));
  }, [ready, hovered, selected, results]);

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
            {crimeOn && <CrimeLegend state={crime} hover={crimeHover} />}
          </div>
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
) {
  map.addSource("crime", { type: "geojson", data });
  // Beneath the listing circles and pins, so listings stay on top.
  map.addLayer(
    {
      id: "crime-fill",
      type: "fill",
      source: "crime",
      layout: { visibility: "none" },
      paint: { "fill-color": crimeColor, "fill-opacity": 0.5 },
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
function CrimeLegend({ state, hover }: { state: CrimeState; hover: CrimeHover }) {
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
      {CRIME_COLORS.map((color, index) => (
        <p key={color} className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm border" style={{ background: color }} />
          {c(labels[index]!)}
        </p>
      ))}
      <p className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-3 rounded-sm border"
          style={{ background: CRIME_NO_DATA }}
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
    paint: {
      "circle-color": BAND_COLORS.high,
      "circle-opacity": 0.85,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
      "circle-stroke-color": "#ffffff",
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
  map.addLayer({
    id: "pins",
    type: "circle",
    source: "listings",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": bandColor,
      "circle-radius": 7,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "pins-active",
    type: "circle",
    source: "listings",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: {
      "circle-color": bandColor,
      "circle-radius": 11,
      "circle-stroke-color": ACTIVE_COLOR,
      "circle-stroke-width": 4,
    },
  });
  // Lines from the selected listing to the renter's places (their labels are HTML markers).
  map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer(
    {
      id: "routes",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round" },
      paint: { "line-color": ACTIVE_COLOR, "line-width": 3, "line-dasharray": [1.5, 1.5] },
    },
    "clusters",
  );
  map.addSource("focus", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "focus-halo",
    type: "circle",
    source: "focus",
    paint: {
      "circle-color": ACTIVE_COLOR,
      "circle-opacity": 0.15,
      "circle-radius": 26,
      "circle-stroke-color": ACTIVE_COLOR,
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "focus-dot",
    type: "circle",
    source: "focus",
    paint: {
      "circle-color": ACTIVE_COLOR,
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
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
  const { setHoveredListingId, setSelectedListingId } = appStore.getState();
  for (const layer of ["pins", "approx-fill"]) {
    map.on("mousemove", layer, (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") setHoveredListingId(id);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layer, () => {
      setHoveredListingId(null);
      map.getCanvas().style.cursor = "";
    });
    map.on("click", layer, (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      // Several units in the same building: list them instead of picking one.
      const group = listingsAtSamePlace(appStore.getState().results, id);
      if (group.length > 1) {
        openPlaceList(map, maplibregl, [event.lngLat.lng, event.lngLat.lat], group);
        return;
      }
      // Clicking the selected listing again unselects it. Otherwise the list scrolls to the
      // card itself, once it's rendered (it may be past "Show more").
      setSelectedListingId(appStore.getState().selectedListingId === id ? null : id);
    });
  }
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

function Legend() {
  const bands: ScoreBand[] = ["high", "mid", "low"];
  return (
    // Bottom-left above the scale bar; the attribution box opens at bottom-right.
    <div className="bg-card/95 absolute bottom-9 left-2 flex flex-col gap-1 rounded-lg border p-2 text-xs shadow-sm">
      <p className="font-medium">{t("results.map.legendTitle")}</p>
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
      <p className="text-muted-foreground">{t("results.map.approx")}</p>
    </div>
  );
}
