# NHZ Climate Range Card

Home Assistant dashboard card distributed through a public GitHub repository. Install it as a HACS custom Dashboard repository; it is not listed in the HACS default catalog. The card contains no hostnames, tokens, or site credentials.

Current feature version: **0.11.0**.

![Rolling precipitation comparison with monthly P10–P90 ranges, historical means, and local actuals](docs/precipitation-year.png)

Maintainers must publish every deployable version with the **Publish HACS
release** GitHub Actions workflow. HACS deployments must use that published
release; commits from the default branch, direct file copies and changed
content behind an existing release URL are not supported deployment methods.

## Dependencies and installation

- The NHZ Climate HA integration and its climate-profile entities.
- `apexcharts-card` for the general-variable charts.
- Add `nhzgh/nhz-climate-range-card` in HACS → Custom repositories → Dashboard, then install it.
- Register `/hacsfiles/nhz-climate-range-card/nhz-climate-range-card.js` as a JavaScript module if HACS does not do so automatically.

Use `type: custom:nhz-climate-range-card`. Each graph needs a title, explanation, profile entity, and compatible source entity. The declarative `display_mode` selects the visualization semantics: `general`, `cumulative`, or `cumulative_year`. The card never reads the API token directly.

```yaml
type: custom:nhz-climate-range-card
default_range: 30d
graphs:
  - title: Regen
    explanation: flüssiger Niederschlag
    variable: rain
    profile_entity: sensor.example_rain_climate_profile
    source_entity: sensor.example_rain_rate
    monthly_comparison_entity: sensor.nhz_climate_example_rain_monthly_comparison
    display_mode: cumulative_year
```

`cumulative_year` uses a cumulative IST-versus-mean curve for 7, 30, and 90 days. The rolling 365-day view is a sequence of local-month rows: the P10–P90 band, white mean marker, and IST point share a full-width bar; its mouseover carries P10/P90, coverage and source. The compact month label contains IST, historical mean and delta. A year always means 365 rolling local days, so edge months are partial.

`cumulative` uses the same cumulative curve for all non-today ranges, while `general` uses the normal variable chart. Snow can use either cumulative mode without a special variable name. For every cumulative mode, **Heute** deliberately displays a note: seven days are the smallest meaningful comparison window. The `rain` actual can combine a configured local gauge, ERA5, and archived ICON hour by hour. For all-phase `precipitation`, the integration replaces only the modelled liquid component with that gauge and retains the modelled solid-water equivalent. Incomplete coverage is marked, not silently interpreted as zero.

`precipitation_view` remains a compatibility alias for existing dashboards, but new configurations should use `display_mode`.

## Ventilation card

`custom:nhz-climate-ventilation-card` discovers the local NHZ Climate
ventilation decision entities through their `advisory_only` attribute. It
shows one clickable row per room plus a summary; clicking a row opens Home
Assistant's normal more-info dialog. The main value is always the last
confirmed recommendation. During the 15-minute stability interval, the
candidate, remaining time and its separate humidity/thermal assessment appear
as a secondary “Wird geprüft” block. When the advisory entity exposes the
optional indoor-climate projection attributes, each room also shows its compact
climate status, target deltas, and the estimated 1-hour and 8-hour result. A
theoretical air-only result is available as a mouseover labelled “Luftgrenze”.
Technical psychrometric values are intentionally kept out of the visible card.
Active rain or gust safety locks are labelled explicitly.

When the advisory entity publishes `recommended_action`, the room heading uses
the duration-aware label `Stoßlüften · N min`, `Lüften empfohlen`,
`Nachtlüften möglich`, `Nicht lüften`, or `Nicht erforderlich`. A configured
`recommended_duration_minutes` selects the corresponding 15-minute projection
(`15m`, `30m`, `45m`, `60m`) plus the `8h` projection; older `1h`/`8h`
attributes remain supported. Optional normalized target-distance values are
available as a heading mouseover and are not shown as technical card content.

```yaml
type: custom:nhz-climate-ventilation-card
title: Lüftung
```

To limit the card to selected rooms, pass their decision entity IDs explicitly:

```yaml
type: custom:nhz-climate-ventilation-card
title: Lüftung Erdgeschoss
entities:
  - sensor.example_living_room_window_decision
  - sensor.example_kitchen_window_decision
```
