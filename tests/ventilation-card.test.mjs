import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../nhz-climate-range-card.js", import.meta.url), "utf8");
const registry = {};
class ElementStub {
  attachShadow() { return {}; }
}
const context = vm.createContext({
  HTMLElement: ElementStub,
  customElements: { get: name => registry[name], define: (name, value) => { registry[name] = value; } },
  window: { customCards: [] },
  Intl,
  Number,
  String,
});
vm.runInContext(source, context);
const Card = registry["nhz-climate-ventilation-card"];
const PrecipitationCard = registry["nhz-precipitation-chart"];
const DryWindowCard = registry["nhz-climate-dry-window-card"];

test("preserves horizontal planner positions without rebuilding for unrelated hass updates", () => {
  const card = new DryWindowCard();
  const previousDays = { scrollLeft: 386 };
  const previousWeeks = { scrollLeft: 112 };
  card.shadowRoot = { querySelector: selector => selector === ".days" ? previousDays : previousWeeks };
  const saved = card._captureHorizontalScroll();
  const nextDays = { scrollLeft: 0 };
  const nextWeeks = { scrollLeft: 0 };
  card.shadowRoot = { querySelector: selector => selector === ".days" ? nextDays : nextWeeks };
  card._restoreHorizontalScroll(saved);
  assert.deepEqual([nextDays.scrollLeft, nextWeeks.scrollLeft], [386, 112]);

  card._config = { entity: "sensor.example_dry_window" };
  const renders = [];
  card._render = value => { renders.push(value); };
  const state = { state: "70", last_updated: "2026-10-24T12:00:00Z", attributes: { planning_models: [] } };
  card.hass = { states: { "sensor.example_dry_window": state, "sensor.unrelated": { state: "on" } } };
  card.hass = { states: { "sensor.example_dry_window": state, "sensor.unrelated": { state: "off" } } };
  card.hass = { states: { "sensor.example_dry_window": { ...state, attributes: { planning_models: [{ model_key: "ifs_eps" }] } } } };
  assert.deepEqual(renders, [true, true]);
  const dryCardSource = source.slice(source.indexOf("class NhzClimateDryWindowCard"));
  assert.doesNotMatch(dryCardSource, /requestAnimationFrame|scrollIntoView|\.focus\(/);
});

test("keeps rolling IFS and EC46 dry windows separate and chronological", () => {
  const card = new DryWindowCard();
  const models = card._planningModels({
    planning_models: [
      { model_key: "ec46_eps", provider_model: "ecmwf_ec46", native_cadence_hours: 6, windows: [
        { window_hours: 24, valid_from: "2026-10-28T00:00:00Z", valid_to: "2026-10-29T00:00:00Z", dry_probability: .42, coverage_ratio: .8 },
      ] },
      { model_key: "ifs_eps", provider_model: "ecmwf_ifs", windows: [
        { window_hours: 24, valid_from: "2026-10-19T00:00:00Z", valid_to: "2026-10-20T00:00:00Z", dry_probability: .55, p10_mm: 0, p50_mm: .4, p90_mm: 4 },
        { window_hours: 24, valid_from: "2026-10-18T00:00:00Z", valid_to: "2026-10-19T00:00:00Z", dry_probability: .72, p10_mm: 0, p50_mm: .1, p90_mm: 2 },
      ] },
    ],
  });
  const filtered = card._windows(models, 24);
  assert.deepEqual([...filtered[1].windows.map(window => window.dry)], [.72, .55]);
  assert.equal(filtered[1].windows[0].p50, .1);
  assert.equal(card._coverageText(filtered[0].windows[0]), "Abdeckung 80 %");
  assert.match(card._nearFutureSection(filtered, 24, "UTC"), /trockenstes reales 24-h-Fenster/);
  assert.match(card._nearFutureSection(filtered, 24, "UTC"), /P10–P90/);
  assert.match(card._overlap(filtered, 24, "UTC"), /nicht zeitlich verschoben oder gemischt/);
});

test("accepts compact dry-window attributes without changing their semantics", () => {
  const card = new DryWindowCard();
  const models = card._planningModels({ planning_models: [{ model_key: "ifs_eps", windows: [{
    h: 24, s: "2026-10-18T00:00:00Z", e: "2026-10-19T00:00:00Z", d: .7, c: .9,
    l: 0, m: .2, q: 3.4,
  }] }] });
  const [window] = models[0].windows;
  assert.equal(window.hours, 24);
  assert.equal(window.dry, .7);
  assert.equal(window.coverage, .9);
  assert.deepEqual([window.p10, window.p50, window.p90], [0, .2, 3.4]);
});

test("expands lossless v2 column series into absolute planning windows", () => {
  const card = new DryWindowCard();
  const models = card._planningModels({
    contract_version: "dry_window_planning_v2",
    planning_models: [{ model_key: "ifs_eps", provider_model: "ecmwf_ifs", snapshot_at: "2026-10-16T00:00:00Z", series: {
      "24h": {
        base: "2026-10-19T00:00:00Z", offset_hours: [0, 6], dry_probability: [.2, .8],
        coverage_ratio: [1, .75], p10_mm: [0, null], p50_mm: [.3, null], p90_mm: [2, null],
      },
      "48h": {
        base: "2026-10-19T00:00:00Z", offset_hours: [0], dry_probability: [.5],
        coverage_ratio: [1], p10_mm: [null], p50_mm: [null], p90_mm: [null],
      },
    } }],
  });
  const twentyFour = card._windows(models, 24)[0].windows;
  const fortyEight = card._windows(models, 48)[0].windows;
  assert.equal(twentyFour.length, 2);
  assert.equal(twentyFour[1].start - twentyFour[0].start, 6 * 3600000);
  assert.equal(twentyFour[0].end - twentyFour[0].start, 24 * 3600000);
  assert.deepEqual([twentyFour[1].dry, twentyFour[1].coverage, twentyFour[1].p10, twentyFour[1].p50, twentyFour[1].p90], [.8, .75, null, null, null]);
  assert.equal(fortyEight[0].end - fortyEight[0].start, 48 * 3600000);
  assert.equal(models[0].reference, null);
  assert.equal(card._origin(card._windows(models, 24)), Date.parse("2026-10-16T00:00:00Z"));
});

test("uses a certified model reference before nominal horizon derivation", () => {
  const card = new DryWindowCard();
  const models = card._windows(card._planningModels({ planning_models: [{
    model_key: "ifs_eps", run_reference_time: "2026-10-16T06:00:00Z",
    windows: [{ window_hours: 24, valid_from: "2026-10-20T00:00:00Z", valid_to: "2026-10-21T00:00:00Z", dry_probability: .5 }],
  }] }), 24);
  assert.equal(card._origin(models), Date.parse("2026-10-16T06:00:00Z"));
});

test("bounds the daily selection and labels it as a choice among rolling starts", () => {
  const card = new DryWindowCard();
  const start = Date.parse("2026-10-16T00:00:00Z");
  const rolling = Array.from({ length: 184 }, (_, index) => {
    const validFrom = new Date(start + index * 6 * 3600000).toISOString();
    const validTo = new Date(start + (index * 6 + 24) * 3600000).toISOString();
    return { window_hours: 24, valid_from: validFrom, valid_to: validTo, dry_probability: (index % 10) / 10 };
  });
  const models = card._windows(card._planningModels({ planning_models: [
    { model_key: "ifs_eps", windows: rolling },
    { model_key: "ec46_eps", windows: rolling },
  ] }), 24);
  const days = card._nearFuture(models, "UTC");
  assert.equal(days.length, 7);
  assert.ok(days.every(day => day.rows.length <= 2));
  const hero = card._heroBest(models, "UTC");
  assert.equal(hero.model.key, "ifs_eps");
  assert.equal(hero.window.dry, .9);
  const markup = card._nearFutureSection(models, 24, "UTC");
  assert.equal((markup.match(/class="day"/g) || []).length, 7);
  assert.match(markup, /Auswahl aus 4 Starts/);
  assert.doesNotMatch(card._styles(), /#2e7d32|#d58b00|#c62828/);
});

test("compares only exact IFS and EC46 windows in the day 10–15 overlap", () => {
  const card = new DryWindowCard();
  const models = card._windows(card._planningModels({ planning_models: [
    { model_key: "ifs_eps", windows: [
      { window_hours: 48, valid_from: "2026-10-13T00:00:00Z", valid_to: "2026-10-15T00:00:00Z", dry_probability: .2 },
      { window_hours: 48, valid_from: "2026-10-20T00:00:00Z", valid_to: "2026-10-22T00:00:00Z", dry_probability: .6 },
    ], snapshot_at: "2026-10-10T00:00:00Z" },
    { model_key: "ec46_eps", windows: [{ window_hours: 48, valid_from: "2026-10-20T00:00:00Z", valid_to: "2026-10-22T00:00:00Z", dry_probability: .4 }] },
  ] }), 48);
  const comparison = card._overlap(models, 48, "UTC");
  assert.match(comparison, /Tag 10–15/);
  assert.match(comparison, /IFS Median 60 %/);
  assert.match(comparison, /EC46 Median 40 %/);
  assert.match(comparison, /Δ Median 20 Pkt/);
});

test("uses bounded EC46 week orientation with explicit rolling-window median and span", () => {
  const card = new DryWindowCard();
  const start = Date.parse("2026-10-01T00:00:00Z");
  const ec46 = Array.from({ length: 184 }, (_, index) => ({
    window_hours: 24,
    valid_from: new Date(start + index * 6 * 3600000).toISOString(),
    valid_to: new Date(start + (index * 6 + 24) * 3600000).toISOString(),
    dry_probability: .2 + (index % 6) / 10,
  }));
  const models = card._windows(card._planningModels({ planning_models: [
    { model_key: "ifs_eps", windows: [{ window_hours: 24, valid_from: new Date(start).toISOString(), valid_to: new Date(start + 86400000).toISOString(), dry_probability: .5 }] },
    { model_key: "ec46_eps", native_cadence_hours: 6, windows: ec46 },
  ] }), 24);
  const orientation = card._ec46Weeks(models, "UTC");
  assert.equal((orientation.match(/<div><strong>Tag/g) || []).length, 5);
  assert.match(orientation, /Keine Wochenprognose/);
  assert.match(orientation, /Median/);
  assert.match(orientation, /Spanne/);
});

test("keeps optional IFS comparison and planning data separate", () => {
  const card = new PrecipitationCard();
  const comparisons = card._comparisonForecasts({
    forecast_comparisons: [{ model: "ifs_eps", horizon: "0–72 h", points: [
      { valid_at: "2026-10-16T12:00:00Z", precipitation: 1.2 },
    ] }],
  });
  assert.equal(comparisons.length, 1);
  assert.match(comparisons[0].label, /ifs_eps/);
  assert.match(card._planningSummary({
    forecast_planning: { ifs_eps: { windows: [{ hours: 24, p10_mm: 0, p50_mm: 1, p90_mm: 4, dry_probability: 0.75 }] } },
  }), /24 h: P10–P90 0\.0–4\.0 mm · trocken 75 %/);
  const panel = card._comparisonChart(comparisons, new Date("2026-10-16T00:00:00Z"), new Date("2026-10-17T00:00:00Z"));
  assert.match(panel, /6‑Stunden-Modellvergleich/);
  assert.match(panel, /comparison-bar/);
  assert.doesNotMatch(panel, /class="comparison"/);
});

test("renders compact climate values and projections", () => {
  const card = new Card();
  const attrs = {
    indoor_temperature: 23,
    indoor_relative_humidity: 67,
    target_temperature: 22,
    target_relative_humidity: 50,
    ventilation_projection: {
      targets: {
        temperature_c: 22,
        relative_humidity_percent: 50,
        temperature_acceptance_c: [20, 24],
        relative_humidity_acceptance_percent: [40, 60],
      },
      current: { temperature_c: 23, relative_humidity_percent: 67 },
      horizons: {
        "1h": { available: true, temperature_c: 22.6, relative_humidity_percent: 74, air_only_temperature_c: 20.2 },
        "8h": { available: true, temperature_c: 20.9, relative_humidity_percent: 84 },
      },
    },
  };
  const climate = card._climateSummary(attrs);
  const projections = card._projectionSummary(attrs);
  assert.match(climate, /Zu feucht/);
  assert.match(climate, /23,0 °C/);
  assert.match(climate, /\+17 Pkt\./);
  assert.match(projections, /1 h/);
  assert.match(projections, /22,6 °C/);
  assert.match(projections, /8 h/);
  assert.match(projections, /Luftgrenze 20,2 °C/);
  assert.doesNotMatch(projections, /g\/kg|kJ\/kg|W/);
});

test("uses acceptance corridors for the climate headline", () => {
  const card = new Card();
  const attrs = {
    ventilation_projection: {
      current: { temperature_c: 23, relative_humidity_percent: 55 },
      targets: { temperature_c: 22, relative_humidity_percent: 50 },
    },
  };
  assert.match(card._climateSummary(attrs), /Im Zielbereich/);
});

test("omits optional projection lines when attributes are absent", () => {
  const card = new Card();
  assert.equal(card._climateSummary({}), "");
  assert.equal(card._projectionSummary({}), "");
});

test("renders duration-aware action and selected 15-minute projection", () => {
  const card = new Card();
  const attrs = {
    recommended_action: "short_airing",
    recommended_duration_minutes: 30,
    limiting_factor: "humidity",
    target_distance_before: 1.2,
    target_distance_after: 0.7,
    ventilation_projection: {
      duration_recommendation: {
        recommended_action: "short_airing",
        recommended_duration_minutes: 30,
      },
      trajectory_summary: {
        "30m": { available: true, temperature_c: 22.8, relative_humidity_percent: 61 },
        "8h": { available: true, temperature_c: 20.9, relative_humidity_percent: 84 },
      },
    },
  };
  assert.equal(card._actionLabel(attrs, "Lüften empfohlen"), "Stoßlüften · 30 min");
  const projections = card._projectionSummary(attrs);
  assert.match(projections, /30 min/);
  assert.match(projections, /22,8 °C/);
  assert.match(projections, /8 h/);
  assert.doesNotMatch(projections, /1 h/);
});

test("maps overnight and avoid actions to compact labels", () => {
  const card = new Card();
  assert.equal(card._actionLabel({ recommended_action: "overnight" }, "Lüften empfohlen"), "Nachtlüften möglich");
  assert.equal(card._actionLabel({ recommended_action: "avoid" }, "Lüften empfohlen"), "Nicht lüften");
});

test("pending block renders candidate action instead of confirmed action", () => {
  const card = new Card();
  const attrs = {
    recommended_action: "overnight",
    recommended_duration_minutes: 480,
    pending: true,
    candidate_status: "ja",
    candidate_recommended_action: "short_airing",
    candidate_recommended_duration_minutes: 30,
    candidate_remaining_seconds: 600,
  };
  const pending = card._pending(attrs);
  assert.match(pending, /Stoßlüften · 30 min/);
  assert.doesNotMatch(pending, /Nachtlüften möglich/);
});

test("does not duplicate the eight-hour endpoint for overnight action", () => {
  const card = new Card();
  const attrs = {
    recommended_action: "overnight",
    recommended_duration_minutes: 480,
    ventilation_projection: {
      duration_recommendation: {
        recommended_action: "overnight",
        recommended_duration_minutes: 480,
      },
      trajectory_summary: {
        "480m": { available: true, temperature_c: 20.9, relative_humidity_percent: 84 },
      },
      horizons: {
        "8h": { available: true, temperature_c: 20.9, relative_humidity_percent: 84 },
      },
    },
  };
  const projections = card._projectionSummary(attrs);
  assert.equal((projections.match(/20,9 °C/g) || []).length, 1);
  assert.match(projections, /8 h/);
  assert.doesNotMatch(projections, /480 min/);
});

test("stabilized top-level safety action overrides raw nested projection", () => {
  const card = new Card();
  const attrs = {
    recommended_action: "avoid",
    recommended_duration_minutes: null,
    limiting_factor: "rain",
    safety_lock_active: true,
    ventilation_projection: {
      duration_recommendation: {
        recommended_action: "short_airing",
        recommended_duration_minutes: 30,
        limiting_factor: "humidity",
      },
    },
  };
  assert.equal(card._actionLabel(attrs, "Lüften empfohlen"), "Nicht lüften");
  assert.equal(card._status("nein", attrs).label, "Nicht lüften");
});

test("initial pending state does not expose raw nested action in the main row", () => {
  const card = new Card();
  const attrs = {
    pending: true,
    recommended_action: null,
    recommended_duration_minutes: null,
    candidate_status: "ja",
    candidate_recommended_action: "short_airing",
    candidate_recommended_duration_minutes: 30,
    ventilation_projection: {
      duration_recommendation: {
        recommended_action: "short_airing",
        recommended_duration_minutes: 30,
      },
    },
  };
  assert.equal(card._actionLabel(attrs, "Daten nicht verfügbar"), "Daten nicht verfügbar");
  assert.match(card._pending(attrs), /Stoßlüften · 30 min/);
});

test("explicit null safety duration does not select raw short projection", () => {
  const card = new Card();
  const attrs = {
    recommended_action: "avoid",
    recommended_duration_minutes: null,
    ventilation_projection: {
      duration_recommendation: {
        recommended_action: "short_airing",
        recommended_duration_minutes: 30,
      },
      trajectory_summary: {
        "30m": { available: true, temperature_c: 22.8, relative_humidity_percent: 61 },
        "8h": { available: true, temperature_c: 20.9, relative_humidity_percent: 84 },
      },
    },
  };
  const projections = card._projectionSummary(attrs);
  assert.doesNotMatch(projections, /30 min/);
});
