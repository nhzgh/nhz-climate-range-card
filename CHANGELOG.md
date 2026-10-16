# Changelog

## 0.13.0

- Add a dimensionally separate six-hour ICON/IFS precipitation comparison
  with IFS P10/P50/P90 and event probability in point details.
- Add compact absolute 24/48-hour planning summaries without blending them
  into the hourly precipitation chart.

## 0.12.0

- Add an hourly precipitation day view with forecast amounts as bars, actuals
  as a line, a now marker and six-hour probabilities for at least 0.5 mm.
- Keep the newest forecast overlay for elapsed hours to make model quality
  directly visible without persisting frozen chart runs.
- Improve the exploratory data viewer with session/local token storage,
  multiple selectable series, labelled axes, accessible point values and
  automatic mode adjustments.

## 0.11.0

- Render duration-aware ventilation actions such as `Stoßlüften · 30 min`
  and `Nachtlüften möglich`.
- Prefer the selected 15-minute projection and the 8-hour projection while
  retaining the previous 1-hour/8-hour contract as a fallback.
- Keep normalized target-distance details in the room heading mouseover.

## 0.10.0

- Add compact per-room indoor-climate status and target deltas to the
  ventilation card.
- Show available 1-hour and 8-hour temperature/humidity projections.
- Keep optional theoretical air-only values in the `Luftgrenze` mouseover.
- Remove the redundant bottom work-value notice.
