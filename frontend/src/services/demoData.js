// src/services/demoData.js
//
// Static demo data used when the app runs in "demo mode": the user logs in
// through Keycloak as usual, and if the authenticated username is `demo_pilot`
// (see isDemoMode in `api.js`) every live API call is bypassed and served from
// the local JSON files under `public/data/demo/` instead, so the
// SelfConsumptionOptimization page works without the backend.

const SITES_URL = '/data/demo/sites.json';
const METRICS_URL = '/data/demo/metrics.json';
const CONSUMPTION_URL = '/data/demo/consumption.json';
const OPTIMIZATION_URL = '/data/demo/optimization.json';

const HALF_HOUR_MS = 30 * 60 * 1000;

/** The most recent half-hour boundary at or before "now", in ms. */
const nowSlotMs = () => Math.floor(Date.now() / HALF_HOUR_MS) * HALF_HOUR_MS;

/**
 * Index (0-47) into the static day-long profiles for a given timestamp, based on
 * its local time-of-day. Lets us build a "next 24h" window starting at now while
 * still pulling PV/HVAC/comfort values from the correct hour of day.
 */
const profileIdxForMs = (ts) => {
  const d = new Date(ts);
  return d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
};

// Simple in-memory caches so we only fetch each JSON file once per session.
let _sitesCache = null;
let _metricsCache = null;
let _consumptionCache = null;
let _optimizationCache = null;

const loadJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Demo data: failed to load ${url} (${res.status})`);
  return res.json();
};

/** The list of buildings/sites — shape matches `/metadata/get_all_buildings`. */
export const demoFetchUsers = async () => {
  if (!_sitesCache) _sitesCache = await loadJson(SITES_URL);
  return _sitesCache;
};

/**
 * Latest comfort metrics for the currently-selected site — shape matches
 * `/history/{siteId}/metrics/latest`. The value is the static reading for the
 * current hour of day from metrics.json.
 */
export const demoLatestMetrics = async () => {
  if (!_metricsCache) _metricsCache = await loadJson(METRICS_URL);
  const hourly = _metricsCache.hourly || [];
  const now = new Date();
  const row = hourly[now.getHours()] || hourly[0] || {};
  const timestamp = now.toISOString();

  return {
    metrics: {
      tin: { value: row.indoor_temp ?? null, timestamp },
      rh: { value: row.humidity ?? null, timestamp },
      comfort_index: { value: row.comfort_index ?? null, timestamp },
      tout: { value: row.outdoor_temp ?? null, timestamp },
    },
  };
};

const loadMetricsHourly = async () => {
  if (!_metricsCache) _metricsCache = await loadJson(METRICS_URL);
  return _metricsCache.hourly || [];
};

const loadOptimization = async () => {
  if (!_optimizationCache) _optimizationCache = await loadJson(OPTIMIZATION_URL);
  return _optimizationCache;
};

/**
 * Site consumption timeseries — shape matches /history/{id}/timeseries.
 *
 * Returns the last 24h of half-hourly readings (matching the real endpoint's
 * window), built from the static half-hourly profile in consumption.json mapped
 * onto live timestamps, with light per-point noise so it doesn't look synthetic.
 * The chart derives the forward 24h forecast from this curve.
 */
export const demoUserConsumption = async () => {
  if (!_consumptionCache) _consumptionCache = await loadJson(CONSUMPTION_URL);
  const profile = _consumptionCache.half_hourly || [];
  if (profile.length === 0) return [];

  // End at the most recent half-hour boundary at or before "now".
  const end = Math.floor(Date.now() / HALF_HOUR_MS) * HALF_HOUR_MS;
  const points = [];

  // 48 steps back -> a full 24h window ending now (49 points inclusive).
  for (let i = 48; i >= 0; i--) {
    const ts = end - i * HALF_HOUR_MS;
    const d = new Date(ts);
    const idx = (d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0)) % profile.length;
    const base = profile[idx];
    const noise = 1 + (Math.random() - 0.5) * 0.08; // +/-4%
    const value = Math.max(0.3, Number((base * noise).toFixed(3)));
    points.push({ timestamp: new Date(ts).toISOString(), energy_consumption: value });
  }

  return points;
};

/** PV production — shape matches /api/energy/production. */
export const demoProductionData = async () => ({ actuals: [], forecasts: [], data: [] });

// ─── Per-run randomization ───────────────────────────────────────────────────
// Each optimization run starts from the static baseline metrics with smooth
// ~5% noise applied — these noised values are "today's conditions" (the
// un-optimized forecast). The suggested HVAC schedule is then derived from
// those conditions, so every run looks a little different while keeping the
// familiar shape: three AC blocks inside the PV window, two short ones at
// night. Each block's length reacts to the noise — if it cooled a block's
// slot there is less need for AC there (3 bars can become 1), if it warmed
// it the block grows.

const NOISE_PCT = 0.05;

/**
 * Deterministic PRNG (mulberry32). The demo seeds it with today's date so
 * re-running the optimization on the same day reproduces the exact same
 * noise and schedule, while every new day gets its own variation.
 */
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Today's local date as a number, e.g. 20260612 — the per-day demo seed. */
const todaySeed = () => {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/**
 * Smooth multiplicative noise curve over the 48 half-hour slots: random
 * anchors every `anchorStep` slots, cosine-interpolated between them, and
 * wrapped so 23:30 → 00:00 has no jump. Neighbouring slots move together,
 * which keeps the daily shape (warm midday, cool night) intact.
 */
const makeNoiseCurve = (rand, slots = 48, anchorStep = 8, pct = NOISE_PCT) => {
  const nAnchors = Math.ceil(slots / anchorStep) + 1;
  const anchors = Array.from({ length: nAnchors }, () => 1 + (rand() * 2 - 1) * pct);
  anchors[nAnchors - 1] = anchors[0];
  const curve = [];
  for (let s = 0; s < slots; s++) {
    const pos = s / anchorStep;
    const i = Math.floor(pos);
    const w = (1 - Math.cos(Math.PI * (pos - i))) / 2;
    curve.push(anchors[i] * (1 - w) + anchors[i + 1] * w);
  }
  return curve;
};

/** Clean hourly metrics interpolated to 48 half-hour slots. */
const buildCleanSlots = (hourly) => {
  const lerp = (a, b, t) => (a == null || b == null ? a ?? b ?? null : a + (b - a) * t);
  const slots = [];
  for (let idx = 0; idx < 48; idx++) {
    const cur = hourly[Math.floor(idx / 2)] || {};
    const nxt = hourly[(Math.floor(idx / 2) + 1) % 24] || cur;
    const t = idx % 2 === 0 ? 0 : 0.5;
    slots.push({
      indoor_temp: lerp(cur.indoor_temp, nxt.indoor_temp, t),
      humidity: lerp(cur.humidity, nxt.humidity, t),
      comfort_index: lerp(cur.comfort_index, nxt.comfort_index, t),
    });
  }
  return slots;
};

// The familiar schedule shape (slot index 0 = 00:00, 47 = 23:30): two night
// blocks plus three blocks inside the PV window — same anchors/lengths as the
// old static hvac_optimized in optimization.json.
const SCHEDULE_BLOCKS = [
  { start: 3, len: 2, night: true },
  { start: 9, len: 2, night: true },
  { start: 22, len: 3 },
  { start: 28, len: 3 },
  { start: 34, len: 2 },
];

// prod_pct is > 0 on slots 12..40; day blocks must stay inside so they render
// green (PV-powered), night blocks must stay outside.
const PV_FIRST_SLOT = 12;
const PV_LAST_SLOT = 40;

/**
 * PV-usage gain for the chip, in percentage points: how much bigger the
 * PV-powered share of AC runtime is under a schedule vs the baseline,
 * weighting each ON slot by its actual PV production.
 */
const computePvUsageGainPct = (hvac, prodPct, baseline) => {
  const pvShare = (sched) => {
    let on = 0;
    let pv = 0;
    sched.forEach((v, i) => {
      if (v === 1) {
        on += 1;
        pv += (prodPct[i] || 0) / 100;
      }
    });
    return on > 0 ? pv / on : 0;
  };
  return (pvShare(hvac) - pvShare(baseline)) * 100;
};

/**
 * Build one run: noised conditions + an HVAC schedule derived from them.
 * A block keeps its anchor but its length shrinks when the noise cooled its
 * slots (less cooling needed) and grows when it warmed them, and its start
 * jitters by ±1 slot.
 */
const generateDemoRun = (hourly, opt) => {
  const clean = buildCleanSlots(hourly);
  const rand = mulberry32(todaySeed());
  const tinNoise = makeNoiseCurve(rand);
  const rhNoise = makeNoiseCurve(rand);
  const ciNoise = makeNoiseCurve(rand);

  const slots = clean.map((c, i) => ({
    indoor_temp:
      c.indoor_temp != null ? Number((c.indoor_temp * tinNoise[i]).toFixed(2)) : null,
    humidity: c.humidity != null ? Number((c.humidity * rhNoise[i]).toFixed(2)) : null,
    comfort_index:
      c.comfort_index != null
        ? Math.max(0, Math.min(100, Number((c.comfort_index * ciNoise[i]).toFixed(2))))
        : null,
  }));

  const hvac = Array(48).fill(0);
  for (const b of SCHEDULE_BLOCKS) {
    // Average warming/cooling the noise applied over the block's slots.
    let delta = 0;
    for (let i = 0; i < b.len; i++) {
      delta += (slots[b.start + i]?.indoor_temp ?? 0) - (clean[b.start + i]?.indoor_temp ?? 0);
    }
    delta /= b.len;

    let len = b.len;
    if (delta < -0.3) len -= 1; // cooler than usual -> less AC needed
    else if (delta > 0.3) len += 1; // warmer than usual -> more AC needed
    len = Math.max(1, Math.min(3, len));

    let start = b.start + Math.floor(rand() * 3) - 1;
    start = b.night
      ? Math.max(0, Math.min(PV_FIRST_SLOT - len, start))
      : Math.max(PV_FIRST_SLOT, Math.min(PV_LAST_SLOT - (len - 1), start));

    for (let i = 0; i < len; i++) hvac[start + i] = 1;
  }

  const pvUsageGainPct = computePvUsageGainPct(hvac, opt.prod_pct, opt.hvac_baseline);

  return { slots, hvac, pvUsageGainPct };
};

let _demoRun = null;

const ensureDemoRun = async () => {
  if (!_demoRun) {
    _demoRun = generateDemoRun(await loadMetricsHourly(), await loadOptimization());
  }
  return _demoRun;
};

/** The current run's PV-usage gain for the ACOperationChart chip. */
export const demoPvUsageGainPct = () => _demoRun?.pvUsageGainPct ?? null;

// Demo optimization-run lifecycle: no run exists until the user presses
// Optimize. The fake run then "runs" for DEMO_RUN_DURATION_MS (the real
// optimizer takes ~25s; the demo is shortened) before reporting succeeded,
// which is when the LoadShifting section appears.
const DEMO_RUN_DURATION_MS = 6000;
let _demoRunStartedAt = null;

const demoRunFinished = () =>
  _demoRunStartedAt != null && Date.now() - _demoRunStartedAt >= DEMO_RUN_DURATION_MS;

/**
 * Latest optimization run lookup — only reports a recent run once a demo run
 * has been triggered and finished this session, so navigating back to the page
 * after a run shows the result immediately (like the real backend would).
 */
export const demoLatestOptimizationRun = async () => {
  if (!demoRunFinished()) return { has_recent: false };
  return {
    has_recent: true,
    run_id: 'demo-run-1',
    created_at: new Date(_demoRunStartedAt).toISOString(),
  };
};

/**
 * Optimization run results (the optimized AC schedule) — array of half-hour
 * rows over today. Each row carries `prod_pct` (allocated PV %), so the
 * ACOperationChart colours ON-slots green (PV) vs blue (grid) directly.
 */
export const demoOptimizationRunData = async () => {
  const opt = await loadOptimization();
  const { slots, hvac } = await ensureDemoRun();
  const start = nowSlotMs();
  const data = [];
  // Next 24h starting at now.
  for (let i = 0; i < 48; i++) {
    const ts = start + i * HALF_HOUR_MS;
    const idx = profileIdxForMs(ts);
    const m = slots[idx] || {};
    const on = hvac[idx] === 1;

    // When the AC is suggested ON, reflect the effect of the suggestion: indoor
    // temperature dips, humidity eases, and comfort rises for that slot — so the
    // advanced-view charts visibly track the AC schedule.
    const tin =
      m.indoor_temp != null ? Number((m.indoor_temp - (on ? 0.8 : 0)).toFixed(2)) : null;
    const rh = m.humidity != null ? Number((m.humidity - (on ? 2.5 : 0)).toFixed(2)) : null;
    const comfort_index =
      m.comfort_index != null
        ? Math.min(100, Number((m.comfort_index + (on ? 6 : 0)).toFixed(2)))
        : null;

    data.push({
      timestamp: new Date(ts).toISOString(),
      hvac_mode: hvac[idx],
      prod_pct: opt.prod_pct[idx],
      tin,
      rh,
      comfort_index,
    });
  }
  return { data };
};

/**
 * Per-run consumption forecast — drives start_time + the baseline hvac schedule
 * the page feeds into the forecasted-metrics call. Aligned half-hour rows.
 */
export const demoConsumptionForecast = async () => {
  const opt = await loadOptimization();
  if (!_consumptionCache) _consumptionCache = await loadJson(CONSUMPTION_URL);
  const profile = _consumptionCache.half_hourly || [];
  const start = nowSlotMs();
  const rows = [];
  // Next 24h starting at now.
  for (let i = 0; i < 48; i++) {
    const ts = start + i * HALF_HOUR_MS;
    const idx = profileIdxForMs(ts);
    rows.push({
      timestamp: new Date(ts).toISOString(),
      value: profile[idx % profile.length] ?? 0,
      hvac_mode: opt.hvac_baseline[idx],
    });
  }
  return rows;
};

/**
 * Forecasted (un-optimized baseline) comfort metrics — the comparison series for
 * the optimization charts and the comfort/PV-usage chips. Slightly worse than
 * the optimized values (warmer, more humid, lower comfort) and follows the
 * baseline hvac schedule.
 */
export const demoForecastedMetrics = async () => {
  const opt = await loadOptimization();
  const { slots } = await ensureDemoRun();
  const start = nowSlotMs();
  const rows = [];
  // Next 24h starting at now.
  for (let i = 0; i < 48; i++) {
    const ts = start + i * HALF_HOUR_MS;
    const idx = profileIdxForMs(ts);
    const m = slots[idx] || {};
    rows.push({
      timestamp: new Date(ts).toISOString(),
      tin_pred: m.indoor_temp != null ? Number((m.indoor_temp + 1.2).toFixed(2)) : null,
      rh_pred: m.humidity != null ? Number((m.humidity + 4).toFixed(2)) : null,
      comfort_index:
        m.comfort_index != null ? Math.max(0, Number((m.comfort_index - 8).toFixed(2))) : null,
      hvac_mode: opt.hvac_baseline[idx],
    });
  }
  return rows;
};

/** Kicking off an optimization run — starts the fake 6s run and re-rolls the
 *  noised conditions + derived schedule so every run looks different. */
export const demoTriggerOptimizationRun = async () => {
  _demoRunStartedAt = Date.now();
  _demoRun = generateDemoRun(await loadMetricsHourly(), await loadOptimization());
  return { run_id: 'demo-run-1' };
};

/** Polling an optimization run — `running` until the 6s demo run elapses. */
export const demoOptimizationRun = async () => ({
  status: demoRunFinished() ? 'succeeded' : 'running',
  created_at: new Date(_demoRunStartedAt ?? Date.now()).toISOString(),
});

/** Cancelling a run — forget the demo run so no "recent run" lingers. */
export const demoCancelOptimizationRun = async () => {
  _demoRunStartedAt = null;
  _demoRun = null;
  return { status: 'cancelled' };
};

/** Current weather (dashboard info cards). */
export const demoCurrentWeather = async () => ({
  temperature_celsius: 30,
  humidity_percent: 45,
  wind_speed_kmh: 10,
  solar_radiation_ghi_instant: 700,
});
