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
