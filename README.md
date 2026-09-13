# NHZ Climate Range Card

Home Assistant dashboard card distributed through a public GitHub repository. Install it as a HACS custom Dashboard repository; it is not listed in the HACS default catalog. The card contains no hostnames, tokens, or site credentials.

## Dependencies and installation

- The NHZ Climate HA integration and its climate-profile entities.
- `apexcharts-card` for the general-variable charts.
- Add `nhzgh/nhz-climate-range-card` in HACS → Custom repositories → Dashboard, then install it.
- Register `/hacsfiles/nhz-climate-range-card/nhz-climate-range-card.js` as a JavaScript module if HACS does not do so automatically.

Use `type: custom:nhz-climate-range-card`. Each graph needs a title, explanation, profile entity, and compatible source entity. For precipitation charts, also set `monthly_comparison_entity` to the corresponding `sensor.nhz_climate_<site>_<variable>_monthly_comparison`. The card never reads the API token directly.

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
    precipitation_view: true
```

For rain and all-phase precipitation, 7/30 days show cumulative actual versus the 1970–2025 reference. The 90/365-day views show local-month totals with P10–P90, historical mean, actual, delta, coverage, and source. A year is a rolling 365 local days, so edge months are partial. The `rain` actual can combine a configured local gauge, ERA5, and archived ICON hour by hour. A liquid-only gauge must not be used for all-phase `precipitation`. Incomplete coverage is marked, not silently interpreted as zero.
