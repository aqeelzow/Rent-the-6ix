-- civic-status.sql — read-only health check for the civic data (owner: D).
--
-- Run it in the TigerData console, or from the repo:
--   tiger db query --file db/queries/civic-status.sql --read-only
--
-- It answers "is the data actually there, and does it join to the listings?" in eight queries.
-- Nothing here writes: safe to run against production at any time, including during a demo.
-- `pnpm data:civic` is what fills these tables — this file only inspects them.

-- 1. Every table and how many rows it holds. The zeros are the honest gaps.
select 'listings' as table_name, count(*) as rows from listings
union all select 'listing_observations', count(*) from listing_observations
union all select 'sources', count(*) from sources
union all select 'neighbourhoods', count(*) from neighbourhoods
union all select 'wards', count(*) from wards
union all select 'address_points', count(*) from address_points
union all select 'pois', count(*) from pois
union all select 'transit_stops', count(*) from transit_stops
union all select 'buildings', count(*) from buildings
union all select 'area_indicators', count(*) from area_indicators
union all select 'dev_applications', count(*) from dev_applications
union all select 'benchmarks', count(*) from benchmarks
union all select 'travel_times', count(*) from travel_times
union all select 'ai_cache', count(*) from ai_cache
order by table_name;

-- 2. Does the civic data actually reach the listings? 100% on all three is the target.
select count(*) as listings,
       count(*) filter (where neighbourhood_id is not null) as with_neighbourhood,
       count(*) filter (where address_point_id is not null) as with_address_point,
       count(*) filter (where building_id is not null) as with_building,
       count(*) filter (where location_precision = 'exact') as exact_location
  from listings
 where status = 'active';

-- 3. Amenities by category — every category should be non-zero, or a loader broke.
select category, count(*) as pois
  from pois
 group by category
 order by category;

-- 4. Transit stops by mode, and how many of them are rapid (subway) for the 800 m indicator.
select case when is_rapid then 'rapid' else 'local' end as kind,
       count(*) as stops,
       count(distinct name) as distinct_names
  from transit_stops
 group by 1
 order by kind;

-- 5. RentSafeTO: score distribution and the colour band the sign would show.
select coalesce(sign_colour, 'no score') as sign,
       count(*) as buildings,
       round(avg(latest_score), 1) as avg_score
  from buildings
 group by 1
 order by buildings desc;

-- 6. Highest assault rates, three-year average — a sanity check on the TPS join.
select a.area_id, n.name, a.value as assault_per_100k, a.period
  from area_indicators a
  join neighbourhoods n on n.id = a.area_id
 where a.indicator_id = 'crime:assault'
 order by a.value desc
 limit 5;

-- 7. Provenance: what /data will render, including the licence and period of each dataset.
select id, licence, period, retrieved_at
  from sources
 order by id;

-- 8. One listing resolved through the whole civic layer — the demo query.
with listing as (
  select id, location, neighbourhood_id, ward_id, building_id
    from listings
   where status = 'active' and location is not null
   order by last_seen_at desc
   limit 1
)
select l.id as listing_id,
       l.neighbourhood_id as neighbourhood,
       (select name from neighbourhoods n where n.id = l.neighbourhood_id) as neighbourhood_name,
       l.ward_id as ward,
       (select round(st_distance(p.location, l.location)) from pois p
         where p.category = 'grocery' order by p.location <-> l.location limit 1) as metres_to_grocery,
       (select round(st_distance(t.location, l.location)) from transit_stops t
         where t.is_rapid order by t.location <-> l.location limit 1) as metres_to_rapid,
       (select b.latest_score from buildings b where b.id = l.building_id) as building_score,
       (select round(a.value::numeric, 1) from area_indicators a
         where a.area_id = l.neighbourhood_id and a.indicator_id = 'crime:assault') as assault_per_100k
  from listing l;
