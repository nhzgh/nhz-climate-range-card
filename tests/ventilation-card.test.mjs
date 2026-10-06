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
