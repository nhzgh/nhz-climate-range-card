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
    const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[this._config.range] || 30;
    return this._localTime(this._shiftDate(this._localDateKey(now, timeZone), -(days - 1)), timeZone);
  }

  _rangeLabel() {
    return { "7d": "7 Tage", "30d": "30 Tage", "90d": "90 Tage", "365d": "365 Tage" }[this._config.range] || "Zeitraum";
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

  _bandPath(lower, upper, x, y) {
    if (!lower.length || !upper.length) return "";
    const top = upper.map(([time, value]) => `${x(time)} ${y(value)}`).join(" L ");
    const bottom = [...lower].reverse().map(([time, value]) => `${x(time)} ${y(value)}`).join(" L ");
    return `M ${top} L ${bottom} Z`;
  }

  _lineChart(actual, expected, start, end, actualTotal, expectedTotal, p10 = [], p90 = []) {
    const width = 760, height = 300, left = 48, right = 18, top = 18, bottom = 38;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    const maximum = Math.max(1, actualTotal, expectedTotal, ...p10.map(point => point[1]), ...p90.map(point => point[1])) * 1.12;
    const x = value => left + ((value - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * innerWidth;
    const y = value => top + innerHeight - (value / maximum) * innerHeight;
    const grid = [0, .25, .5, .75, 1].map(fraction => {
      const value = maximum * fraction;
      return `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" class="grid"/><text x="${width-right-3}" y="${y(value)-5}" text-anchor="end" class="axis">${Math.round(value)} ${this._escapeText(this._activeUnit || "mm")}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Kumulativer Niederschlag">
      ${grid}
      ${p10.length && p90.length ? `<path d="${this._bandPath(p10, p90, x, y)}" class="expected-band"/>` : ""}
      <path d="${this._path(expected, x, y)}" class="expected"/>
      <path d="${this._path(actual, x, y, true)}" class="actual"/>
      <circle cx="${x(end.getTime())}" cy="${y(expectedTotal)}" r="6" class="expected-dot"/>
      <circle cx="${x(end.getTime())}" cy="${y(actualTotal)}" r="6" class="actual-dot"/>
      <text x="${left}" y="${height-10}" class="date">Vor ${this._rangeLabel()}</text>
      <text x="${width-right}" y="${height-10}" text-anchor="end" class="date">Heute</text>
    </svg>`;
  }

  _todayForecastChart(graph, profile, now) {
    const attributes = profile.attributes || {};
    const regionalPoints = (attributes.hourly_forecast || []).filter(point => point.forecast_source === "hetzner_regional");
    const forecastPoints = regionalPoints.length ? regionalPoints : (attributes.hourly_forecast || []);
    const points = forecastPoints.map(point => ({
      time: this._time(point.datetime), value: this._number(point.precipitation),
    })).filter(point => point.time != null && point.value != null);
    const comparisons = this._comparisonForecasts(attributes);
    if (comparisons.length && points.length) {
      const windows = [...new Map(comparisons.flatMap(item => item.points)
        .map(point => [`${point.time}:${point.end}`, { time: point.time, end: point.end }])).values()];
      const iconPoints = windows.map(window => {
        const values = points.filter(point => point.time >= window.time && point.time < window.end);
        return values.length ? { ...window, value: values.reduce((sum, point) => sum + point.value, 0) } : null;
      }).filter(Boolean);
      if (iconPoints.length) comparisons.unshift({ points: iconPoints, color: "#25C7F4", label: "ICON 6 h" });
    }
    const actualPayload = attributes.local_hourly_actual || {};
    const actual = (actualPayload.hourly || []).map(point => ({
      time: this._time(point.start), value: this._number(point.value),
    })).filter(point => point.time != null && point.value != null);
    const timeZone = attributes.site_timezone || attributes.timezone || graph.site_timezone || "UTC";
    const start = this._localTime(this._localDateKey(now, timeZone), timeZone, 0);
    const end = this._localTime(this._shiftDate(this._localDateKey(now, timeZone), 1), timeZone, 0);
    const width = 760, height = 300, left = 48, right = 18, top = 18, bottom = 38;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    // Keep the primary chart's scale exclusively on hourly ICON/IST values.
    // IFS values are six-hour interval sums and are rendered below on their
    // own scale; mixing them here would be dimensionally misleading.
    const max = Math.max(1, ...points.map(point => point.value), ...actual.map(point => point.value)) * 1.2;
    const x = value => left + ((value - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * innerWidth;
    const y = value => top + innerHeight - (value / max) * innerHeight;
    const grid = [0, .25, .5, .75, 1].map(fraction => {
      const value = max * fraction;
      return `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" class="grid"/><text x="${width-right-3}" y="${y(value)-5}" text-anchor="end" class="axis">${value.toFixed(1)} mm</text>`;
    }).join("");
    const barWidth = Math.max(3, innerWidth / 25);
    const bars = points.filter(point => point.time >= start.getTime() && point.time < end.getTime()).map(point =>
      `<rect x="${x(point.time) - barWidth / 2}" y="${y(point.value)}" width="${barWidth}" height="${Math.max(1, y(0) - y(point.value))}" class="forecast-bar"><title>${new Date(point.time).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}: ${point.value.toFixed(1)} mm</title></rect>`
    ).join("");
    const actualPoints = actual.filter(point => point.time >= start.getTime() && point.time <= end.getTime());
    const actualPath = this._path(actualPoints.map(point => [point.time, point.value]), x, y);
    const probabilities = (attributes.forecast_probability_6h || []).filter(point => {
      const blockStart = this._time(point.block_start);
      return point.probability != null && blockStart != null
        && blockStart >= start.getTime() && blockStart < end.getTime();
    }).map(point => {
      const label = `${Math.round(Number(point.probability) * 100)} %`;
      return `<text x="${x(this._time(point.block_start))}" y="${height - 12}" class="probability" text-anchor="middle"><title>${this._escapeText(point.local_start_hour + "–" + ((point.local_start_hour + 6) % 24) + " Uhr, Ereignis ≥ 0,5 mm")}</title>${label}</text>`;
    }).join("");
    const comparisonStart = comparisons.length ? new Date(Math.min(...comparisons.flatMap(item => item.points.map(point => point.time)))) : start;
    const comparisonEnd = comparisons.length ? new Date(Math.max(...comparisons.flatMap(item => item.points.map(point => point.end)))) : end;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Niederschlag heute: Prognose als Stundenbalken, IST als Linie">
      ${grid}${bars}<path d="${actualPath}" class="actual"/><line x1="${x(now.getTime())}" y1="${top}" x2="${x(now.getTime())}" y2="${height-bottom}" class="now"/>${probabilities}
      <text x="${left}" y="${height-10}" class="date">00 Uhr</text><text x="${width-right}" y="${height-10}" text-anchor="end" class="date">24 Uhr</text>
    </svg>${this._comparisonChart(comparisons, comparisonStart, comparisonEnd)}`;
  }

  _comparisonChart(comparisons, start, end) {
    const items = comparisons.map(item => ({ ...item, points: item.points.filter(point => point.time >= start.getTime() && point.time < end.getTime()) })).filter(item => item.points.length);
    if (!items.length) return "";
    const width = 760, height = 142, left = 48, right = 18, top = 22, bottom = 28;
    const innerHeight = height - top - bottom;
    const x = value => left + ((value - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * (width - left - right);
    const max = Math.max(1, ...items.flatMap(item => item.points.map(point => point.value))) * 1.15;
    const y = value => top + innerHeight - (value / max) * innerHeight;
    const grid = [0, .5, 1].map(fraction => {
      const value = max * fraction;
      return `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" class="grid"/><text x="${width-right-3}" y="${y(value)-3}" text-anchor="end" class="axis">${value.toFixed(1)} mm</text>`;
    }).join("");
    const bars = items.flatMap((item, itemIndex) => item.points.map(point => {
      const endTime = point.end || point.time + 6 * 3600 * 1000;
      const intervalWidth = Math.max(6, x(Math.min(endTime, end.getTime())) - x(point.time));
      const barWidth = Math.max(4, intervalWidth / items.length * .72);
      const center = x(point.time) + intervalWidth * (itemIndex + .5) / items.length;
      const spread = point.p10 != null && point.p90 != null ? ` · P10–P90 ${point.p10.toFixed(1)}–${point.p90.toFixed(1)} mm` : "";
      const probability = point.probability != null ? ` · ≥0,5 mm ${Math.round(point.probability * 100)} %` : "";
      return `<rect x="${center - barWidth / 2}" y="${y(point.value)}" width="${barWidth}" height="${Math.max(1, y(0) - y(point.value))}" fill="${item.color}" class="comparison-bar"><title>${this._escapeText(item.label)}: ${point.value.toFixed(1)} mm, 6 h${spread}${probability}</title></rect>`;
    })).join("");
    const labels = items.map(item => `<span><i class="comparison-key" style="background:${item.color}"></i>${this._escapeText(item.label)}</span>`).join("");
    const label = value => new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(value);
    return `<div class="comparison-panel"><div class="comparison-title">6‑Stunden-Modellvergleich · 0–72 h · Intervallsumme</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sechs-Stunden-Niederschlagsvergleich">${grid}${bars}<text x="${left}" y="${height-8}" class="date">${label(start)}</text><text x="${width-right}" y="${height-8}" text-anchor="end" class="date">${label(end)}</text></svg><div class="comparison-legend">${labels}</div></div>`;
  }

  _comparisonForecasts(attributes) {
    const raw = attributes.forecast_comparisons || attributes.forecast_comparison || attributes.comparison_forecasts || [];
    const items = Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([model, value]) => ({ model, ...(value || {}) }));
    const colors = ["#7E57C2", "#00897B", "#F4511E"];
    const grouped = new Map();
    for (const item of items) {
      const model = item.model || item.model_key || item.provider_model || "Vergleichsmodell";
      if (!grouped.has(model)) grouped.set(model, []);
      grouped.get(model).push(item);
    }
    return [...grouped.entries()].map(([model, rows], index) => {
      const nested = rows.flatMap(item => Array.isArray(item.points) ? item.points : Array.isArray(item.values) ? item.values : [item]);
      const points = nested
        .map(point => ({
          time: this._time(point.block_start || point.valid_from || point.valid_at || point.datetime || point.time),
          end: this._time(point.block_end || point.valid_to),
          value: this._number(point.p50_mm ?? point.precipitation ?? point.sum_mm ?? point.amount_mm ?? point.value),
          p10: this._number(point.p10_mm ?? point.p10),
          p90: this._number(point.p90_mm ?? point.p90),
          probability: this._number(point.probability_ge_0_5 ?? point.probability),
        }))
        .filter(point => point.time != null && point.value != null)
        .map(point => ({ ...point, end: point.end || point.time + 6 * 3600 * 1000 }));
      const horizon = rows[0]?.horizon || rows[0]?.lead_time || "0–72 h";
      return { points, color: colors[index % colors.length], label: `${model} Vergleich (${horizon})` };
    }).filter(item => item.points.length);
  }

  _planningSummary(attributes) {
    const raw = attributes.forecast_planning || attributes.planning_forecast || attributes.planning;
    if (!raw || typeof raw !== "object") return "";
    const entries = Array.isArray(raw) ? raw.map(item => [item.model || item.model_key || "Forecast", item]) : Object.entries(raw);
    const rows = [];
    for (const [model, payload] of entries) {
      const windows = Array.isArray(payload?.windows) ? payload.windows : Array.isArray(payload) ? payload
        : [payload?.next_24h, payload?.next_48h].filter(Boolean);
      for (const hours of [24, 48]) {
        const row = windows.find(item => Number(item.hours ?? item.horizon_hours ?? item.window_hours) === hours);
        if (!row) continue;
        const p10 = this._number(row.p10_mm ?? row.p10);
        const p50 = this._number(row.p50_mm ?? row.p50 ?? row.median_mm);
        const p90 = this._number(row.p90_mm ?? row.p90);
        const dry = this._number(row.dry_probability ?? row.dry_probability_percent);
        const dryText = dry == null ? "" : ` · trocken ${Math.round(dry <= 1 ? dry * 100 : dry)} %`;
        const values = p10 != null && p90 != null ? `P10–P90 ${p10.toFixed(1)}–${p90.toFixed(1)} mm` : p50 != null ? `P50 ${p50.toFixed(1)} mm` : "Wert nicht verfügbar";
        rows.push(`<span>${this._escapeText(model)} ${hours} h: ${values}${dryText}</span>`);
      }
    }
    return rows.length ? `<div class="planning"><strong>Planung</strong>${rows.join("")}</div>` : "";
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
      cumulativeDaily: Array.isArray(payload) ? null : (payload.cumulative_daily || payload.cumulative?.daily || null),
      asOf: Array.isArray(payload) ? null : (payload.as_of_utc || payload.through_utc || payload.as_of),
      timeZone: Array.isArray(payload) ? null : (payload.site_timezone || attributes.site_timezone || attributes.timezone),
      source: Array.isArray(payload) ? "" : (payload.actual_source || payload.provenance || ""),
      unit: Array.isArray(payload) ? (monthlyEntity?.attributes?.unit_of_measurement || "mm")
        : (payload.unit || monthlyEntity?.attributes?.unit_of_measurement || "mm"),
    };
  }

  _format(value, digits = 0) {
    return value == null ? "–" : `${value.toFixed(digits)} ${this._activeUnit || "mm"}`;
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
    this._activeUnit = data.unit || "mm";
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
      const flags = [row.partial ? `${row.start || row.month} bis ${row.end || "laufend"}` : "", row.incomplete ? "IST-Lücke" : "", row.provisional ? "vorläufig" : ""].filter(Boolean).join(" · ");
      const compact = `IST ${this._format(row.actual)} / Ø ${this._format(row.mean)}${delta == null ? "" : ` / Δ ${delta >= 0 ? "+" : "−"}${this._format(Math.abs(delta))}`}`;
      const mouseover = [
        `P10 ${this._format(row.p10)}`,
        `P90 ${this._format(row.p90)}`,
        `Mittelwert ${this._format(row.mean)}`,
        `IST ${this._format(row.actual)}`,
        this._coverageLabel(row.coverage),
        row.source ? `Quelle: ${row.source}` : "",
      ].filter(Boolean).join(" · ");
      return `<div class="month-row">
        <div class="month-header"><span class="month-name">${this._escapeText(this._monthLabel(row.month))} <small>(${this._escapeText(compact)})</small></span>${flags ? `<small class="month-flags">${this._escapeText(flags)}</small>` : ""}</div>
        <div class="track" title="${this._escapeText(mouseover)}" aria-label="${this._escapeText(mouseover)}">${band}${meanMark}${actualMark}</div>
      </div>`;
    }).join("");
    this.shadowRoot.innerHTML = `<ha-card><div class="content monthly">
      <h2>${this._escapeText(graph.title)} – ${this._escapeText(graph.explanation)}</h2>
      ${this._monthlySummary(data)}
      <div class="monthly-legend"><span><i class="band-key"></i>P10–P90</span><span><i class="mean-key"></i>Mittelwert</span><span><i class="actual-key"></i>IST</span></div>
      <div class="scale"><span>0 ${this._escapeText(this._activeUnit || "mm")}</span><span>Gemeinsame Skala bis ${this._format(scaleMax)}</span></div>
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

  _comparisonCumulativeRows(data, timeZone) {
    // HA publishes 7/30/90-day cumulative rows under `daily` with compact
    // keys so a 90-day P10/P50/P90 band remains below the state-attribute
    // size limit.  The verbose API contract remains supported for direct
    // previews and older entities.
    const payload = data?.cumulativeDaily || data?.daily;
    const points = Array.isArray(payload) ? payload : (payload?.days || payload?.points);
    if (!Array.isArray(points)) return null;
    const value = (point, names) => {
      for (const name of names) {
        const parsed = this._number(point?.[name]);
        if (parsed != null) return parsed;
      }
      return null;
    };
    const rows = points.map((point) => {
      const actual = point.actual || point.modelled_actual || {};
      const reference = point.reference || point.climatology || point.normal || {};
      const key = point.d || point.valid_on || point.local_date || point.date;
      const time = this._time(point.time || point.start || point.local_start || point.range_start_utc)
        ?? (typeof key === "string" ? this._localTime(key.slice(0, 10), timeZone, 12).getTime() : null);
      return {
        time,
        actual: value(actual, ["cumulative_mm", "cumulative", "sum_mm", "sum", "value_mm", "value"])
          ?? value(point, ["a", "actual_cumulative_mm", "actual_cumulative", "actual_mm", "actual"]),
        p10: value(reference, ["cumulative_p10_mm", "p10_mm", "p10"])
          ?? value(point, ["l", "p10_cumulative_mm", "p10_mm", "p10"]),
        mean: value(reference, ["cumulative_mean_mm", "mean_mm", "mean", "p50_mm", "p50"])
          ?? value(point, ["m", "q", "mean_cumulative_mm", "mean_mm", "mean", "p50_mm", "p50"]),
        p90: value(reference, ["cumulative_p90_mm", "p90_mm", "p90"])
          ?? value(point, ["h", "p90_cumulative_mm", "p90_mm", "p90"]),
      };
    }).filter(row => row.time != null && (row.actual != null || row.mean != null || row.p10 != null || row.p90 != null));
    return rows.length ? rows : null;
  }

  _styles() {
    return `.content{padding:18px 20px 16px;color:var(--primary-text-color)}h2{font-size:20px;margin:0 0 16px;color:var(--secondary-text-color)}
      .difference{font-size:30px;font-weight:650;line-height:1.15}.subtitle{font-size:16px;font-weight:600;color:var(--secondary-text-color);margin:6px 0 16px}
      .totals{display:flex;justify-content:space-between;gap:18px;margin:4px 4% 2px}.totals div{display:flex;flex-direction:column}.totals div:last-child{text-align:right}.totals strong{font-size:30px}.totals span{color:var(--secondary-text-color);font-size:13px}
      svg{width:100%;display:block;overflow:visible}.grid{stroke:var(--divider-color);stroke-width:1}.axis,.date,.month{fill:var(--secondary-text-color);font-size:12px;font-weight:600}
      .actual{fill:none;stroke:#25C7F4;stroke-width:6;stroke-linejoin:round;stroke-linecap:round}.expected{fill:none;stroke:#8D93A6;stroke-width:5;stroke-dasharray:12 10;stroke-linecap:round}.expected-band{fill:rgba(128,203,196,.28);stroke:none}.comparison-panel{margin-top:5px;border-top:1px solid var(--divider-color);padding-top:7px}.comparison-title{font-size:13px;font-weight:650;color:var(--secondary-text-color);margin:0 0 2px 48px}.comparison-bar{opacity:.82}.comparison-legend{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;color:var(--secondary-text-color);font-size:12px}.comparison-legend span{display:flex;align-items:center;gap:6px}
      .actual-dot{fill:#25C7F4;stroke:var(--card-background-color);stroke-width:3}.expected-dot{fill:#8D93A6;stroke:var(--card-background-color);stroke-width:3}.forecast-bar{fill:#25C7F4;opacity:.78}.now{stroke:#00A6D6;stroke-width:2;stroke-dasharray:5 4}.probability{fill:var(--secondary-text-color);font-size:11px}
      .legend{display:flex;gap:24px;justify-content:center;flex-wrap:wrap;color:var(--secondary-text-color);font-size:14px}.legend span,.monthly-legend span{display:flex;align-items:center;gap:8px}.legend i,.monthly-legend i{width:12px;height:12px;border-radius:50%}.actual-key{background:#25C7F4}.expected-key{background:#8D93A6}.forecast-key{background:#25C7F4;border-radius:2px!important}.comparison-key{border-radius:0!important}.planning{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:10px;color:var(--secondary-text-color);font-size:13px}.planning strong{color:var(--primary-text-color)}
      .monthly h2{margin-bottom:10px}.monthly-legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--secondary-text-color);font-size:13px;margin:0 0 7px}.band-key{background:#80CBC4;border-radius:3px!important;width:18px!important}.mean-key{background:#fff;border:1px solid #52606D}.month-list{display:grid;gap:13px}.month-row{display:grid;gap:5px}.month-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}.month-name{font-weight:650;text-transform:capitalize;min-width:0}.month-name small,.month-flags,.provenance,.rolling small{color:var(--secondary-text-color);font-size:12px;font-weight:400}.month-flags{text-align:right}.scale{display:flex;justify-content:space-between;gap:12px;color:var(--secondary-text-color);font-size:11px;margin-bottom:4px}.track{height:14px;position:relative;background:rgba(82,126,151,.20);border:1px solid rgba(128,203,196,.25);border-radius:8px}.track .band{position:absolute;top:1px;height:10px;border-radius:7px;background:linear-gradient(90deg,#548a94,#80CBC4)}.track .mean{position:absolute;top:-3px;width:3px;height:20px;background:#fff;box-shadow:0 0 0 1px #52606D;border-radius:2px;transform:translateX(-50%)}.track .actual{position:absolute;top:-3px;width:18px;height:18px;border-radius:50%;background:#25C7F4;border:3px solid var(--card-background-color);transform:translateX(-50%)}.track .actual.off-band{background:#FFB300;box-shadow:0 0 0 2px #7A4A00}.rolling{display:grid;grid-template-columns:1fr auto;gap:0 12px;align-items:baseline;border:1px solid var(--divider-color);border-radius:9px;padding:9px 11px;margin-bottom:12px}.rolling strong{font-size:20px}.rolling small{grid-column:1 / -1}.provenance{margin-top:14px}
      @media(max-width:600px){.difference{font-size:23px}.totals strong{font-size:25px}.content{padding:16px 12px}.axis{font-size:11px}.month-header{align-items:flex-start;flex-direction:column;gap:1px}.month-flags{text-align:left}.monthly-legend{gap:10px}}`;
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
    // The parent selects this declaratively for cumulative_year. 7/30/90,
    // and a plain cumulative 365-day curve, remain directly comparable.
    if (this._config.monthly_rows) {
      this._monthlyView(graph, profile, now);
      return;
    }
    if (this._config.forecast_today) {
      this._activeUnit = "mm";
      this._renderForecastToday(graph, profile, now);
      return;
    }
    const preliminaryComparison = this._monthlyData(profile, graph);
    const timeZone = preliminaryComparison?.timeZone || profile.attributes.site_timezone || profile.attributes.timezone || graph.site_timezone || "UTC";
    const start = this._rangeStart(now, timeZone);
    try {
      const comparison = preliminaryComparison;
      this._activeUnit = comparison?.unit || profile.attributes.unit_of_measurement || "mm";
      const cumulativeRows = this._comparisonCumulativeRows(comparison, timeZone);
      const comparisonRows = cumulativeRows ? null : this._comparisonDailyRows(comparison, timeZone);
      if (!graph.aggregate_source_entity && !comparisonRows && !cumulativeRows) {
        this._renderMessage("Kumulierte Niederschlagsdaten sind für diesen Zeitraum noch nicht verfügbar.");
        return;
      }
      const statistics = graph.aggregate_source_entity && !comparisonRows && !cumulativeRows
        ? await this._statistics(graph.aggregate_source_entity, start, now, "day") : [];
      if (this._generation !== generation) return;
      const actualRows = comparisonRows
        ? comparisonRows.map(point => ({ time: point.time, value: point.actual }))
        : statistics.map(point => ({ time: point.start, value: point.change }));
      const actual = cumulativeRows
        ? cumulativeRows.filter(point => point.actual != null).map(point => [point.time, point.actual])
        : this._cumulative(actualRows, "time", "value", start.getTime());
      const startKey = this._localDateKey(start, timeZone);
      const endKey = this._localDateKey(now, timeZone);
      const climateRows = comparisonRows
        ? comparisonRows.map(point => ({ time: point.time, value: point.expected }))
        : (profile.attributes.daily_normal || [])
        .filter(point => point.valid_on >= startKey && point.valid_on <= endKey)
        .map(point => ({ time: this._localTime(point.valid_on, timeZone, 12).getTime(), value: point.mean }));
      const expected = cumulativeRows
        ? cumulativeRows.filter(point => point.mean != null).map(point => [point.time, point.mean])
        : this._cumulative(climateRows, "time", "value", start.getTime());
      const p10 = cumulativeRows
        ? cumulativeRows.filter(point => point.p10 != null).map(point => [point.time, point.p10]) : [];
      const p90 = cumulativeRows
        ? cumulativeRows.filter(point => point.p90 != null).map(point => [point.time, point.p90]) : [];
      const total = comparison?.total;
      const totalActual = total?.actual || total?.modelled_actual;
      const coverage = this._number(totalActual?.coverage_ratio);
      if ((comparisonRows || cumulativeRows) && coverage != null && coverage < 0.999999) {
        this._renderMessage(`Der Ist-Verlauf ist nur zu ${(coverage * 100).toFixed(0)} % abgedeckt; keine vollständige Summe verfügbar.`);
        return;
      }
      const totalReference = total?.reference || total?.climatology || total?.normal || {};
      const serverExpected = this._number(totalReference.mean_mm ?? totalReference.mean ?? totalReference.p50_mm ?? totalReference.p50);
      const actualTotal = actual.at(-1)?.[1] || 0, expectedTotal = serverExpected ?? expected.at(-1)?.[1] ?? 0;
      actual.push([now.getTime(), actualTotal]);
      expected.push([now.getTime(), expectedTotal]);
      if (p10.length) p10.push([now.getTime(), p10.at(-1)[1]]);
      if (p90.length) p90.push([now.getTime(), p90.at(-1)[1]]);
      this._render(graph, actualTotal, expectedTotal, this._lineChart(actual, expected, start, now, actualTotal, expectedTotal, p10, p90), Boolean(p10.length && p90.length));
    } catch (error) {
      this._renderMessage(`Niederschlagsstatistik konnte nicht geladen werden: ${error.message}`);
    }
  }

  _renderForecastToday(graph, profile, now) {
    const attributes = profile.attributes || {};
    const stale = attributes.forecast_stale || attributes.forecast_availability === "unavailable";
    const model = attributes.forecast_model ? ` · ${attributes.forecast_model}` : "";
    const comparisons = this._comparisonForecasts(attributes);
    const comparisonLegend = comparisons.map(item => `<span><i class="comparison-key" style="background:${item.color}"></i>${this._escapeText(item.label)}</span>`).join("");
    this.shadowRoot.innerHTML = `<ha-card><div class="content"><h2>${this._escapeText(graph.title)} – ${this._escapeText(graph.explanation)}</h2><div class="subtitle">Stundenprognose · ICON${this._escapeText(model)}${stale ? " · Prognose veraltet" : ""}</div>${this._todayForecastChart(graph, profile, now)}<div class="legend"><span><i class="forecast-key"></i>ICON Stundenmenge</span>${comparisonLegend}<span><i class="actual-key"></i>IST</span><span>Wahrscheinlichkeit: Ereignis ≥ 0,5 mm je 6 h</span></div>${this._planningSummary(attributes)}</div></ha-card><style>${this._styles()}</style>`;
  }

  _render(graph, actual, expected, chart, hasBand = false) {
    const difference = actual - expected;
    const direction = difference >= 0 ? "über" : "unter";
    this.shadowRoot.innerHTML = `<ha-card>
      <div class="content">
        <h2>${this._escapeText(graph.title)} – ${this._escapeText(graph.explanation)}</h2>
        <div class="difference">${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(0)} ${this._escapeText(this._activeUnit || "mm")} ${direction} dem Durchschnitt</div>
        <div class="subtitle">${this._rangeLabel()}-Durchschnitt: ${expected.toFixed(0)} ${this._escapeText(this._activeUnit || "mm")}</div>
        <div class="totals"><div><strong>${expected.toFixed(0)} ${this._escapeText(this._activeUnit || "mm")}</strong><span>Durchschnitt</span></div><div><strong>${actual.toFixed(0)} ${this._escapeText(this._activeUnit || "mm")}</strong><span>Letzte ${this._rangeLabel()}</span></div></div>
        ${chart}
        <div class="legend"><span><i class="actual-key"></i>Letzte ${this._rangeLabel()}</span><span><i class="expected-key"></i>Durchschnitt</span>${hasBand ? "<span><i class=\"band-key\"></i>P10–P90</span>" : ""}</div>
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
      { entity, name: graph.circular ? "Zirkuläres Mittel 1970–2025" : "ERA5 P50 1970–2025", type: "line", color: "#00897B", stroke_width: 3, data_generator: normal(center), show: { legend_value: false } },
      { entity, name: graph.circular ? "Zirkuläres Mittel ab 1950" : "ERA5 P50 ab 1950", type: "line", color: "#7E57C2", stroke_width: 2, stroke_dash: 5, data_generator: normal(center, "hourly_all"), show: { legend_value: false } },
      { entity: graph.source_entity, name: "Ist heute", type: "line", color: "#039BE5", stroke_width: 4, extend_to: false,
        ...(graph.source_factor ? { transform: `return x * ${Number(graph.source_factor)};` } : {}),
        show: { legend_value: false } }
    );
    if (graph.forecast) {
      series.push({
        entity, name: "ICON Vorhersage", type: "line", color: "#FB8C00", stroke_width: 4,
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
      { entity, name: `${graph.circular ? "ERA5 Richtung 1970–2025" : "ERA5 P50 1970–2025"}${suffix}`, type: "line", color: "#00897B", stroke_width: 3, data_generator: climate("median", "daily_normal"), show: { legend_value: false } },
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

  _displayMode(graph) {
    const configured = String(graph.display_mode || "").toLowerCase();
    const aliases = {
      allgemein: "general",
      general: "general",
      kumulativ: "cumulative",
      cumulative: "cumulative",
      kumulativ_jahr: "cumulative_year",
      cumulative_year: "cumulative_year",
    };
    if (aliases[configured]) return aliases[configured];
    // Existing dashboards retain their behavior while migrations can move to
    // the declarative field above. This intentionally does not inspect a
    // variable name: rain, snow and all-phase precipitation share the mode.
    return (graph.precipitation_view || graph.monthly_comparison_entity || graph.monthly_entity)
      ? "cumulative_year" : "general";
  }

  _chart(graph) {
    const mode = this._displayMode(graph);
    if (mode !== "general" && this._range === "today" && graph.forecast) {
      return { type: "custom:nhz-precipitation-chart", graph, range: this._range, forecast_today: true };
    }
    if (mode !== "general" && this._range === "today") {
      return {
        type: "markdown",
        content: `**${graph.title}:** Für kumulierbare Größen beginnt der Klimavergleich bei 7 Tagen. Der heutige Verlauf gehört zur operativen Wettervorhersage.`,
      };
    }
    if (mode === "cumulative_year" && this._range === "365d") {
      return { type: "custom:nhz-precipitation-chart", graph, range: this._range, monthly_rows: true };
    }
    if (mode === "cumulative" || mode === "cumulative_year") {
      return { type: "custom:nhz-precipitation-chart", graph, range: this._range, monthly_rows: false };
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

class NhzClimateVentilationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (config.entities != null && !Array.isArray(config.entities)) {
      throw new Error("nhz-climate-ventilation-card entities must be a list");
    }
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return Math.max(2, 1 + this._entities().length);
  }

  _escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
  }

  _entities() {
    if (!this._hass?.states) return [];
    const configured = this._config?.entities;
    const entries = configured?.length
      ? configured.map(entityId => [entityId, this._hass.states[entityId]])
      : Object.entries(this._hass.states).filter(([, state]) => (
        state?.attributes?.advisory_only === true
      ));
    return entries
      .filter(([, state]) => state?.attributes?.advisory_only === true)
      .map(([entityId, state]) => ({ entityId, state }))
      .sort((left, right) => this._zoneName(left).localeCompare(
        this._zoneName(right), "de", { sensitivity: "base" },
      ));
  }

  _zoneName(row) {
    const attributes = row.state?.attributes || {};
    if (attributes.zone_name) return String(attributes.zone_name);
    const friendly = String(attributes.friendly_name || row.entityId);
    return friendly.replace(/\s+Fenster öffnen(?:\s+\(Arbeitswert\))?$/i, "");
  }

  _number(value) {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  _firstNumber(attributes, keys) {
    for (const key of keys) {
      const value = this._number(attributes?.[key]);
      if (value != null) return value;
    }
    return null;
  }

  _formatClimate(value, digits = 1) {
    const number = this._number(value);
    return number == null ? "–" : number.toFixed(digits).replace(".", ",");
  }

  _signed(value, suffix = "", digits = 1) {
    const number = this._number(value);
    if (number == null) return "–";
    return `${number >= 0 ? "+" : "−"}${this._formatClimate(Math.abs(number), digits)}${suffix}`;
  }

  _climateValues(attributes) {
    const projection = attributes?.ventilation_projection || {};
    const current = projection.current || {};
    const targets = projection.targets || {};
    const temperatureCorridor = Array.isArray(targets.temperature_acceptance_c)
      ? targets.temperature_acceptance_c : [20, 24];
    const humidityCorridor = Array.isArray(targets.relative_humidity_acceptance_percent)
      ? targets.relative_humidity_acceptance_percent : [40, 60];
    const temperature = this._firstNumber(attributes, [
      "current_temperature_c",
      "indoor_temperature", "current_indoor_temperature", "indoor_temperature_c", "current_temperature",
    ]) ?? this._firstNumber(current, ["temperature_c", "temperature"]);
    const humidity = this._firstNumber(attributes, [
      "current_relative_humidity_percent",
      "indoor_relative_humidity", "current_indoor_relative_humidity", "indoor_relative_humidity_percent",
      "current_humidity", "relative_humidity",
    ]) ?? this._firstNumber(current, ["relative_humidity_percent", "relative_humidity", "humidity"]);
    const targetTemperature = this._firstNumber(attributes, [
      "target_temperature", "target_temperature_c", "temperature_target", "comfort_temperature",
    ]) ?? this._firstNumber(targets, ["temperature_c", "temperature"]) ?? 22;
    const targetHumidity = this._firstNumber(attributes, [
      "target_relative_humidity", "target_humidity", "target_relative_humidity_percent", "humidity_target",
    ]) ?? this._firstNumber(targets, ["relative_humidity_percent", "relative_humidity", "humidity"]) ?? 50;
    const temperatureDelta = temperature == null ? null : temperature - targetTemperature;
    const humidityDelta = humidity == null ? null : humidity - targetHumidity;
    return {
      temperature, humidity, targetTemperature, targetHumidity, temperatureDelta, humidityDelta,
      temperatureMin: this._number(temperatureCorridor[0]) ?? 20,
      temperatureMax: this._number(temperatureCorridor[1]) ?? 24,
      humidityMin: this._number(humidityCorridor[0]) ?? 40,
      humidityMax: this._number(humidityCorridor[1]) ?? 60,
    };
  }

  _projectionPeriod(attributes, suffix, hours = null) {
    const legacySuffix = hours == null ? suffix : `${hours}h`;
    const contract = attributes?.ventilation_projection || {};
    const contractHorizon = contract.trajectory_summary?.[suffix]
      || contract.trajectory?.[suffix]
      || contract.horizons?.[suffix];
    if (contract.available === false && !attributes?.[`projection_${suffix}`]
      && !attributes?.[`projected_${suffix}`]
      && !attributes?.[`projection_${legacySuffix}`]
      && !attributes?.[`projected_${legacySuffix}`]) return null;
    const nested = attributes?.[`projection_${suffix}`]
      || attributes?.[`projected_${suffix}`]
      || attributes?.[`projection_${legacySuffix}`]
      || attributes?.[`projected_${legacySuffix}`]
      || contractHorizon
      || {};
    if (attributes?.[`projection_${suffix}_available`] === false
      || attributes?.[`projection_${legacySuffix}_available`] === false) return null;
    if (contractHorizon?.available === false) return null;
    const temperature = this._firstNumber(nested, ["temperature", "temperature_c", "indoor_temperature", "projected_temperature"])
      ?? this._firstNumber(attributes, [
        `projection_${suffix}_temperature`, `projected_${suffix}_temperature`, `projected_temperature_${suffix}`,
        `projection_${legacySuffix}_temperature`, `projected_${legacySuffix}_temperature`, `projected_temperature_${legacySuffix}`,
        `temperature_projection_${suffix}`, `temperature_${suffix}`,
      ]);
    const humidity = this._firstNumber(nested, ["relative_humidity", "relative_humidity_percent", "humidity", "projected_humidity"])
      ?? this._firstNumber(attributes, [
        `projection_${suffix}_relative_humidity`, `projection_${suffix}_humidity`,
        `projected_${suffix}_relative_humidity`, `projected_${suffix}_humidity`,
        `projection_${legacySuffix}_relative_humidity`, `projection_${legacySuffix}_humidity`,
        `projected_${legacySuffix}_relative_humidity`, `projected_${legacySuffix}_humidity`,
        `projected_humidity_${suffix}`, `humidity_${suffix}`,
      ]);
    if (temperature == null && humidity == null) return null;
    const theoreticalTemperature = this._firstNumber(nested, ["air_only_temperature", "air_only_temperature_c", "theoretical_temperature", "air_limit_temperature"])
      ?? this._firstNumber(attributes, [
        `projection_${suffix}_air_only_temperature`, `projection_${suffix}_theoretical_temperature`,
        `projection_${legacySuffix}_air_only_temperature`, `projection_${legacySuffix}_theoretical_temperature`,
        `air_only_temperature_${suffix}`, `theoretical_temperature_${suffix}`,
      ]);
    const theoreticalHumidity = this._firstNumber(nested, ["air_only_relative_humidity", "air_only_relative_humidity_percent", "theoretical_relative_humidity", "air_limit_relative_humidity"])
      ?? this._firstNumber(attributes, [
        `projection_${suffix}_air_only_relative_humidity`, `projection_${suffix}_theoretical_relative_humidity`,
        `projection_${legacySuffix}_air_only_relative_humidity`, `projection_${legacySuffix}_theoretical_relative_humidity`,
        `air_only_relative_humidity_${suffix}`, `theoretical_relative_humidity_${suffix}`,
      ]);
    return { key: suffix, temperature, humidity, theoreticalTemperature, theoreticalHumidity };
  }

  _projection(attributes, hours) {
    return this._projectionPeriod(attributes, `${hours}h`, hours);
  }

  _recommendation(attributes) {
    const projection = attributes?.ventilation_projection || {};
    const recommendation = projection.duration_recommendation
      || attributes?.ventilation_recommendation
      || projection.recommendation
      || {};
    // The top-level values are the stabilized/weather-limited contract.  The
    // nested projection is a raw model result and must never override a
    // top-level safety decision such as `avoid`.
    const hasOwn = key => Object.prototype.hasOwnProperty.call(attributes || {}, key);
    const authoritativeAction = hasOwn("recommended_action");
    const topLevelAction = String(attributes?.recommended_action ?? "").trim().toLowerCase();
    const action = authoritativeAction ? topLevelAction : String(
      recommendation.recommended_action ?? recommendation.action ?? projection.recommended_action ?? "",
    ).trim().toLowerCase();
    const authoritativeDuration = hasOwn("recommended_duration_minutes")
      || hasOwn("ventilation_duration_minutes");
    const duration = authoritativeDuration
      ? this._firstNumber(attributes, ["recommended_duration_minutes", "ventilation_duration_minutes"])
      : this._firstNumber(recommendation, ["recommended_duration_minutes", "duration_minutes"]);
    const limiting = String(
      attributes?.limiting_factor ?? recommendation.limiting_factor ?? projection.limiting_factor ?? "",
    ).trim();
    const before = this._firstNumber(attributes, ["target_distance_before", "normalized_target_distance_before", "normalized_distance_before"])
      ?? this._firstNumber(recommendation, ["target_distance_before", "normalized_target_distance_before"]);
    const after = this._firstNumber(attributes, ["target_distance_after", "normalized_target_distance_after", "normalized_distance_after"])
      ?? this._firstNumber(recommendation, ["target_distance_after", "normalized_target_distance_after"]);
    return { action, duration, limiting, before, after };
  }

  _actionLabel(attributes, fallback) {
    const recommendation = this._recommendation(attributes);
    if (!recommendation.action) return fallback;
    const minutes = recommendation.duration != null ? ` · ${Math.round(recommendation.duration)} min` : "";
    return {
      short_airing: `Stoßlüften${minutes}`,
      ventilate: "Lüften empfohlen",
      overnight: "Nachtlüften möglich",
      avoid: "Nicht lüften",
      optional: "Nicht erforderlich",
    }[recommendation.action] || fallback;
  }

  _climateLabel(values) {
    const { temperature, humidity, temperatureMin, temperatureMax, humidityMin, humidityMax } = values;
    const temperatureOutside = temperature != null && (temperature < temperatureMin || temperature > temperatureMax);
    const humidityOutside = humidity != null && (humidity < humidityMin || humidity > humidityMax);
    if (!temperatureOutside && !humidityOutside) return { icon: "🌡️", label: "Im Zielbereich", className: "neutral" };
    if (humidityOutside) {
      return humidity > humidityMax
        ? { icon: "💧", label: "Zu feucht", className: "humid" }
        : { icon: "🏜️", label: "Zu trocken", className: "dry" };
    }
    if (temperatureOutside) {
      return temperature > temperatureMax
        ? { icon: "🔥", label: "Zu warm", className: "warm" }
        : { icon: "❄️", label: "Zu kalt", className: "cold" };
    }
    return { icon: "🌡️", label: "Im Zielbereich", className: "neutral" };
  }

  _climateSummary(attributes) {
    const values = this._climateValues(attributes);
    if (values.temperature == null && values.humidity == null) return "";
    const climate = this._climateLabel(values);
    const current = [];
    if (values.temperature != null) current.push(`${this._formatClimate(values.temperature)} °C`);
    if (values.humidity != null) current.push(`${this._formatClimate(values.humidity, 0)} % rF`);
    const deltas = [];
    if (values.temperatureDelta != null) deltas.push(this._signed(values.temperatureDelta, " K", 1));
    if (values.humidityDelta != null) deltas.push(this._signed(values.humidityDelta, " Pkt.", 0));
    return `<div class="climate ${climate.className}"><strong>${climate.icon} ${climate.label}</strong><span>${this._escapeText(current.join(" · "))}${deltas.length ? ` <small>(${this._escapeText(deltas.join(" · "))} zum Ziel)</small>` : ""}</span></div>`;
  }

  _projectionSummary(attributes) {
    const recommendation = this._recommendation(attributes);
    const selectedMinutes = recommendation.duration != null ? Math.max(15, Math.round(recommendation.duration / 15) * 15) : null;
    const selectedKey = selectedMinutes != null ? `${selectedMinutes}m` : null;
    const overnight = recommendation.action === "overnight" || selectedMinutes >= 480;
    const keys = overnight ? ["8h"] : (selectedKey ? [selectedKey, "8h"] : ["1h", "8h"]);
    const lines = keys.map(key => {
      const projection = key.endsWith("m")
        ? this._projectionPeriod(attributes, key, key === "60m" ? 1 : null)
        : this._projection(attributes, Number.parseInt(key, 10));
      if (!projection) return "";
      const values = [];
      if (projection.temperature != null) values.push(`❄️ ${this._formatClimate(projection.temperature)} °C`);
      if (projection.humidity != null) values.push(`💧 ${this._formatClimate(projection.humidity, 0)} %`);
      if (!values.length) return "";
      const theoretical = [];
      if (projection.theoreticalTemperature != null) theoretical.push(`Luftgrenze ${this._formatClimate(projection.theoreticalTemperature)} °C`);
      if (projection.theoreticalHumidity != null) theoretical.push(`Luftgrenze ${this._formatClimate(projection.theoreticalHumidity, 0)} %`);
      const label = key.endsWith("m") ? `${key.slice(0, -1)} min` : `${key.slice(0, -1)} h`;
      const title = theoretical.length ? ` title="${this._escapeText(theoretical.join(" · "))}"` : "";
      return `<span class="projection"${title}>${label}&nbsp; ${this._escapeText(values.join(" · "))}</span>`;
    }).filter(Boolean);
    return lines.length ? `<div class="projections">${lines.join("")}</div>` : "";
  }

  _status(status, attributes = {}) {
    const base = {
      ja: { icon: "🪟", label: "Lüften empfohlen", className: "yes" },
      nein: { icon: "⛔", label: "Nicht lüften", className: "no" },
      ambivalent: { icon: "⚖️", label: "Abwägen", className: "ambivalent" },
      optional: { icon: "🌿", label: "Nicht erforderlich, aber unschädlich", className: "optional" },
      unavailable: { icon: "❔", label: "Daten nicht verfügbar", className: "unavailable" },
      unknown: { icon: "❔", label: "Daten nicht verfügbar", className: "unavailable" },
    }[String(status)] || { icon: "❔", label: String(status || "Daten nicht verfügbar"), className: "unavailable" };
    const action = this._recommendation(attributes).action;
    if (!action) return base;
    const overrides = {
      short_airing: { icon: "🪟", className: "yes" },
      ventilate: { icon: "🪟", className: "yes" },
      overnight: { icon: "🌙", className: "yes" },
      avoid: { icon: "⛔", className: "no" },
      optional: { icon: "🌿", className: "optional" },
    };
    const override = overrides[action];
    return override ? { ...base, ...override, label: this._actionLabel(attributes, base.label) } : base;
  }

  _reasonCodes(attributes, prefix = "") {
    const value = attributes[`${prefix}reason_codes`];
    return Array.isArray(value) ? value.map(String) : [];
  }

  _effectText(attributes, prefix = "") {
    const humidity = this._reasonCodes(attributes, `${prefix}humidity_`);
    const thermal = this._reasonCodes(attributes, `${prefix}thermal_`);
    const parts = [];
    if (humidity.includes("dehumidification_benefit")) parts.push("🏜️ führt Feuchte günstig ab");
    else if (humidity.includes("dehumidification_harm")) parts.push("🏜️ trocknet unerwünscht");
    else if (humidity.includes("humidification_benefit")) parts.push("💧 bringt günstig Feuchte ein");
    else if (humidity.includes("humidification_harm")) parts.push("💧 bringt unerwünscht Feuchte ein");
    else if (humidity.includes("humidity_within_acceptance_corridor")) parts.push("💧 Feuchte im Zielkorridor");
    else if (humidity.includes("humidity_potential_neutral")) parts.push("💧 kaum Feuchteänderung");

    if (thermal.includes("cooling_benefit")) parts.push("❄️ kühlt günstig");
    else if (thermal.includes("cooling_harm")) parts.push("❄️ kühlt unerwünscht");
    else if (thermal.includes("warming_benefit")) parts.push("🔥 wärmt günstig");
    else if (thermal.includes("warming_harm")) parts.push("🔥 wärmt unerwünscht");
    else if (thermal.includes("temperature_within_acceptance_corridor")) parts.push("🌡️ Temperatur im Zielkorridor");
    else if (thermal.includes("thermal_potential_neutral")) parts.push("🌡️ kaum Wärmeänderung");
    else if (thermal.includes("sensible_enthalpy_conflict")) parts.push("↔️ Wärmebewertung widersprüchlich");
    return parts.join(" · ");
  }

  _pending(attributes) {
    if (attributes.pending !== true || !attributes.candidate_status) return "";
    const candidateAttributes = {
      ...attributes,
      // A pending candidate must not inherit the confirmed duration action.
      recommended_action: attributes.candidate_recommended_action || "",
      recommended_duration_minutes: attributes.candidate_recommended_duration_minutes,
      ventilation_projection: {},
    };
    const candidate = this._status(attributes.candidate_status, candidateAttributes);
    const seconds = Number(attributes.candidate_remaining_seconds);
    const remaining = Number.isFinite(seconds) && seconds > 0
      ? ` · noch ${Math.max(1, Math.ceil(seconds / 60))} min`
      : "";
    const effects = this._effectText(attributes, "candidate_");
    return `<div class="pending"><strong>Wird geprüft:</strong> ${candidate.icon} ${this._escapeText(candidate.label)}${remaining}${effects ? `<small>${this._escapeText(effects)}</small>` : ""}</div>`;
  }

  _safety(attributes) {
    if (attributes.safety_lock_active !== true) return "";
    const reasons = this._reasonCodes(attributes, "current_weather_");
    const labels = [];
    if (reasons.some(reason => reason.startsWith("rain"))) labels.push("Regen");
    if (reasons.some(reason => reason.includes("gust"))) labels.push("starke Böen");
    return `<div class="safety">🔒 Aktive Sicherheitssperre${labels.length ? `: ${this._escapeText(labels.join(" und "))}` : ""}</div>`;
  }

  _summary(rows) {
    if (!rows.length) return { icon: "❔", text: "Keine Lüftungszonen gefunden", detail: "", className: "unavailable" };
    const counts = rows.reduce((result, row) => {
      const action = this._recommendation(row.state.attributes || {}).action;
      const key = action || String(row.state.state);
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    const locked = rows.filter(row => row.state.attributes?.safety_lock_active === true).length;
    const unavailable = (counts.unavailable || 0) + (counts.unknown || 0);
    const distribution = [
      counts.short_airing ? `${counts.short_airing} Stoßlüften` : "",
      counts.overnight ? `${counts.overnight} Nachtlüften` : "",
      counts.ventilate ? `${counts.ventilate} empfohlen` : "",
      counts.ja ? `${counts.ja} empfohlen` : "",
      counts.avoid ? `${counts.avoid} nicht lüften` : "",
      counts.nein ? `${counts.nein} nicht empfohlen` : "",
      counts.ambivalent ? `${counts.ambivalent} abzuwägen` : "",
      counts.optional ? `${counts.optional} optional` : "",
      unavailable ? `${unavailable} ohne Daten` : "",
    ].filter(Boolean).join(" · ");
    if (locked) return {
      icon: "🔒", text: `Aktive Sicherheitssperre in ${locked} ${locked === 1 ? "Raum" : "Räumen"}`,
      detail: distribution, className: "no",
    };
    const represented = [counts.short_airing, counts.overnight, counts.ventilate, counts.avoid,
      counts.ja, counts.nein, counts.ambivalent, counts.optional, unavailable]
      .filter(Boolean).length;
    if (represented > 1) return {
      icon: "↔️", text: "Räume unterschiedlich bewerten", detail: distribution, className: "ambivalent",
    };
    if (counts.short_airing) return { icon: "🪟", text: "Stoßlüften", detail: distribution, className: "yes" };
    if (counts.overnight) return { icon: "🌙", text: "Nachtlüften möglich", detail: distribution, className: "yes" };
    if (counts.ventilate || counts.ja) return { icon: "🪟", text: "Lüften empfohlen", detail: distribution, className: "yes" };
    if (counts.avoid) return { icon: "⛔", text: "Nicht lüften", detail: distribution, className: "no" };
    if (counts.ambivalent) return { icon: "⚖️", text: "Lüften je nach Ziel abwägen", detail: distribution, className: "ambivalent" };
    if (counts.nein) return { icon: "⛔", text: "Lüften derzeit nicht empfohlen", detail: distribution, className: "no" };
    if (counts.optional) return { icon: "🌿", text: "Lüften nicht erforderlich, aber unschädlich", detail: distribution, className: "optional" };
    return { icon: "❔", text: "Bewertung derzeit nicht verfügbar", detail: distribution, className: "unavailable" };
  }

  _openMoreInfo(entityId) {
    const event = new CustomEvent("hass-more-info", {
      detail: { entityId }, bubbles: true, composed: true,
    });
    this.dispatchEvent(event);
  }

  _bindRows() {
    this.shadowRoot.querySelectorAll?.("button.zone").forEach(button => {
      button.addEventListener("click", () => this._openMoreInfo(button.dataset.entityId));
    });
  }

  _render() {
    if (!this._config || !this.shadowRoot) return;
    const rows = this._entities();
    const summary = this._summary(rows);
    const body = rows.map(row => {
      const attributes = row.state.attributes || {};
      const status = this._status(row.state.state, attributes);
      const effects = this._effectText(attributes);
      const recommendation = this._recommendation(attributes);
      const detail = [];
      if (recommendation.before != null && recommendation.after != null) {
        detail.push(`Zielabstand ${recommendation.before.toFixed(2)} → ${recommendation.after.toFixed(2)}`);
      }
      if (recommendation.limiting) detail.push(`Begrenzung: ${recommendation.limiting}`);
      return `<button class="zone ${status.className}" data-entity-id="${this._escapeText(row.entityId)}" type="button">
        <span class="zone-icon">${status.icon}</span>
        <span class="zone-content"><span class="zone-heading"><strong>${this._escapeText(this._zoneName(row))}</strong><span${detail.length ? ` title="${this._escapeText(detail.join(" · "))}"` : ""}>${this._escapeText(status.label)}</span></span>
        ${this._climateSummary(attributes)}
        ${this._projectionSummary(attributes)}
        ${this._safety(attributes)}
        ${effects ? `<small class="effects">${this._escapeText(effects)}</small>` : ""}
        ${this._pending(attributes)}</span>
        <ha-icon icon="mdi:chevron-right"></ha-icon>
      </button>`;
    }).join("");
    this.shadowRoot.innerHTML = `<ha-card>
      <div class="content">
        <h2>${this._escapeText(this._config.title || "Lüftung")}</h2>
        <div class="summary ${summary.className}"><span>${summary.icon}</span><span class="summary-copy"><strong>${this._escapeText(summary.text)}</strong>${summary.detail ? `<small>${this._escapeText(summary.detail)}</small>` : ""}</span></div>
        <div class="zones">${body || `<div class="empty">Keine Entität mit <code>advisory_only: true</code> gefunden.</div>`}</div>
      </div>
    </ha-card><style>
      .content{padding:18px 18px 14px;color:var(--primary-text-color)}h2{margin:0 0 14px;font-size:22px}
      .summary{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:12px;margin-bottom:12px;background:var(--secondary-background-color)}
      .summary-copy{display:grid;gap:2px}.summary-copy small{color:var(--secondary-text-color);font-size:12px}
      .summary.yes{border-left:5px solid #2E7D32}.summary.no{border-left:5px solid #C62828}.summary.ambivalent{border-left:5px solid #F9A825}.summary.optional{border-left:5px solid #00897B}.summary.unavailable{border-left:5px solid #757575}
      .zones{display:grid;gap:8px}.zone{appearance:none;width:100%;border:1px solid var(--divider-color);border-radius:12px;background:transparent;color:inherit;padding:10px 12px;display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center;text-align:left;font:inherit;cursor:pointer}
      .zone:hover{background:var(--secondary-background-color)}.zone:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}.zone-icon{font-size:22px}.zone-content{min-width:0;display:grid;gap:4px}.zone-heading{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.zone-heading span{color:var(--secondary-text-color);text-align:right}.effects{color:var(--secondary-text-color)}
      .climate{display:flex;flex-wrap:wrap;gap:3px 9px;align-items:baseline}.climate strong{font-size:14px}.climate span{font-variant-numeric:tabular-nums}.climate small{color:var(--secondary-text-color);font-size:11px}.climate.humid strong{color:#1976D2}.climate.dry strong{color:#D68910}.climate.warm strong{color:#E65100}.climate.cold strong{color:#1565C0}.climate.neutral strong{color:var(--secondary-text-color)}
      .projections{display:flex;flex-wrap:wrap;gap:3px 14px;color:var(--secondary-text-color);font-size:12px;font-variant-numeric:tabular-nums}.projection{white-space:nowrap}
      .pending{padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--primary-color) 12%,transparent);font-size:13px}.pending small{display:block;margin-top:3px;color:var(--secondary-text-color)}.safety{font-weight:650;color:var(--error-color,#db4437)}
      .empty{color:var(--secondary-text-color);font-size:12px;padding:12px 2px}ha-icon{color:var(--secondary-text-color)}
      @media(max-width:500px){.zone-heading{display:grid;gap:2px}.zone-heading span{text-align:left}}
    </style>`;
    this._bindRows();
  }
}

class NhzClimateDryWindowCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config?.entity || typeof config.entity !== "string") {
      throw new Error("nhz-climate-dry-window-card requires an entity");
    }
    if (config.default_window != null && ![24, 48].includes(Number(config.default_window))) {
      throw new Error("nhz-climate-dry-window-card default_window must be 24 or 48");
    }
    this._config = config;
    this._selectedHours = [24, 48].includes(this._selectedHours)
      ? this._selectedHours : (Number(config.default_window) === 48 ? 48 : 24);
    this._lastHassSignature = undefined;
    this._lastEntityState = undefined;
    this._render();
    this._lastEntityState = this._hass?.states?.[this._config.entity];
    this._lastHassSignature = this._stateSignature(this._lastEntityState);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const entityState = hass?.states?.[this._config.entity];
    // `hass` is assigned for unrelated HA state changes as well. Avoid
    // replacing this card's DOM unless its own entity actually changed: that
    // keeps a vertical page scroll completely outside this card's update path.
    if (entityState === this._lastEntityState) return;
    const signature = this._stateSignature(entityState);
    this._lastEntityState = entityState;
    if (signature === this._lastHassSignature) return;
    this._lastHassSignature = signature;
    this._render(true);
  }

  getCardSize() { return 9; }

  _escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
  }

  _number(value) {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  _stateSignature(state) {
    try {
      return JSON.stringify([state?.state ?? null, state?.last_updated ?? null, state?.attributes ?? null]);
    } catch (_) {
      // HA state attributes are JSON data. If an extension violates that
      // assumption, render conservatively rather than touching page scroll.
      return `${state?.state ?? ""}:${state?.last_updated ?? ""}`;
    }
  }

  _time(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return value < 100000000000 ? value * 1000 : value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  _coverage(value) {
    const parsed = this._number(value);
    if (parsed == null) return null;
    return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
  }

  _modelLabel(model) {
    const value = String(model || "").toLowerCase();
    if (value.includes("ifs")) return "IFS-EPS";
    if (value.includes("ec46")) return "EC46-EPS";
    return String(model || "Planungsmodell");
  }

  _columnSeriesWindows(payload) {
    // v2 keeps every rolling window losslessly in aligned columns.  Expand it
    // at the card boundary so all later rendering uses the same absolute
    // window model as legacy `windows`/`h,s,e,d,c,l,m,q` payloads.
    const series = payload?.series;
    if (!series || typeof series !== "object") return [];
    const entries = Array.isArray(series)
      ? series.map(item => [item?.window_hours ?? item?.h ?? item?.hours, item])
      : Object.entries(series);
    return entries.flatMap(([key, column]) => {
      if (!column || typeof column !== "object") return [];
      const hours = this._number(column.window_hours ?? column.h ?? column.hours ?? String(key).replace(/h$/i, ""));
      const base = this._time(column.base ?? column.start ?? column.s);
      const offsets = Array.isArray(column.offset_hours) ? column.offset_hours : [];
      const probabilities = Array.isArray(column.dry_probability) ? column.dry_probability : [];
      if (![24, 48].includes(hours) || base == null || !offsets.length || offsets.length !== probabilities.length) return [];
      const columns = {
        coverage: Array.isArray(column.coverage_ratio) ? column.coverage_ratio : [],
        p10: Array.isArray(column.p10_mm) ? column.p10_mm : [],
        p50: Array.isArray(column.p50_mm) ? column.p50_mm : [],
        p90: Array.isArray(column.p90_mm) ? column.p90_mm : [],
      };
      return offsets.map((offset, index) => {
        const offsetHours = this._number(offset);
        const dry = this._number(probabilities[index]);
        if (offsetHours == null || dry == null) return null;
        const start = base + offsetHours * 3600000;
        return {
          valid_from: new Date(start).toISOString(), valid_to: new Date(start + hours * 3600000).toISOString(),
          window_hours: hours, dry_probability: dry,
          coverage_ratio: columns.coverage[index], p10_mm: columns.p10[index],
          p50_mm: columns.p50[index], p90_mm: columns.p90[index],
        };
      }).filter(Boolean);
    });
  }

  _planningModels(attributes) {
    // The dedicated HA planning entity publishes `planning_models`.  The
    // profile-entity aliases retain compatibility with the additive forecast
    // contract used by older dashboards.
    const raw = attributes?.planning_models ?? attributes?.forecast_planning ?? attributes?.planning_forecast ?? attributes?.planning;
    if (!raw || typeof raw !== "object") return [];
    const entries = Array.isArray(raw)
      ? raw.map(item => [item?.model_key || item?.model || item?.provider_model, item])
      : Array.isArray(raw.models) ? raw.models.map(item => [item?.model_key || item?.model || item?.provider_model, item])
        : Object.entries(raw).filter(([, value]) => value && typeof value === "object");
    return entries.map(([key, payload]) => {
      const modelKey = payload.model_key || payload.model || payload.provider_model || key;
      const candidates = [
        ...this._columnSeriesWindows(payload),
        ...(Array.isArray(payload.windows) ? payload.windows : []),
        ...(Array.isArray(payload.rolling_windows) ? payload.rolling_windows : []),
        ...(Array.isArray(payload.dry_windows) ? payload.dry_windows : []),
        ...(payload.next_24h ? [payload.next_24h] : []),
        ...(payload.next_48h ? [payload.next_48h] : []),
      ];
      const windows = candidates.map(window => {
        const start = this._time(window.valid_from ?? window.start ?? window.range_start_utc ?? window.s);
        const end = this._time(window.valid_to ?? window.end ?? window.range_end_utc ?? window.e);
        const inferredHours = start != null && end != null ? Math.round((end - start) / 3600000) : null;
        const hours = this._number(window.window_hours ?? window.horizon_hours ?? window.hours ?? window.h) ?? inferredHours;
        const dry = this._number(window.dry_probability ?? window.dry_window_probability ?? window.probability_dry ?? window.probability ?? window.d);
        return {
          ...window, start, end, hours, dry: dry == null ? null : Math.max(0, Math.min(1, dry > 1 ? dry / 100 : dry)),
          p10: this._number(window.p10_mm ?? window.p10 ?? window.l),
          p50: this._number(window.p50_mm ?? window.p50 ?? window.median_mm ?? window.m),
          p90: this._number(window.p90_mm ?? window.p90 ?? window.q),
          coverage: this._coverage(window.coverage_ratio ?? window.coverage ?? window.c),
          snapshot: this._time(window.snapshot_at ?? payload.snapshot_at ?? payload.first_seen_at),
          stale: window.stale === true || payload.stale === true,
          cadence: this._number(window.native_cadence_hours ?? payload.native_cadence_hours ?? payload.cadence_hours),
        };
      }).filter(window => window.start != null && window.end != null && window.hours != null);
      return {
        key: String(modelKey), label: this._modelLabel(modelKey), provider: payload.provider_model || payload.provider || "",
        snapshot: this._time(payload.snapshot_at ?? payload.first_seen_at), stale: payload.stale === true,
        // A snapshot is only an API observation time. It must not be relabelled
        // as a provider model initialization/reference time.
        reference: this._time(payload.run_reference_time ?? payload.model_run_at),
        cadence: this._number(payload.native_cadence_hours ?? payload.cadence_hours), windows,
      };
    }).filter(model => model.windows.length);
  }

  _windows(models, hours) {
    return models.map(model => ({ ...model, windows: model.windows
      .filter(window => window.hours === hours)
      .sort((left, right) => left.start - right.start) })).filter(model => model.windows.length);
  }

  _formatDate(time, timeZone) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone }).format(time);
  }

  _formatWindow(window, timeZone) {
    return `${this._formatDate(window.start, timeZone)} – ${new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(window.end)}`;
  }

  _formatMm(value) { return value == null ? "–" : `${value.toFixed(1).replace(".", ",")} mm`; }

  _dryClass(probability) {
    // Forecast probabilities have no calibrated agricultural category here.
    // Colour therefore encodes the selected series only, never “good/bad”.
    return probability == null ? "unknown" : "probability";
  }

  _dryLabel(probability) {
    return probability == null ? "keine Trockenwahrscheinlichkeit" : "höher = trockener";
  }

  _coverageText(window) {
    if (window.coverage == null || window.coverage >= .999) return "";
    return `Abdeckung ${(window.coverage * 100).toFixed(0)} %`;
  }

  _dateKey(time, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(time).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  _median(values) {
    const sorted = values.filter(value => value != null).sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  _primaryModel(models) {
    return models.find(model => model.key.toLowerCase().includes("ifs")) || models[0] || null;
  }

  _heroBest(models, timeZone) {
    const model = this._primaryModel(models);
    if (!model) return null;
    const days = [...new Set(model.windows.map(window => this._dateKey(window.start, timeZone)))].slice(0, 7);
    const window = model.windows.filter(item => days.includes(this._dateKey(item.start, timeZone)) && item.dry != null)
      .reduce((winner, item) => !winner || item.dry > winner.dry ? item : winner, null);
    return window ? { model, window, days } : null;
  }

  _nearFuture(models, timeZone) {
    // Seven *local* start dates bound the DOM even when a provider emits a
    // rolling window every six hours.  The displayed item is the driest real
    // start window for that model/date, never a daily average.
    const primary = this._primaryModel(models);
    if (!primary) return [];
    const dateKeys = [...new Set(primary.windows.map(window => this._dateKey(window.start, timeZone)))].slice(0, 7);
    const namedModels = models.filter(model => /ifs|ec46/i.test(model.key));
    const visibleModels = (namedModels.length ? namedModels : models).slice(0, 2);
    return dateKeys.map(key => ({
      key,
      rows: visibleModels.map(model => {
        const candidates = model.windows.filter(window => this._dateKey(window.start, timeZone) === key && window.dry != null);
        const selected = candidates.reduce((winner, window) => !winner || window.dry > winner.dry ? window : winner, null);
        return selected ? { model, window: selected, candidates: candidates.length } : null;
      }).filter(Boolean),
    })).filter(day => day.rows.length);
  }

  _nearWindow(row, timeZone) {
    const { model, window, candidates } = row;
    const range = window.p10 != null || window.p90 != null
      ? `P10–P90 ${this._formatMm(window.p10)}–${this._formatMm(window.p90)}` : "P10–P90 –";
    const detail = [`Start ${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone }).format(window.start)}`, `P50 ${this._formatMm(window.p50)}`, range, this._coverageText(window)].filter(Boolean).join(" · ");
    return `<div class="model-line ${this._dryClass(window.dry)}"><strong>${this._escapeText(model.label)}</strong><span>${Math.round(window.dry * 100)} %</span><i aria-hidden="true"><b style="width:${Math.round(window.dry * 100)}%"></b></i><small title="${this._escapeText(detail)}">${this._escapeText(detail)}${candidates > 1 ? ` · Auswahl aus ${candidates} Starts` : ""}</small></div>`;
  }

  _nearFutureSection(models, hours, timeZone) {
    const days = this._nearFuture(models, timeZone);
    if (!days.length) return "";
    const namedModels = models.filter(model => /ifs|ec46/i.test(model.key));
    const provenance = (namedModels.length ? namedModels : models).slice(0, 2).map(model => [model.label, model.provider, model.snapshot ? `Snapshot ${this._formatDate(model.snapshot, timeZone)}` : ""].filter(Boolean).join(" · ")).join(" / ");
    return `<section class="model near"><div class="section-head"><div><h3>Nächste sieben verfügbare Starttage</h3><small>Je Modell und lokalem Starttag: trockenstes reales ${hours}-h-Fenster aus den rollierenden Starts.</small></div><small>${this._escapeText(provenance)}</small></div><div class="days">${days.map(day => `<article class="day"><strong>${this._escapeText(new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone }).format(new Date(`${day.key}T12:00:00Z`)))}</strong>${day.rows.map(row => this._nearWindow(row, timeZone)).join("")}</article>`).join("")}</div></section>`;
  }

  _origin(models) {
    // Only a certified provider run/reference timestamp is an exact lead-zero.
    // The planning source currently exposes snapshot_at merely as first-seen
    // time. Without an exact run timestamp, derive the documented nominal
    // origin from IFS day 3 or EC46 day 10 instead of mislabelling first-seen.
    const primary = this._primaryModel(models);
    if (primary?.reference != null) return primary.reference;
    const first = primary?.windows[0]?.start;
    if (first != null && /ifs/i.test(primary.key)) return first - 3 * 86400000;
    if (first != null && /ec46/i.test(primary.key)) return first - 10 * 86400000;
    return first ?? Math.min(...models.flatMap(model => model.windows.map(window => window.start)));
  }

  _overlap(models, hours, timeZone) {
    const ifs = models.find(model => model.key.toLowerCase().includes("ifs"));
    const ec46 = models.find(model => model.key.toLowerCase().includes("ec46"));
    if (!ifs || !ec46) return "";
    const origin = this._origin(models);
    const ec46ByRange = new Map(ec46.windows.map(window => [`${window.start}:${window.end}`, window]));
    const pairs = ifs.windows.map(window => [window, ec46ByRange.get(`${window.start}:${window.end}`)])
      .filter(([, other]) => other && (other.dry != null))
      .filter(([window]) => window.dry != null && Math.floor((window.start - origin) / 86400000) >= 10 && Math.floor((window.start - origin) / 86400000) < 16);
    if (!pairs.length) return `<section class="overlap"><h3>IFS/EC46 · Tag 10–15</h3><p>Keine exakt deckungsgleichen ${hours}-h-Fenster. Werte werden nicht zeitlich verschoben oder gemischt.</p></section>`;
    const grouped = new Map();
    for (const [left, right] of pairs) {
      const key = this._dateKey(left.start, timeZone);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push([left, right]);
    }
    const rows = [...grouped.entries()].slice(0, 6).map(([key, dayPairs]) => {
      const ifsMedian = this._median(dayPairs.map(([left]) => left.dry));
      const ecMedian = this._median(dayPairs.map(([, right]) => right.dry));
      const differences = dayPairs.map(([left, right]) => Math.abs(left.dry - right.dry));
      const medianDifference = this._median(differences);
      const maxDifference = Math.max(...differences);
      const disagreement = maxDifference >= .2 ? "deutlich uneinig" : "ähnlich";
      return `<div class="compare"><strong>${this._escapeText(new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone }).format(new Date(`${key}T12:00:00Z`)))}</strong><span>IFS Median ${Math.round(ifsMedian * 100)} %</span><span>EC46 Median ${Math.round(ecMedian * 100)} %</span><small>Δ Median ${Math.round(medianDifference * 100)} Pkt., max. ${Math.round(maxDifference * 100)} Pkt. · ${disagreement} · ${dayPairs.length} exakte Fenster</small></div>`;
    }).join("");
    return `<section class="overlap"><h3>IFS/EC46 · Tag 10–15</h3><p>Nur exakt gleiche ${hours}-h-Zeiträume. Tageszeile: Median der getrennten Modellwerte und Spannweite ihrer absoluten Abweichung.</p>${rows}</section>`;
  }

  _ec46Weeks(models, timeZone) {
    const ec46 = models.find(model => model.key.toLowerCase().includes("ec46"));
    if (!ec46) return "";
    const origin = this._origin(models);
    const groups = new Map();
    for (const window of ec46.windows) {
      if (window.dry == null) continue;
      const day = Math.floor((window.start - origin) / 86400000) + 1;
      if (day < 16 || day > 46) continue;
      const start = 16 + Math.floor((day - 16) / 7) * 7;
      const end = Math.min(46, start + 6);
      const key = `${start}-${end}`;
      if (!groups.has(key)) groups.set(key, { start, end, windows: [] });
      groups.get(key).windows.push(window);
    }
    const weeks = [...groups.values()].slice(0, 5);
    if (!weeks.length) return "";
    const provenance = [ec46.provider, ec46.snapshot ? `Snapshot ${this._formatDate(ec46.snapshot, timeZone)}` : ""].filter(Boolean).join(" · ");
    return `<section class="model seasonal"><div class="section-head"><div><h3>EC46 · Wochenorientierung Tag 16–46</h3><small>Keine Wochenprognose: gezeigt werden Median und Spanne der rollierenden ${this._selectedHours}-h-Trockenwahrscheinlichkeiten innerhalb der Woche${ec46.cadence ? ` · native ${ec46.cadence} h-Kadenz` : ""}.</small></div><small>${this._escapeText(provenance)}</small></div><div class="weeks">${weeks.map(week => {
      const values = week.windows.map(window => window.dry);
      const median = this._median(values), minimum = Math.min(...values), maximum = Math.max(...values);
      return `<div><strong>Tag ${week.start}–${week.end}</strong><span>Median ${Math.round(median * 100)} %</span><small>Spanne ${Math.round(minimum * 100)}–${Math.round(maximum * 100)} % · ${values.length} rollierende Fenster</small></div>`;
    }).join("")}</div></section>`;
  }

  _openMoreInfo() {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._config.entity }, bubbles: true, composed: true }));
  }

  _captureHorizontalScroll() {
    const read = selector => {
      const element = this.shadowRoot?.querySelector?.(selector);
      return Number.isFinite(element?.scrollLeft) ? element.scrollLeft : 0;
    };
    return { days: read(".days"), weeks: read(".weeks") };
  }

  _restoreHorizontalScroll(positions) {
    if (!positions) return;
    for (const [selector, left] of [[".days", positions.days], [".weeks", positions.weeks]]) {
      const element = this.shadowRoot?.querySelector?.(selector);
      if (element && left > 0) element.scrollLeft = left;
    }
  }

  _bind() {
    this.shadowRoot.querySelectorAll?.("button[data-hours]").forEach(button => button.addEventListener("click", () => {
      this._selectedHours = Number(button.dataset.hours);
      this._render();
    }));
    this.shadowRoot.querySelector?.("button.entity")?.addEventListener("click", () => this._openMoreInfo());
  }

  _message(message) {
    this.shadowRoot.innerHTML = `<ha-card><div class="message">${this._escapeText(message)}</div></ha-card><style>.message{padding:18px;color:var(--secondary-text-color)}</style>`;
  }

  _render(preserveHorizontalScroll = false) {
    if (!this._config || !this.shadowRoot) return;
    const scrollPositions = preserveHorizontalScroll ? this._captureHorizontalScroll() : null;
    const state = this._hass?.states?.[this._config.entity];
    if (!state) return this._message(`Entität ${this._config.entity} nicht gefunden.`);
    const entityUnavailable = ["unavailable", "unknown"].includes(String(state.state));
    const attributes = state.attributes || {};
    const models = this._windows(this._planningModels(attributes), this._selectedHours || 24);
    if (!models.length) return this._message(entityUnavailable
      ? "Planungsprognose derzeit nicht verfügbar."
      : `Keine ${this._selectedHours || 24}-Stunden-Planungsfenster verfügbar.`);
    const timeZone = attributes.site_timezone || attributes.timezone || "UTC";
    const stale = attributes.upstream_stale === true || attributes.forecast_planning_stale === true
      || models.some(model => model.stale || model.windows.some(window => window.stale));
    const partial = models.some(model => model.windows.some(window => window.coverage != null && window.coverage < .999));
    const best = this._heroBest(models, timeZone);
    const title = this._config.title || "Ernte- und Trockenfenster";
    const bestText = best ? `${best.model.label}: ${this._formatWindow(best.window, timeZone)} · ${Math.round(best.window.dry * 100)} % Trockenwahrscheinlichkeit` : "Keine Trockenwahrscheinlichkeit verfügbar";
    this.shadowRoot.innerHTML = `<ha-card><div class="content">
      <div class="head"><div><button class="entity" type="button"><h2>${this._escapeText(title)}</h2><small>${this._escapeText(attributes.friendly_name || this._config.entity)} · Details</small></button></div><div class="switch" role="group" aria-label="Fensterlänge"><button data-hours="24" class="${this._selectedHours === 24 ? "active" : ""}" aria-pressed="${this._selectedHours === 24}">24 h</button><button data-hours="48" class="${this._selectedHours === 48 ? "active" : ""}" aria-pressed="${this._selectedHours === 48}">48 h</button></div></div>
      <div class="summary"><strong>${this._escapeText(bestText)}</strong><span>${best ? `Bestes ${this._selectedHours}-h-Fenster der nächsten sieben verfügbaren ${this._escapeText(best.model.label)}-Starttage · ${this._dryLabel(best.window.dry)}` : ""}${entityUnavailable ? " · 24-h-Zustand nicht verfügbar" : ""}${stale ? " · Snapshot veraltet" : ""}${partial ? " · unvollständige Abdeckung markiert" : ""}</span></div>
      <p class="legend">Trockenwahrscheinlichkeit: höher = trockener. P50 und P10–P90 sind Niederschlagsmengen.</p>
      ${this._nearFutureSection(models, this._selectedHours, timeZone)}
      ${this._overlap(models, this._selectedHours, timeZone)}
      ${this._ec46Weeks(models, timeZone)}
    </div></ha-card><style>${this._styles()}</style>`;
    this._bind();
    // This write targets only an inner overflow container; it never reads or
    // writes document/window scroll state and never changes focus.
    this._restoreHorizontalScroll(scrollPositions);
  }

  _styles() {
    return `.content{padding:18px;color:var(--primary-text-color)}.head,.section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}h2,h3,p{margin:0}h2{font-size:21px}h3{font-size:16px}.entity{padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.entity small,.section-head small,.legend,.model-line small,.summary span,.overlap p,.compare small,.weeks small{color:var(--secondary-text-color)}.entity:focus-visible,button:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}.switch{display:flex;gap:4px;padding:3px;border-radius:9px;background:var(--secondary-background-color)}.switch button{border:0;border-radius:7px;padding:6px 10px;background:transparent;color:inherit;font:inherit;cursor:pointer}.switch .active{background:var(--secondary-color,var(--primary-color));color:var(--text-primary-color)}.summary{display:grid;gap:3px;margin:14px 0 6px;padding:11px 12px;border-left:4px solid var(--primary-color);background:var(--secondary-background-color);border-radius:8px}.legend{font-size:12px;margin:8px 0 14px}.model,.overlap{display:grid;gap:10px;padding:13px 0;border-top:1px solid var(--divider-color)}.section-head{align-items:baseline}.section-head>small{max-width:48%;text-align:right;font-size:11px}.days{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:8px;overflow-x:auto;padding-bottom:2px}.day{display:grid;align-content:start;gap:7px;padding:9px;border:1px solid var(--divider-color);border-radius:10px;background:var(--card-background-color)}.day>strong{font-size:13px}.model-line{display:grid;grid-template-columns:auto 1fr;gap:3px 7px;font-size:12px}.model-line strong{font-size:11px}.model-line>span{font-variant-numeric:tabular-nums;text-align:right}.model-line i{grid-column:1/-1;height:5px;border-radius:4px;background:var(--secondary-background-color);overflow:hidden}.model-line i b{display:block;height:100%;border-radius:inherit;background:var(--primary-color)}.unknown i b{background:var(--disabled-text-color)}.model-line small{grid-column:1/-1;font-size:10px;line-height:1.3}.seasonal{border-left:3px solid var(--secondary-text-color);padding-left:10px}.overlap{margin-top:2px}.overlap h3{font-size:15px}.overlap p{font-size:12px}.compare{display:grid;grid-template-columns:minmax(92px,1fr) 1fr 1fr;gap:4px 8px;font-size:12px;padding:8px;background:var(--secondary-background-color);border-radius:7px}.compare span{font-variant-numeric:tabular-nums}.compare small{grid-column:1/-1;font-size:10px}.weeks{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;overflow-x:auto}.weeks>div{display:grid;gap:3px;padding:9px;border-radius:8px;background:var(--secondary-background-color)}.weeks span{font-weight:650;font-variant-numeric:tabular-nums}.weeks small{font-size:10px;line-height:1.3}@media(max-width:560px){.head{align-items:stretch;flex-direction:column}.switch{align-self:flex-start}.section-head{align-items:flex-start;flex-direction:column}.section-head>small{max-width:none;text-align:left}.compare{grid-template-columns:1fr 1fr}.compare strong{grid-column:1/-1}}`;
  }
}

if (!customElements.get("nhz-climate-range-card")) customElements.define("nhz-climate-range-card", NhzClimateRangeCard);
if (!customElements.get("nhz-precipitation-chart")) customElements.define("nhz-precipitation-chart", NhzPrecipitationChart);
if (!customElements.get("nhz-climate-ventilation-card")) customElements.define("nhz-climate-ventilation-card", NhzClimateVentilationCard);
if (!customElements.get("nhz-climate-dry-window-card")) customElements.define("nhz-climate-dry-window-card", NhzClimateDryWindowCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "nhz-climate-range-card")) {
  window.customCards.push({
    type: "nhz-climate-range-card",
    name: "NHZ Climate Range Card",
    description: "Gemeinsame Zeitraumwahl für NHZ-Klimavergleiche",
    version: "0.14.2",
  });
}
if (!window.customCards.some(card => card.type === "nhz-climate-ventilation-card")) {
  window.customCards.push({
    type: "nhz-climate-ventilation-card",
    name: "NHZ Climate Ventilation Card",
    description: "Klickbare Lüftungsbewertung je Raum mit Stabilisierung",
    version: "0.14.2",
  });
}
if (!window.customCards.some(card => card.type === "nhz-climate-dry-window-card")) {
  window.customCards.push({
    type: "nhz-climate-dry-window-card",
    name: "NHZ Climate Dry Window Card",
    description: "Getrennte IFS- und EC46-Trockenfenster für die Einsatzplanung",
    version: "0.14.2",
  });
}
