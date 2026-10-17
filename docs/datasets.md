# Datasets — verified links (P0.4)

Owner: **D**. Every link in `SPEC.md` 8.1–8.2 was checked on **2026-10-16** against the
publisher's own API, not just by loading the page. This file is the record for `/data` and
for the `sources` table; `SPEC.md` holds the corrected links.

**How it was verified.** City datasets live in CKAN, and the portal at `open.toronto.ca`
serves a single-page app that answers **HTTP 200 for any slug, including nonsense** — a 200
there proves nothing. So each slug was resolved with
`GET https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=<slug>`
(success flag, title, licence, `metadata_modified`, resource count), then the specific
resource a loader would fetch was range-fetched and its first bytes inspected (GeoJSON
`FeatureCollection`, CSV header row, ZIP `PK`). The TPS portal was checked through its DCAT
catalogue (`data.tps.ca/api/feed/dcat-us/1.1.json`), and StatCan/CMHC/Geofabrik/TTC by page
title and content.

All 14 City slugs resolved. All chosen resources returned `200` with real data.

## Licence

City open data is published under the **Open Government Licence – Toronto (OGL-Toronto)**:
<https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/>
(verified, title "Open Data Licence – City of Toronto"). Note that CKAN reports
`licence_id: notspecified` for most of these datasets — including Neighbourhoods, Wards,
Address Points, TTC, Development Applications and 311 — because per-dataset licence metadata
is unfilled. The portal-wide terms still apply, so the `sources` table records
`"Open Government Licence – Toronto"` and the `/data` page says the same. Two datasets
(`apartment-building-registration`, `apartment-building-evaluation`) do carry the proper
`open-government-licence-toronto` id.

## 8.1 Toronto civic data

| Dataset | Slug | Page | Resource a loader fetches | Format | Notes |
| --- | --- | --- | --- | --- | --- |
| Neighbourhoods (158) | `neighbourhoods` | <https://open.toronto.ca/dataset/neighbourhoods/> | `…/fc443770-ef0a-4025-9c2c-2cb558bfab00/…/neighbourhoods-4326.geojson` | GeoJSON | `FeatureCollection`, WGS84. 16 resources; use the `-4326` one. `metadata_modified` 2026-02-20. |
| Neighbourhood Profiles (2021 Census) | `neighbourhood-profiles` | <https://open.toronto.ca/dataset/neighbourhood-profiles/> | `…/6e19a90f-971c-46b3-852c-0c48c436d1fc/…/nbhd_2021_census_profile_full_158model.xlsx` | **XLSX** | **2021 profiles are XLSX only** (158-model); the CSVs/JSON are 2001–2016. The sheet is characteristic-rows × neighbourhoods-columns, so the loader transposes. |
| Neighbourhood Improvement Areas | `neighbourhood-improvement-areas` | <https://open.toronto.ca/dataset/neighbourhood-improvement-areas/> | `…/neighbourhood-improvement-areas-4326.geojson` | GeoJSON | 12 resources. |
| City Wards (25) | `city-wards` | <https://open.toronto.ca/dataset/city-wards/> | `…/5e7a8234-f805-43ac-820f-03d7c360b588/…/city-wards-data-4326.geojson` | GeoJSON | The 25-ward model is the `City Wards Data` GeoJSON; the other ZIPs are 44/47-ward **historical** models — do not load them. |
| Ward Profiles | — (not open data) | <https://www.toronto.ca/city-government/council/ward-profiles/> | HTML pages | HTML | Redirects to the same page it was linked from. Not machine-readable; ward indicators come from Neighbourhood Profiles + TPS + Census instead. Manual figures only. |
| Apartment Building Registration (RentSafeTO) | `apartment-building-registration` | <https://open.toronto.ca/dataset/apartment-building-registration/> | `…/2b98b3f3-4f3a-42a4-a4e9-b44d3026595a/…/apartment-building-registration-data.csv` | CSV | Real header: `_id, AIR_CONDITIONING_TYPE, AMENITIES_AVAILABLE, …, RSN`. `metadata_modified` 2026-07-05. OGL-Toronto id set. |
| Apartment Building Evaluations (2023–current) | `apartment-building-evaluation` | <https://open.toronto.ca/dataset/apartment-building-evaluation/> | `…/4ef82789-e038-44ef-a478-a8f3590c3eb1/…/apartment-building-evaluations-2023-current.csv` | CSV | **Not retired.** Same dataset holds `Apartment Building Evaluations 2023 - current` plus `Pre-2023 Apartment Building Evaluations`. Header confirmed: `_id, RSN, YEAR REGISTERED, YEAR BUILT, YEAR EVALUATED, PROPERTY TYPE, WARD, …, CONFIRMED STOREYS, CONFIRMED UNITS, EVALUATION COMPONENT…`. `metadata_modified` 2026-10-08. |
| Address Points (One Address Repository) | `address-points-municipal-toronto-one-address-repository` | <https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/> | `…/abedd8bc-e3dd-4d45-8e69-79165a76e4fa/…/address-points-4326.geojson` | GeoJSON | `metadata_modified` 2026-10-16 (refreshed often). 10 resources; `-4326` for WGS84. Large — stream it. |
| TTC Routes and Schedules (GTFS) | `ttc-routes-and-schedules` | <https://open.toronto.ca/dataset/ttc-routes-and-schedules/> | `…/7795b45e-e65a-4465-81fc-c36b9dfff169/…/opendata_ttc_schedules.zip` | ZIP (GTFS) | Single resource; verified as a real ZIP starting `agency.txt`. Feeds `transit_stops` and OTP. `metadata_modified` 2026-09-25. |
| Development Applications | `development-applications` | <https://open.toronto.ca/dataset/development-applications/> | `…/0aa7e480-9b48-4919-98e0-6af7615b7809/…/development-applications.csv` | CSV | `metadata_modified` 2026-10-16. |
| Building Permits – Active | `building-permits-active-permits` | <https://open.toronto.ca/dataset/building-permits-active-permits/> | `…/108c2bd1-6945-46f6-af92-02f5658ee7f7/…/building-permits-active-permits.csv` | CSV | `metadata_modified` 2026-10-16. P1, not the demo path. |
| Library Branch General Information | `library-branch-general-information` | <https://open.toronto.ca/dataset/library-branch-general-information/> | `…/f5aa9b07-…/tpl-branch-general-information-4326.geojson` | GeoJSON | 11 resources. |
| Parks and Recreation Facilities | `parks-and-recreation-facilities` | <https://open.toronto.ca/dataset/parks-and-recreation-facilities/> | `…/cbea3a67-…/parks-and-recreation-facilities-4326.geojson` | GeoJSON | 9 resources; covers parks and community centres. |
| School Locations – All Types | `school-locations-all-types` | <https://open.toronto.ca/dataset/school-locations-all-types/> | `…/1a714b5c-…/school-locations-all-types-data-4326.geojson` | GeoJSON | 13 resources; carries school type, needed for elementary/secondary split. |
| 311 Service Requests | `311-service-requests-customer-initiated` | <https://open.toronto.ca/dataset/311-service-requests-customer-initiated/> | `…/2e54bc0e-…/sr2026.zip` (one ZIP per year) | ZIP (CSV) | 18 resources, one per year. The 2026 file is the live one; P1, not the demo path. |
| 2026 Municipal Election info | — | <https://www.toronto.ca/city-government/elections/> | static links only | HTML | Civic, not partisan: static official links only (SPEC 9.3). No loader. |

The `…` ellipses above abbreviate the CKAN dataset UUID; ask the CKAN API for the resource
`url` at load time rather than hard-coding resource IDs, which change when the City republishes.

## 8.2 Other public data

| Source | Verified URL | Format | Notes |
| --- | --- | --- | --- |
| TPS Neighbourhood Crime Rates | <https://data.tps.ca/datasets/TorontoPS::neighbourhood-crime-rates-open-data> | CSV / ArcGIS REST | **The SPEC link is stale**: `data.torontopolice.on.ca/pages/open-data` now 301s to `data.tps.ca`. Use the dataset above. CSV verified: 317 KB, **158 rows** (one per neighbourhood) × **222 columns**, keyed `HOOD_158` + `NEIGHBOURHOOD_NAME`, with `*_RATE_2014…2025` per offence. Wide format — one row per neighbourhood, so the loader unpivots to `indicator_id` + `period`. Download: `https://data.tps.ca/api/download/v1/items/ea0cfecdb1de416884e6b0bf08a9e195/csv?layers=0`. ArcGIS service: `services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/Neighbourhood_Crime_Rates_Open_Data/FeatureServer`. Catalogue `modified` 2026-02-02. |
| StatCan 46-10-0092-01 | <https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201> | HTML / CSV via WDS | Confirmed live: "rent and paid rent prices, by rental unit type and number of bedrooms… in select Census Metropolitan Areas". Experimental quarterly series. |
| CMHC Rental Market Survey tables | <https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data/data-tables/rental-market/rental-market-report-data-tables> | XLSX (behind a JS list) | Page verified (title "Rental Market Survey Data Tables"), but the file links are client-rendered — only one `.xlsx` string in the HTML. Resolve URLs at load time or use the CMHC API; do not hard-code file names. |
| OpenStreetMap — Geofabrik Ontario | <https://download.geofabrik.de/north-america/canada/ontario.html> | PBF | `ontario-latest.osm.pbf` verified: **1.03 GB**, `Last-Modified: 2026-10-17 01:32 UTC`. ODbL — credit "© OpenStreetMap contributors". Clip to Toronto + 10 km with `osmium` before building the OTP graph. |
| TTC fares | <https://www.ttc.ca/fares-and-passes> | HTML | Monthly pass price for the true monthly cost; figures are manual (benchmarks seed), not scraped. |

## Discrepancies found, and what changed

1. **`apartment-building-evaluation` is not retired.** The SPEC said the older dataset was
   retired; the slug is live and now holds `2023 - current` plus `Pre-2023` resources
   (updated 2026-10-08). The "search for a replacement" instruction is void.
2. **TPS moved.** `data.torontopolice.on.ca` redirects to `data.tps.ca`; the open-data landing
   page is gone. The safety feature must use the named dataset, not the portal root.
3. **2021 Neighbourhood Profiles are XLSX only.** The loader needs an XLSX reader, and the
   sheet is transposed relative to the 2001–2016 CSVs.
4. **`city-wards` mixes ward models.** Three of its ZIPs are 44/47-ward history; only
   `City Wards Data` (25-ward, 4326) is correct.
5. **CKAN licence metadata is mostly absent** while the portal terms are OGL-Toronto. Record
   the licence per dataset as OGL-Toronto and keep the licence URL above in `sources.note`.
6. **Ward Profiles has no data feed.** It is an HTML page; ward indicators must be computed
   from Neighbourhood Profiles, Census and TPS instead of downloaded.

## When the loaders land (P1.10–P1.14)

Each loader inserts one `sources` row: `id` = the slug above, `title` = dataset title, `url` =
the page, `licence` = `Open Government Licence – Toronto` (or `ODbL` for OSM, TPS terms for
crime data), `retrieved_at` = the date of the run, `note` = the resource `url` actually
fetched. `/data` renders that table, so the page is honest by construction.
