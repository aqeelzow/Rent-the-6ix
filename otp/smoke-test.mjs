// One route per mode against a running OTP (P1.15). Run through otp/smoke-test.sh, which puts
// this on the compose network so it can reach the otp container by name.
//
// Default trip: Parkdale → U of T St George, a trip that should exercise streetcar, subway and
// walking, overridable with FROM_LAT/FROM_LON/TO_LAT/TO_LON/DATE/TIME.
const base = process.argv[2] ?? "http://otp:8080";
// `-e NAME` without a value passes an empty string, so an unset variable must not read as 0.
const text = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};
const number = (name, fallback) => {
  const value = text(name, null);
  if (value === null) return fallback; // Number(null) is 0, which silently moved the trip to Null Island
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const from = {
  lat: number("FROM_LAT", 43.6395), // Parkdale
  lon: number("FROM_LON", -79.431),
};
const to = {
  lat: number("TO_LAT", 43.6629), // U of T St George
  lon: number("TO_LON", -79.3957),
};
const date = text("DATE", new Date().toISOString().slice(0, 10));
const time = text("TIME", "08:30:00");

const MODES = [
  ["walk", "WALK"],
  ["bike", "BICYCLE"],
  ["drive", "CAR"],
  ["transit", "TRANSIT"],
];

/**
 * `transportModes` takes input objects, not raw enum strings: passing ["WALK"] makes the API
 * answer "Expected type 'Map' but was 'String'". The mode is interpolated from the fixed list
 * below rather than passed as a variable so the query needs no knowledge of the input type name.
 */
const query = (mode) => `query plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String!, $time: String!) {
  plan(from: $from, to: $to, date: $date, time: $time, numItineraries: 3, transportModes: [{ mode: ${mode} }]) {
    itineraries {
      duration
      legs { mode }
    }
  }
}`;

async function plan(mode) {
  const response = await fetch(`${base}/otp/gtfs/v1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: query(mode), variables: { from, to, date, time } }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(`${mode}: ${JSON.stringify(body.errors[0]?.message ?? body.errors)}`);
  const itineraries = body.data?.plan?.itineraries ?? [];
  // OTP returns a direct walk in TRANSIT results too, and often puts it first. Taking
  // itineraries[0] reported "transit 69 min, legs: WALK" while a 47 min two-streetcar trip
  // sat behind it, so pick the fastest and, for transit, the fastest one that actually rides.
  const fastest = (list) =>
    list.reduce((best, next) => (best === null || next.duration < best.duration ? next : best), null);
  const rides = itineraries.filter((itinerary) =>
    itinerary.legs.some((leg) => leg.mode !== "WALK"),
  );
  const chosen = mode === "TRANSIT" ? fastest(rides) : fastest(itineraries);
  const legs = chosen?.legs?.map((leg) => leg.mode).join("+") ?? "—";
  return {
    count: itineraries.length,
    minutes: chosen ? Math.round(chosen.duration / 60) : null,
    legs,
    // A TRANSIT request that only ever comes back as walking means no service at this hour.
    transitMiss: mode === "TRANSIT" && chosen === null,
  };
}

console.log(`OTP ${base} | ${date} ${time} | ${from.lat},${from.lon} → ${to.lat},${to.lon}`);
let failed = 0;
for (const [label, mode] of MODES) {
  try {
    const result = await plan(mode);
    const minutes = result.minutes === null ? "no itinerary" : `${result.minutes} min`;
    console.log(`  ${label.padEnd(8)} ${minutes.padEnd(12)} legs: ${result.legs}`);
    if (result.count === 0 || result.transitMiss) failed++;
    if (result.transitMiss)
      console.log(
        `           only walk-only itineraries for ${date} ${time}: no service, or the feed has expired — try DATE=<weekday>`,
      );
  } catch (error) {
    console.log(`  ${label.padEnd(8)} FAILED: ${error.message}`);
    failed++;
  }
}
if (failed > 0) {
  console.log(`${failed} of ${MODES.length} modes produced no itinerary`);
  process.exit(1);
}
console.log("all four modes routed");
