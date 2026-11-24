// The results map's look: a grey street basemap, round photo pins with a price chip, and the
// selected listing's card. DOM is built from text nodes only: titles and addresses come from
// listings, which are untrusted.
import type { Map as MapLibreMap } from "maplibre-gl";

type PaintProperty = Parameters<MapLibreMap["setPaintProperty"]>[1];
import type { SearchResultItem } from "@/lib/store/types";
import { addressLine } from "@/components/listing/address-line";
import { t } from "@/lib/format/messages";
import { formatCad } from "@/lib/format/number";
import { BAND_COLORS, scoreBand } from "./map-data";

/** The selected listing on the map and in the list: its ring, route line and card accent. */
export const ACTIVE_COLOR = "#3ddc97";

/** Short rent for a pin's chip: "$1.5k" from $1,000 up, so chips stay narrow. */
export function chipRent(cad: number): string {
  if (cad < 1000) return `$${Math.round(cad)}`;
  const k = Math.round(cad / 100) / 10;
  return `$${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

function rooms(listing: SearchResultItem["listing"]): string | null {
  if (listing.bedrooms === null) return null;
  return listing.bedrooms === 0 ? t("results.studio") : t("results.beds", { n: listing.bedrooms });
}

function rentText(listing: SearchResultItem["listing"]): string {
  return `${formatCad(listing.monthlyRentCad)}${
    listing.rentIsPerRoom ? t("results.perRoom") : t("results.perMonth")
  }`;
}

/** A house outline, for listings without a photo (or whose photo link has expired). */
function houseIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/** A round photo, falling back to the house icon when there's none or it stops loading. */
function photo(listing: SearchResultItem["listing"], className: string): HTMLSpanElement {
  const frame = document.createElement("span");
  frame.className = className;
  if (listing.imageUrl) {
    const img = document.createElement("img");
    img.src = listing.imageUrl;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.replaceWith(houseIcon()), { once: true });
    frame.append(img);
  } else frame.append(houseIcon());
  return frame;
}

/** One listing's pin: its photo in a circle, and a chip under it with the rent and score colour. */
export function pinElement({ listing, matchScore }: SearchResultItem): HTMLButtonElement {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "map-pin";
  if (listing.locationPrecision !== "exact") pin.classList.add("map-pin-approx");
  const label = [rentText(listing), rooms(listing), listing.title].filter(Boolean).join(", ");
  pin.setAttribute("aria-label", label);
  pin.append(photo(listing, "map-pin-photo"));
  const chip = document.createElement("span");
  chip.className = "map-pin-chip";
  const dot = document.createElement("i");
  dot.style.background = BAND_COLORS[scoreBand(matchScore.total)];
  chip.append(dot, chipRent(listing.monthlyRentCad));
  pin.append(chip);
  return pin;
}

/** The selected listing's card on the map: photo, title, address, a row of facts, a link. */
export function listingCard(
  { listing, matchScore }: SearchResultItem,
  onView: (href: string) => void,
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "map-card";

  const head = document.createElement("div");
  head.className = "map-card-head";
  const text = document.createElement("div");
  text.className = "map-card-text";
  const title = document.createElement("p");
  title.className = "map-card-title";
  title.textContent = listing.title;
  text.append(title);
  const where = addressLine(listing);
  if (where) {
    const address = document.createElement("p");
    address.className = "map-card-address";
    address.textContent = where;
    text.append(address);
  }
  head.append(photo(listing, "map-card-photo"), text);

  const facts = document.createElement("div");
  facts.className = "map-card-facts";
  const fact = (value: string, color?: string) => {
    const span = document.createElement("span");
    if (color) {
      const dot = document.createElement("i");
      dot.style.background = color;
      span.append(dot);
    }
    span.append(value);
    facts.append(span);
  };
  fact(
    t("results.map.cardScore", { score: Math.round(matchScore.total) }),
    BAND_COLORS[scoreBand(matchScore.total)],
  );
  fact(rentText(listing));
  const r = rooms(listing);
  if (r) fact(r);

  const view = document.createElement("a");
  const href = `/listing/${encodeURIComponent(listing.id)}`;
  view.href = href;
  view.className = "map-card-view";
  view.textContent = t("results.map.cardView");
  view.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onView(href);
  });

  card.append(head, facts, view);
  return card;
}

/** The basemap's own colours, swapped for flat greys so the pins and the route stand out. */
const GREY = {
  background: "#29292b",
  water: "#3a3b3f",
  green: "#2e302f",
  building: "#333336",
  land: "#2c2c2e",
  road: "#454549",
  majorRoad: "#56565b",
  rail: "#3d3d41",
  text: "#8d8d93",
  halo: "#29292b",
};

/** Recolour the dark basemap to greys. Paint a layer doesn't have is skipped. */
export function greyBasemap(map: MapLibreMap): void {
  const set = (id: string, property: PaintProperty, value: string | undefined) => {
    try {
      map.setPaintProperty(id, property, value);
    } catch {
      // Not every style layer has every paint property.
    }
  };
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    const name = `${id} ${"source-layer" in layer ? (layer["source-layer"] ?? "") : ""}`;
    if (layer.type === "background") set(id, "background-color", GREY.background);
    else if (layer.type === "fill") {
      const color = /water|ocean|lake|river/.test(name)
        ? GREY.water
        : /park|wood|forest|grass|landcover|green|cemetery|golf/.test(name)
          ? GREY.green
          : /building/.test(name)
            ? GREY.building
            : GREY.land;
      set(id, "fill-color", color);
      set(id, "fill-pattern", undefined);
      set(id, "fill-outline-color", color);
    } else if (layer.type === "fill-extrusion") set(id, "fill-extrusion-color", GREY.building);
    else if (layer.type === "line") {
      const color = /water|river|stream|canal/.test(name)
        ? GREY.water
        : /rail|transit/.test(name)
          ? GREY.rail
          : /motorway|trunk|primary|major/.test(name)
            ? GREY.majorRoad
            : /road|highway|street|transportation|bridge|tunnel|path/.test(name)
              ? GREY.road
              : null;
      if (color) set(id, "line-color", color);
    } else if (layer.type === "symbol") {
      set(id, "text-color", GREY.text);
      set(id, "text-halo-color", GREY.halo);
    }
  }
}
