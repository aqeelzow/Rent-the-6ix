"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { t, type MessageKey } from "@/lib/format/messages";
import { appStore, useAppStore } from "@/lib/store/store";
import {
  BAND_COLORS,
  MAP_MAX_BOUNDS,
  PLACE_COLOR,
  boundsOf,
  placePins,
  resultsToGeoJSON,
  searchAreasToGeoJSON,
  type ScoreBand,
} from "./map-data";

// Basemap: MapTiler with a key, else OpenFreeMap (no key needed). SPEC 3.
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : "https://tiles.openfreemap.org/styles/positron";
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

/**
 * Results map (SPEC 12): clustered pins, listing uncertainty circles, configured search areas and
 * place pins. Hover and select are shared with the list through the store.
 */
export function ResultsMap({ className = "" }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const results = useAppStore((s) => s.results);
  const targets = useAppStore((s) => s.intent?.travelTargets);
  const searchAreas = useAppStore((s) => s.intent?.areas);
  const hovered = useAppStore((s) => s.hoveredListingId);
  const selected = useAppStore((s) => s.selectedListingId);

  // Create the map once. MapLibre touches `window`, so it's imported in the browser only.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    void import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !container.current) return;
        maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        map = new maplibregl.Map({
          container: container.current,
          style: STYLE_URL,
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
          bindEvents(map);
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
    };
  }, []);

  // New results: redraw and fit to listings and places.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const { points, areas: approximateAreas } = resultsToGeoJSON(results);
    const queryAreas = searchAreasToGeoJSON(searchAreas ?? []);
    (map.getSource("listings") as GeoJSONSource | undefined)?.setData(points);
    (map.getSource("approx") as GeoJSONSource | undefined)?.setData(approximateAreas);
    (map.getSource("search-area") as GeoJSONSource | undefined)?.setData(queryAreas);

    const places = placePins(targets ?? []);
    void import("maplibre-gl").then((maplibregl) => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = places.map((place) => {
        const marker = new maplibregl.Marker({ color: PLACE_COLOR })
          .setLngLat([place.lng, place.lat])
          .addTo(map);
        marker.getElement().setAttribute("aria-label", place.label);
        marker.getElement().setAttribute("title", place.label);
        return marker;
      });
    });

    const bounds = boundsOf(results, places, searchAreas ?? []);
    if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }, [ready, results, targets, searchAreas]);

  // Hover and selection from the list highlight the matching pin or circle.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ids = [hovered, selected].filter((id): id is string => id !== null);
    const filter: FilterSpecification = ["in", ["get", "id"], ["literal", ids]];
    map.setFilter("pins-active", ["all", ["!", ["has", "point_count"]], filter]);
    map.setFilter("approx-active", filter);
  }, [ready, hovered, selected]);

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
        <Legend />
      )}
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
  map.addSource("search-area", { type: "geojson", data: empty });

  map.addLayer({
    id: "search-area-fill",
    type: "fill",
    source: "search-area",
    paint: { "fill-color": "#795bbf", "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: "search-area-line",
    type: "line",
    source: "search-area",
    paint: { "line-color": "#795bbf", "line-width": 2, "line-dasharray": [2, 1] },
  });
  map.addLayer({
    id: "search-area-label",
    type: "symbol",
    source: "search-area",
    layout: { "text-field": ["get", "label"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": "#553c9a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });

  map.addLayer({
    id: "approx-fill",
    type: "fill",
    source: "approx",
    paint: { "fill-color": bandColor, "fill-opacity": 0.25 },
  });
  map.addLayer({
    id: "approx-line",
    type: "line",
    source: "approx",
    paint: { "line-color": bandColor, "line-width": 1.5 },
  });
  map.addLayer({
    id: "approx-active",
    type: "line",
    source: "approx",
    filter: ["in", ["get", "id"], ["literal", []]],
    paint: { "line-color": "#0f172b", "line-width": 3 },
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
      "circle-radius": 10,
      "circle-stroke-color": "#0f172b",
      "circle-stroke-width": 3,
    },
  });
}

function bindEvents(map: MapLibreMap) {
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
      // The list scrolls to the card itself, once it's rendered (it may be past "Show more").
      setSelectedListingId(id);
    });
  }
  map.on("click", "clusters", async (event) => {
    const feature = event.features?.[0];
    const clusterId = feature?.properties?.cluster_id;
    if (typeof clusterId !== "number" || feature?.geometry.type !== "Point") return;
    const zoom = await (map.getSource("listings") as GeoJSONSource).getClusterExpansionZoom(
      clusterId,
    );
    map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
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
      <p className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 border border-dashed border-[#795bbf] bg-[#795bbf]/10" />
        {t("results.map.searchArea")}
      </p>
    </div>
  );
}
