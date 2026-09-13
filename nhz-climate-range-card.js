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
    this.shadowRoot.innerHTML = `<ha-card><div class="message">${this._escapeText(message)}</div></ha-card><style>.message{padding:24px;color:var(--secondary-text-color)}</style>`;
  }

  _localDateKey(now, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  _shiftDate(dateKey, days) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  _timeZoneOffset(instant, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return Date.UTC(parts.year, Number(parts.month) - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime();
  }

  _localTime(dateKey, timeZone, hour = 0) {
    const guess = new Date(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`);
    let result = new Date(guess.getTime() - this._timeZoneOffset(guess, timeZone));
    result = new Date(guess.getTime() - this._timeZoneOffset(result, timeZone));
    return result;
  }

  _rangeStart(now, timeZone) {
    const days = this._config.range === "7d" ? 7 : 30;
    return this._localTime(this._shiftDate(this._localDateKey(now, timeZone), -(days - 1)), timeZone);
  }

  _number(value) {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  _time(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return value < 100000000000 ? value * 1000 : value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
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
      const value = this._number(row[valueField]);
      const time = this._time(row[timeField]);
      if (value == null || time == null) continue;
      total += Math.max(0, value);
      result.push([time, total]);
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

  _monthlyData(profile, graph) {
    const entityId = graph.monthly_comparison_entity || graph.monthly_entity;
    const monthlyEntity = entityId && this._hass.states[entityId];
    const attributes = monthlyEntity?.attributes || profile.attributes || {};
    const configured = graph.monthly_attribute;
    const candidates = [
      configured && attributes[configured],
      attributes.monthly_comparisons?.[this._config.range],
      attributes.monthly_comparison,
      attributes.monthly_precipitation,
      attributes.precipitation_monthly,
      attributes.monthly,
    ];
    const payload = candidates.find(value => value && (Array.isArray(value) || Array.isArray(value.months)));
    if (!payload) return null;
    const rows = Array.isArray(payload) ? payload : payload.months;
    const pick = (object, names) => {
      for (const name of names) {
        const value = this._number(object?.[name]);
        if (value != null) return value;
      }
      return null;
    };
    const normalized = rows.map((row) => {
      const reference = row.reference || row.climatology || row.normal || {};
      const actualData = (row.actual && typeof row.actual === "object" ? row.actual : null)
        || row.modelled_actual || row.local_actual || {};
      const rawActual = pick(actualData, ["sum_mm", "sum", "actual_mm", "actual", "value_mm", "value"])
        ?? pick(row, ["actual_mm", "actual", "value_mm", "value"]);
      const coverage = pick(actualData, ["coverage", "coverage_ratio", "coverage_percent"])
        ?? pick(row, ["coverage", "coverage_ratio", "coverage_percent"]);
      const complete = coverage == null || coverage >= (coverage <= 1 ? 0.999999 : 99.9999);
      const p10 = pick(reference, ["p10_mm", "p10"])
        ?? pick(row, ["p10_mm", "p10"]);
      const p90 = pick(reference, ["p90_mm", "p90"])
        ?? pick(row, ["p90_mm", "p90"]);
      const mean = pick(reference, ["mean_mm", "mean", "p50_mm", "p50", "median_mm", "median"])
        ?? pick(row, ["mean_mm", "mean", "p50_mm", "p50", "median_mm", "median"]);
      const month = row.month || row.local_start || row.month_start || row.period || row.label;
      return {
        month: typeof month === "string" ? month : "",
        actual: complete ? rawActual : null, p10, p90, mean,
        partial: Boolean(row.partial ?? row.is_partial ?? row.current_partial),
        start: row.local_start || row.start || "",
        end: row.local_end || row.end || "",
        coverage,
        incomplete: !complete,
        source: actualData.source_class || row.actual_source || row.provenance || row.source || "",
        provisional: Boolean(actualData.provisional ?? row.provisional),
      };
    }).filter(row => row.month && (row.actual != null || row.mean != null || row.p10 != null || row.p90 != null));
    return {
      months: normalized,
      total: Array.isArray(payload) ? null : (payload.total || payload.rolling_365 || payload.summary || payload.overall || null),
      daily: Array.isArray(payload) ? null : (payload.daily || payload.days || null),
      asOf: Array.isArray(payload) ? null : (payload.as_of_utc || payload.through_utc || payload.as_of),
      timeZone: Array.isArray(payload) ? null : (payload.site_timezone || attributes.site_timezone || attributes.timezone),
      source: Array.isArray(payload) ? "" : (payload.actual_source || payload.provenance || ""),
    };
  }

  _format(value, digits = 0) {
    return value == null ? "–" : `${value.toFixed(digits)} mm`;
  }

  _escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
  }

  _monthLabel(value) {
    const match = /^(\d{4})-(\d{2})/.exec(value);
    if (!match) return value;
    return new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" })
      .format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
  }

  _coverageLabel(value) {
    if (value == null) return "";
    const percent = value <= 1 ? value * 100 : value;
    return `Abdeckung ${percent.toFixed(0)} %`;
  }

  _monthlyRows(data) {
    // API/HA has already selected the exact local-day interval. Keeping all its
    // rows preserves the required 4 (90d) or 13 (365d) partial-month layout.
    return [...data.months].sort((left, right) => String(left.start || left.month).localeCompare(String(right.start || right.month)));
  }

  _monthlySummary(data) {
    const total = data.total;
    if (!total) return "";
    const actualData = (total.actual && typeof total.actual === "object" ? total.actual : null)
      || total.modelled_actual || total.local_actual || total;
    const rawActual = this._number(actualData.sum_mm ?? actualData.sum ?? actualData.actual_mm ?? actualData.actual ?? actualData.value_mm ?? actualData.value);
    const coverage = this._number(actualData.coverage_ratio ?? actualData.coverage);
    const complete = coverage == null || coverage >= (coverage <= 1 ? 0.999999 : 99.9999);
    const actual = complete ? rawActual : null;
    const reference = total.reference || total.climatology || total.normal || {};
    const mean = this._number(reference.mean_mm ?? reference.mean ?? reference.p50_mm ?? reference.p50 ?? total.mean_mm ?? total.mean);
    const delta = actual != null && mean != null ? actual - mean : null;
    if (actual == null && mean == null) return "";
    const label = this._config.range === "365d" ? "Rollierende 365 Tage" : "Gesamt im gewählten Zeitraum";
    return `<div class="rolling"><span>${label}</span><strong>${this._format(actual)}</strong><small>Ø ${this._format(mean)}${delta == null ? "" : ` · Δ ${delta >= 0 ? "+" : "−"}${this._format(Math.abs(delta))}`}</small></div>`;
  }

  _monthlyView(graph, profile, now) {
    const data = this._monthlyData(profile, graph);
    if (!data) {
      this._renderMessage("Monatlicher Niederschlagsvergleich ist noch nicht verfügbar.");
      return;
    }
    const rows = this._monthlyRows(data);
    if (!rows.length) {
      this._renderMessage("Für den gewählten Zeitraum liegen noch keine Monatswerte vor.");
      return;
    }
    const source = data.source || rows.find(row => row.source)?.source;
    const scaleMax = Math.max(1, ...rows.flatMap(row => [row.p10, row.p90, row.mean, row.actual].filter(value => value != null))) * 1.08;
    const body = rows.map((row) => {
      const delta = row.actual != null && row.mean != null ? row.actual - row.mean : null;
      const position = value => value == null ? null : Math.min(100, Math.max(0, value / scaleMax * 100));
      const p10 = position(row.p10), p90 = position(row.p90), mean = position(row.mean), actual = position(row.actual);
      const band = p10 != null && p90 != null
        ? `<span class="band" style="left:${Math.min(p10,p90)}%;width:${Math.abs(p90-p10)}%"></span>` : "";
      const meanMark = mean != null ? `<span class="mean" style="left:${mean}%"></span>` : "";
      const offBand = row.actual != null && row.p10 != null && row.p90 != null && (row.actual < row.p10 || row.actual > row.p90);
      const actualMark = actual != null ? `<span class="actual${offBand ? " off-band" : ""}" style="left:${actual}%"></span>` : "";
      const flags = [row.partial ? `${row.start || row.month} bis ${row.end || "laufend"}` : "", row.incomplete ? "IST-Lücke" : "", row.provisional ? "vorläufig" : "", this._coverageLabel(row.coverage), row.source].filter(Boolean).join(" · ");
      return `<div class="month-row">
        <div class="month-name">${this._escapeText(this._monthLabel(row.month))}<small>${this._escapeText(flags)}</small></div>
        <div class="track" aria-label="P10 bis P90, Mittelwert und Istwert">${band}${meanMark}${actualMark}</div>
        <div class="month-values"><strong>${this._format(row.actual)}</strong><span>P10–P90 ${this._format(row.p10)}–${this._format(row.p90)} · Ø ${this._format(row.mean)}${delta == null ? "" : ` · Δ ${delta >= 0 ? "+" : "−"}${this._format(Math.abs(delta))}`}</span></div>
      </div>`;
    }).join("");
    this.shadowRoot.innerHTML = `<ha-card><div class="content monthly">
      <h2>${this._escapeText(graph.title)} – ${this._escapeText(graph.explanation)}</h2>
      ${this._monthlySummary(data)}
      <div class="monthly-legend"><span><i class="band-key"></i>P10–P90</span><span><i class="mean-key"></i>Mittelwert</span><span><i class="actual-key"></i>IST</span></div>
      <div class="scale"><span>0 mm</span><span>Gemeinsame Skala bis ${this._format(scaleMax)}</span></div>
      <div class="month-list">${body}</div>
      ${source ? `<div class="provenance">IST-Quelle: ${this._escapeText(source)}</div>` : ""}
    </div></ha-card><style>${this._styles()}</style>`;
  }

  _comparisonDailyRows(data, timeZone) {
    if (!Array.isArray(data?.daily)) return null;
    const value = (point, names) => {
      for (const name of names) {
        const parsed = this._number(point?.[name]);
        if (parsed != null) return parsed;
      }
      return null;
    };
    const rows = data.daily.map((point) => {
      const actual = point.actual || point.modelled_actual || {};
      const reference = point.reference || point.climatology || point.normal || {};
      const key = point.valid_on || point.local_date || point.date;
      const time = this._time(point.time || point.start || point.local_start || point.range_start_utc)
        ?? (typeof key === "string" ? this._localTime(key.slice(0, 10), timeZone, 12).getTime() : null);
      return {
        time,
        actual: value(actual, ["sum_mm", "sum", "value_mm", "value"]),
        expected: value(reference, ["mean_mm", "mean", "p50_mm", "p50"]),
      };
    }).filter(row => row.time != null && (row.actual != null || row.expected != null));
    return rows.length ? rows : null;
  }

  _styles() {
    return `.content{padding:18px 20px 16px;color:var(--primary-text-color)}h2{font-size:20px;margin:0 0 16px;color:var(--secondary-text-color)}
      .difference{font-size:30px;font-weight:650;line-height:1.15}.subtitle{font-size:16px;font-weight:600;color:var(--secondary-text-color);margin:6px 0 16px}
      .totals{display:flex;justify-content:space-between;gap:18px;margin:4px 4% 2px}.totals div{display:flex;flex-direction:column}.totals div:last-child{text-align:right}.totals strong{font-size:30px}.totals span{color:var(--secondary-text-color);font-size:13px}
      svg{width:100%;display:block;overflow:visible}.grid{stroke:var(--divider-color);stroke-width:1}.axis,.date,.month{fill:var(--secondary-text-color);font-size:12px;font-weight:600}
      .actual{fill:none;stroke:#25C7F4;stroke-width:6;stroke-linejoin:round;stroke-linecap:round}.expected{fill:none;stroke:#8D93A6;stroke-width:5;stroke-dasharray:12 10;stroke-linecap:round}
      .actual-dot{fill:#25C7F4;stroke:var(--card-background-color);stroke-width:3}.expected-dot{fill:#8D93A6;stroke:var(--card-background-color);stroke-width:3}
      .legend{display:flex;gap:24px;justify-content:center;flex-wrap:wrap;color:var(--secondary-text-color);font-size:14px}.legend span,.monthly-legend span{display:flex;align-items:center;gap:8px}.legend i,.monthly-legend i{width:12px;height:12px;border-radius:50%}.actual-key{background:#25C7F4}.expected-key{background:#8D93A6}
      .monthly h2{margin-bottom:10px}.monthly-legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--secondary-text-color);font-size:13px;margin:0 0 7px}.band-key{background:#80CBC4;border-radius:3px!important;width:18px!important}.mean-key{background:#fff;border:1px solid #52606D}.month-list{display:grid;gap:12px}.month-row{display:grid;grid-template-columns:82px minmax(80px,1fr) 245px;gap:12px;align-items:center}.month-name{font-weight:650;text-transform:capitalize}.month-name small,.month-values span,.provenance,.rolling small{display:block;color:var(--secondary-text-color);font-size:12px;font-weight:400;margin-top:2px}.scale{display:grid;grid-template-columns:82px minmax(80px,1fr) 245px;gap:12px;color:var(--secondary-text-color);font-size:11px;margin-bottom:4px}.scale span:nth-child(2){text-align:right}.track{height:12px;position:relative;background:color-mix(in srgb,var(--divider-color) 55%,transparent);border-radius:8px}.track .band{position:absolute;top:1px;height:10px;border-radius:7px;background:#80CBC4}.track .mean{position:absolute;top:-3px;width:3px;height:18px;background:#fff;box-shadow:0 0 0 1px #52606D;border-radius:2px;transform:translateX(-50%)}.track .actual{position:absolute;top:-3px;width:18px;height:18px;border-radius:50%;background:#25C7F4;border:3px solid var(--card-background-color);transform:translateX(-50%)}.track .actual.off-band{background:#FFB300;box-shadow:0 0 0 2px #7A4A00}.month-values{text-align:right}.month-values strong{display:block;font-size:16px}.rolling{display:grid;grid-template-columns:1fr auto;gap:0 12px;align-items:baseline;border:1px solid var(--divider-color);border-radius:9px;padding:9px 11px;margin-bottom:12px}.rolling strong{font-size:20px}.rolling small{grid-column:1 / -1}.provenance{margin-top:14px}
      @media(max-width:600px){.difference{font-size:23px}.totals strong{font-size:25px}.content{padding:16px 12px}.axis{font-size:11px}.month-row{grid-template-columns:68px 1fr}.month-values{grid-column:2;text-align:left}.month-values span{white-space:normal}.monthly-legend{gap:10px}.scale{grid-template-columns:68px 1fr}.scale span:nth-child(2){grid-column:2;text-align:right}}`;
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
    if (["90d", "365d"].includes(this._config.range)) {
      this._monthlyView(graph, profile, now);
      return;
    }
    const preliminaryComparison = this._monthlyData(profile, graph);
    const timeZone = preliminaryComparison?.timeZone || profile.attributes.site_timezone || profile.attributes.timezone || graph.site_timezone || "UTC";
    const start = this._rangeStart(now, timeZone);
    try {
      const comparison = preliminaryComparison;
      const comparisonRows = this._comparisonDailyRows(comparison, timeZone);
      if (!graph.aggregate_source_entity && !comparisonRows) {
        this._renderMessage("Kumulierte Niederschlagsdaten sind für diesen Zeitraum noch nicht verfügbar.");
        return;
      }
      const statistics = graph.aggregate_source_entity && !comparisonRows
        ? await this._statistics(graph.aggregate_source_entity, start, now, "day") : [];
      if (this._generation !== generation) return;
      const actualRows = comparisonRows
        ? comparisonRows.map(point => ({ time: point.time, value: point.actual }))
        : statistics.map(point => ({ time: point.start, value: point.change }));
      const actual = this._cumulative(actualRows, "time", "value", start.getTime());
      const startKey = this._localDateKey(start, timeZone);
      const endKey = this._localDateKey(now, timeZone);
      const climateRows = comparisonRows
        ? comparisonRows.map(point => ({ time: point.time, value: point.expected }))
        : (profile.attributes.daily_normal || [])
        .filter(point => point.valid_on >= startKey && point.valid_on <= endKey)
        .map(point => ({ time: this._localTime(point.valid_on, timeZone, 12).getTime(), value: point.mean }));
      const expected = this._cumulative(climateRows, "time", "value", start.getTime());
      const total = comparison?.total;
      const totalActual = total?.actual || total?.modelled_actual;
      const coverage = this._number(totalActual?.coverage_ratio);
      if (comparisonRows && coverage != null && coverage < 0.999999) {
        this._renderMessage(`Der Ist-Verlauf ist nur zu ${(coverage * 100).toFixed(0)} % abgedeckt; keine vollständige Summe verfügbar.`);
        return;
      }
      const totalReference = total?.reference || total?.climatology || total?.normal || {};
      const serverExpected = this._number(totalReference.mean_mm ?? totalReference.mean ?? totalReference.p50_mm ?? totalReference.p50);
      const actualTotal = actual.at(-1)?.[1] || 0, expectedTotal = serverExpected ?? expected.at(-1)?.[1] ?? 0;
      actual.push([now.getTime(), actualTotal]);
      if (serverExpected != null) expected.push([now.getTime(), expectedTotal]);
      else expected.push([now.getTime(), expectedTotal]);
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
        <h2>${this._escapeText(graph.title)} – ${this._escapeText(graph.explanation)}</h2>
        <div class="difference">${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(0)} mm ${direction} dem Durchschnitt</div>
        <div class="subtitle">${this._config.range === "7d" ? "7" : "30"}-Tage-Durchschnitt: ${expected.toFixed(0)} mm</div>
        <div class="totals"><div><strong>${expected.toFixed(0)} mm</strong><span>Durchschnitt</span></div><div><strong>${actual.toFixed(0)} mm</strong><span>Letzte ${this._config.range === "7d" ? "7" : "30"} Tage</span></div></div>
        ${chart}
        <div class="legend"><span><i class="actual-key"></i>Letzte ${this._config.range === "7d" ? "7" : "30"} Tage</span><span><i class="expected-key"></i>Durchschnitt</span></div>
      </div>
    </ha-card><style>${this._styles()}</style>`;
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
    const monthlyComparison = graph.monthly_comparison_entity || graph.monthly_entity;
    if (monthlyComparison && this._range === "today") {
      return {
        type: "markdown",
        content: `**${graph.title}:** Der Klimavergleich beginnt bei 7 Tagen. Der heutige Verlauf gehört zur operativen Wettervorhersage.`,
      };
    }
    if ((graph.precipitation_view || monthlyComparison) && ["90d", "365d"].includes(this._range)) {
      return { type: "custom:nhz-precipitation-chart", graph, range: this._range };
    }
    if ((graph.precipitation_view || monthlyComparison) && ["7d", "30d"].includes(this._range)) {
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
