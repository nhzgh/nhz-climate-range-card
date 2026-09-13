class NhzPrecipitationChart extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = config;
    this._renderMessage("Niederschlagsdaten werden geladen …");
  }

  set hass(hass) {
    this._hass = hass;
    this._load();
  }

  getCardSize() { return 5; }

  _renderMessage(message) {
    this.shadowRoot.innerHTML = `<ha-card><div class="message">${message}</div></ha-card><style>.message{padding:24px;color:var(--secondary-text-color)}</style>`;
  }

  _rangeStart(now) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (this._config.range === "7d" ? 6 : 29));
    return start;
  }

  async _statistics(entityId, start, end, period) {
    const response = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: [entityId],
      period,
      types: ["change"],
      units: {},
    });
    return response?.[entityId] || [];
  }

  _cumulative(rows, timeField, valueField, startTime) {
    let total = 0;
    const result = [[startTime, 0]];
    for (const row of rows) {
      const value = Number(row[valueField]);
      if (!Number.isFinite(value)) continue;
      total += Math.max(0, value);
      result.push([Number(row[timeField]), total]);
    }
    return result;
  }

  _path(points, x, y, stepped = false) {
    if (!points.length) return "";
    let path = `M ${x(points[0][0])} ${y(points[0][1])}`;
    for (let index = 1; index < points.length; index += 1) {
      const [time, value] = points[index];
      if (stepped) path += ` H ${x(time)} V ${y(value)}`;
      else path += ` L ${x(time)} ${y(value)}`;
    }
    return path;
  }

  _lineChart(actual, expected, start, end, actualTotal, expectedTotal) {
    const width = 760, height = 300, left = 48, right = 18, top = 18, bottom = 38;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    const maximum = Math.max(1, actualTotal, expectedTotal) * 1.12;
    const x = value => left + ((value - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * innerWidth;
    const y = value => top + innerHeight - (value / maximum) * innerHeight;
    const grid = [0, .25, .5, .75, 1].map(fraction => {
      const value = maximum * fraction;
      return `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" class="grid"/><text x="${width-right-3}" y="${y(value)-5}" text-anchor="end" class="axis">${Math.round(value)} mm</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Kumulativer Niederschlag">
      ${grid}
      <path d="${this._path(expected, x, y)}" class="expected"/>
      <path d="${this._path(actual, x, y, true)}" class="actual"/>
      <circle cx="${x(end.getTime())}" cy="${y(expectedTotal)}" r="6" class="expected-dot"/>
      <circle cx="${x(end.getTime())}" cy="${y(actualTotal)}" r="6" class="actual-dot"/>
      <text x="${left}" y="${height-10}" class="date">${this._config.range === "7d" ? "Vor 7 Tagen" : "Vor 30 Tagen"}</text>
      <text x="${width-right}" y="${height-10}" text-anchor="end" class="date">Heute</text>
    </svg>`;
  }

  async _load() {
    if (!this._hass || !this._config) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    const graph = this._config.graph;
    const profile = this._hass.states[graph.profile_entity];
    if (!profile || profile.state === "unavailable") {
      this._renderMessage("Klimaprofil ist nicht verfügbar.");
      return;
    }
    const now = new Date();
    const start = this._rangeStart(now);
    try {
      const statistics = await this._statistics(graph.aggregate_source_entity, start, now, "day");
      if (this._generation !== generation) return;
      const actualRows = statistics.map(point => ({ time: point.start, value: point.change }));
      const actual = this._cumulative(actualRows, "time", "value", start.getTime());
      const climateRows = (profile.attributes.daily_normal || [])
        .map(point => ({ time: new Date(`${point.valid_on}T12:00:00`).getTime(), value: point.mean }))
        .filter(point => point.time >= start.getTime() && point.time <= now.getTime());
      const expected = this._cumulative(climateRows, "time", "value", start.getTime());
      const actualTotal = actual.at(-1)?.[1] || 0, expectedTotal = expected.at(-1)?.[1] || 0;
      actual.push([now.getTime(), actualTotal]);
      expected.push([now.getTime(), expectedTotal]);
      this._render(graph, actualTotal, expectedTotal, this._lineChart(actual, expected, start, now, actualTotal, expectedTotal));
    } catch (error) {
      this._renderMessage(`Niederschlagsstatistik konnte nicht geladen werden: ${error.message}`);
    }
  }

  _render(graph, actual, expected, chart) {
    const difference = actual - expected;
    const direction = difference >= 0 ? "über" : "unter";
    this.shadowRoot.innerHTML = `<ha-card>
      <div class="content">
        <h2>${graph.title} – ${graph.explanation}</h2>
        <div class="difference">${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(0)} mm ${direction} dem Durchschnitt</div>
        <div class="subtitle">${this._config.range === "7d" ? "7" : "30"}-Tage-Durchschnitt: ${expected.toFixed(0)} mm</div>
        <div class="totals"><div><strong>${expected.toFixed(0)} mm</strong><span>Durchschnitt</span></div><div><strong>${actual.toFixed(0)} mm</strong><span>Letzte ${this._config.range === "7d" ? "7" : "30"} Tage</span></div></div>
        ${chart}
        <div class="legend"><span><i class="actual-key"></i>Letzte ${this._config.range === "7d" ? "7" : "30"} Tage</span><span><i class="expected-key"></i>Durchschnitt</span></div>
      </div>
    </ha-card><style>
      .content{padding:18px 20px 16px;color:var(--primary-text-color)}h2{font-size:20px;margin:0 0 16px;color:var(--secondary-text-color)}
      .difference{font-size:30px;font-weight:650;line-height:1.15}.subtitle{font-size:16px;font-weight:600;color:var(--secondary-text-color);margin:6px 0 16px}
      .totals{display:flex;justify-content:space-between;gap:18px;margin:4px 4% 2px}.totals div{display:flex;flex-direction:column}.totals div:last-child{text-align:right}.totals strong{font-size:30px}.totals span{color:var(--secondary-text-color);font-size:13px}
      svg{width:100%;display:block;overflow:visible}.grid{stroke:var(--divider-color);stroke-width:1}.axis,.date,.month{fill:var(--secondary-text-color);font-size:12px;font-weight:600}
      .actual{fill:none;stroke:#25C7F4;stroke-width:6;stroke-linejoin:round;stroke-linecap:round}.expected{fill:none;stroke:#8D93A6;stroke-width:5;stroke-dasharray:12 10;stroke-linecap:round}
      .actual-dot{fill:#25C7F4;stroke:var(--card-background-color);stroke-width:3}.expected-dot{fill:#8D93A6;stroke:var(--card-background-color);stroke-width:3}
      .legend{display:flex;gap:24px;justify-content:center;flex-wrap:wrap;color:var(--secondary-text-color);font-size:14px}.legend span{display:flex;align-items:center;gap:8px}.legend i{width:12px;height:12px;border-radius:50%}.actual-key{background:#25C7F4}.expected-key{background:#8D93A6}
      @media(max-width:600px){.difference{font-size:23px}.totals strong{font-size:25px}.content{padding:16px 12px}.axis{font-size:11px}}
    </style>`;
  }
}

class NhzClimateRangeCard extends HTMLElement {
  setConfig(config) {
    if (!Array.isArray(config.graphs) || !config.graphs.length) {
      throw new Error("nhz-climate-range-card requires graphs");
    }
    this._config = config;
    this._range = config.default_range || "today";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    for (const card of this._cards || []) card.hass = hass;
  }

  getCardSize() {
    return 1 + (this._config?.graphs?.length || 1) * 5;
  }

  _button(label, range) {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = this._range === range ? "active" : "";
    button.addEventListener("click", () => {
      if (this._range === range) return;
      this._range = range;
      this._render();
    });
    return button;
  }

  _todaySeries(graph) {
    const entity = graph.profile_entity;
    const center = graph.circular ? "mean" : "median";
    const normal = (field, collection = "hourly_normal") =>
      `return (entity.attributes.${collection} || []).map(p => [new Date(p.valid_at).getTime(), Number(p.${field})]);`;
    const series = [];
    if (!graph.circular) {
      series.push(
        { entity, name: "ERA5 P90", type: "line", color: "#80CBC4", stroke_width: 2, stroke_dash: 3, data_generator: normal("p90"), show: { legend_value: false } },
        { entity, name: "ERA5 P10", type: "line", color: "#80CBC4", stroke_width: 2, stroke_dash: 3, data_generator: normal("p10"), show: { legend_value: false } }
      );
    }
    series.push(
      { entity, name: graph.circular ? "Zirkuläres Mittel 1991–2020" : "ERA5 P50 1991–2020", type: "line", color: "#00897B", stroke_width: 3, data_generator: normal(center), show: { legend_value: false } },
      { entity, name: graph.circular ? "Zirkuläres Mittel ab 1950" : "ERA5 P50 ab 1950", type: "line", color: "#7E57C2", stroke_width: 2, stroke_dash: 5, data_generator: normal(center, "hourly_all"), show: { legend_value: false } },
      { entity: graph.source_entity, name: "Ist heute", type: "line", color: "#039BE5", stroke_width: 4, extend_to: false,
        ...(graph.source_factor ? { transform: `return x * ${Number(graph.source_factor)};` } : {}),
        show: { legend_value: false } }
    );
    if (graph.forecast) {
      series.push({
        entity, name: "Vorhersage", type: "line", color: "#FB8C00", stroke_width: 4,
        data_generator: `const day=entity.attributes.profile_date; const field=entity.attributes.forecast_field; return (entity.attributes.hourly_forecast || []).filter(p => String(p.datetime).slice(0,10) === day && field && p[field] != null).map(p => [new Date(p.datetime).getTime(), Number(p[field])]);`,
        show: { legend_value: false }
      });
    }
    return series;
  }

  _dailySeries(graph) {
    const entity = graph.profile_entity;
    const weekly = ['90d', '365d'].includes(this._range);
    const climate = (field, collection) => weekly
      ? `const rows=(entity.attributes.${collection.replace("daily_", "seven_day_")} || []).filter(p => p.${field} != null); const result=[]; for(let index=rows.length-1; index>=0; index-=7){const p=rows[index]; result.unshift([new Date(p.valid_on + 'T12:00:00').getTime(),Number(p.${field})]);} return result;`
      : `return (entity.attributes.${collection} || []).map(p => [new Date(p.valid_on + 'T12:00:00').getTime(), p.${field} == null ? null : Number(p.${field})]);`;
    const suffix = weekly ? " (echtes 7-Tage-Perzentil)" : "";
    const series = [];
    if (!graph.circular) {
      series.push(
        { entity, name: `ERA5 P90${suffix}`, type: "line", color: "#80CBC4", stroke_width: 2, stroke_dash: 3, data_generator: climate("p90", "daily_normal"), show: { legend_value: false } },
        { entity, name: `ERA5 P10${suffix}`, type: "line", color: "#80CBC4", stroke_width: 2, stroke_dash: 3, data_generator: climate("p10", "daily_normal"), show: { legend_value: false } }
      );
    }
    series.push(
      { entity, name: `${graph.circular ? "ERA5 Richtung 1991–2020" : "ERA5 P50 1991–2020"}${suffix}`, type: "line", color: "#00897B", stroke_width: 3, data_generator: climate("median", "daily_normal"), show: { legend_value: false } },
      { entity, name: `${graph.circular ? "ERA5 Richtung ab 1950" : "ERA5 P50 ab 1950"}${suffix}`, type: "line", color: "#7E57C2", stroke_width: 2, stroke_dash: 5, data_generator: climate("median", "daily_all"), show: { legend_value: false } }
    );
    if (!['90d', '365d'].includes(this._range)) {
      series.push(
        { entity: graph.source_entity, name: "Ist Minimum", color: "#29B6F6", stroke_width: 2, statistics: { type: "min", period: "day", align: "middle" }, ...(graph.source_factor ? { transform: `return x * ${Number(graph.source_factor)};` } : {}), show: { legend_value: false } },
        { entity: graph.source_entity, name: "Ist Mittel", color: "#0277BD", stroke_width: 4, statistics: { type: "mean", period: "day", align: "middle" }, ...(graph.source_factor ? { transform: `return x * ${Number(graph.source_factor)};` } : {}), show: { legend_value: false } },
        { entity: graph.source_entity, name: "Ist Maximum", color: "#F4511E", stroke_width: 2, statistics: { type: "max", period: "day", align: "middle" }, ...(graph.source_factor ? { transform: `return x * ${Number(graph.source_factor)};` } : {}), show: { legend_value: false } }
      );
    } else {
      series.push(
        { entity: graph.aggregate_source_entity || graph.source_entity,
          name: graph.aggregate_statistic === "change" ? "Ist 7-Tage-Summe" : "Ist 7-Tage-Mittel",
          color: "#0277BD", stroke_width: 4,
          statistics: { type: graph.aggregate_statistic || "mean", period: "week", align: "middle" },
          ...(graph.source_factor ? { transform: `return x * ${Number(graph.source_factor)};` } : {}),
          show: { legend_value: false } }
      );
    }
    return series;
  }

  _chart(graph) {
    if (graph.precipitation_view && ["7d", "30d"].includes(this._range)) {
      return { type: "custom:nhz-precipitation-chart", graph, range: this._range };
    }
    const today = this._range === "today";
    const spans = { "7d": "7d", "30d": "30d", "90d": "90d", "365d": "365d" };
    const config = {
      type: "custom:apexcharts-card",
      graph_span: today ? "24h" : spans[this._range],
      span: today ? { start: "day" } : { end: "day" },
      update_interval: "15min",
      header: { show: true, title: `${graph.title} – ${graph.explanation}`, show_states: false },
      now: { show: today, label: "Jetzt", color: "#00A6D6" },
      apex_config: {
        chart: { height: 330 }, stroke: { curve: "smooth" }, legend: { show: true },
        xaxis: { labels: { datetimeUTC: false } }, grid: { borderColor: "rgba(127,127,127,0.20)" },
        tooltip: { shared: true }
      },
      series: today ? this._todaySeries(graph) : this._dailySeries(graph)
    };
    if (graph.circular) config.yaxis = [{ min: 0, max: 360, decimals: 0 }];
    return config;
  }

  async _render() {
    if (!this._config) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    const root = document.createElement("div");
    root.className = "nhz-climate";
    const style = document.createElement("style");
    style.textContent = `.nhz-range{display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px;margin-bottom:12px;background:var(--ha-card-background,var(--card-background-color));border-radius:var(--ha-card-border-radius,12px);box-shadow:var(--ha-card-box-shadow)}.nhz-range button{border:1px solid var(--divider-color);border-radius:18px;padding:7px 13px;background:transparent;color:var(--primary-text-color);cursor:pointer;font:inherit}.nhz-range button.active{background:var(--primary-color);color:var(--text-primary-color);border-color:var(--primary-color)}.nhz-graphs>*{display:block;margin-bottom:12px}`;
    const toolbar = document.createElement("div");
    toolbar.className = "nhz-range";
    [["Heute","today"],["7 Tage","7d"],["30 Tage","30d"],["90 Tage","90d"],["1 Jahr","365d"]].forEach(([label, range]) => toolbar.appendChild(this._button(label, range)));
    const graphRoot = document.createElement("div");
    graphRoot.className = "nhz-graphs";
    root.append(style, toolbar, graphRoot);
    this.replaceChildren(root);
    const helpers = await window.loadCardHelpers();
    if (this._generation !== generation) return;
    this._cards = this._config.graphs.map((graph) => {
      const card = helpers.createCardElement(this._chart(graph));
      if (this._hass) card.hass = this._hass;
      graphRoot.appendChild(card);
      return card;
    });
  }
}

if (!customElements.get("nhz-climate-range-card")) customElements.define("nhz-climate-range-card", NhzClimateRangeCard);
if (!customElements.get("nhz-precipitation-chart")) customElements.define("nhz-precipitation-chart", NhzPrecipitationChart);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "nhz-climate-range-card")) {
  window.customCards.push({
    type: "nhz-climate-range-card",
    name: "NHZ Climate Range Card",
    description: "Gemeinsame Zeitraumwahl für NHZ-Klimavergleiche",
  });
}
