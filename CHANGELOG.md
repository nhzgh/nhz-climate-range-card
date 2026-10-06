# Changelog

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
