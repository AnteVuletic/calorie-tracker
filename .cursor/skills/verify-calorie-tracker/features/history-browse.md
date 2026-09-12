# History browse

History shows All meals with Month, Week, and Day views, a period macro summary, and the selected day's meal list.

## Sub-features

- `history-open` reaches All meals via nav or `/history`.
- `history-tabs` switches Month / Week / Day.
- `history-empty-day` shows `No meals logged for …` when the selected day has no meals.

## How to get to it (user POV)

- Choose bottom nav **History**, or open `/history`.

## Driving it with chrome-devtools

Preconditions:

- Doctor is green.
- Isolated context may be empty (empty-day copy is the happy path for a fresh store).

- **Open History.** Navigate to `/history`. Snapshot shows eyebrow `History`, heading `All meals`, and tabs `Month`, `Week`, `Day`.
- **Week tab.** Click `Week`. Snapshot shows a week strip (weekday abbreviations) and a period macro title such as `Week of …` or a clamped date range.
- **Day tab.** Click `Day`. Snapshot shows calendar chrome and section `Meals that day` (or empty copy `No meals logged for …` for the selected date).
- **Return Month.** Click `Month`. Calendar and optional day kcal chips appear when meals exist. Meal list heading is `Selected day meals` (Month/Week also use that heading). Month/Week also show a `Period total: …` footer under the list.
- **Proof.** `artifacts/history-browse/history.aria.txt` and `history.png` with `All meals` and at least one of Month/Week/Day selected state visible.

## Gotchas

- Future days are disabled; do not treat that as a broken calendar.
- When the visible period includes future days, copy reads `Partial period — totals include only days through today.`
- Meal cards on History share the same actions as Today; mutating here is covered by add-meal / clear-data features, not this browse recipe.
