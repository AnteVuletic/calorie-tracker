# Today macros and empty state

Today shows the local date, a calorie/macro summary, today's meal list (or empty guidance), and an Add control that opens the meal dialog.

## Sub-features

- `today-chrome` shows eyebrow `Today`, a date heading, and bottom nav `Today` active.
- `today-empty` shows zero macros and copy `No meals yet. Snap a photo to log your first one.` when the day has no meals.
- `today-add-opens` opens the Add meal dialog from the Today `Add` button.

## How to get to it (user POV)

- Open the app at `/` or choose bottom nav **Today**.

## Driving it with chrome-devtools

Preconditions:

- Doctor is green for this run's URL.
- Isolated context has no meals for today (fresh context or after Clear all data).

- **Open Today.** MCP `new_page` (or `navigate_page` type `url`) to `http://127.0.0.1:5199/`. Snapshot shows text `Today`, heading with today's display date, `Calories` / `Protein` / `Carbs` / `Fat` at zero, heading `Meals`, and `No meals yet. Snap a photo to log your first one.`
- **Open Add.** Click the button named `Add`. Snapshot shows dialog title `Add meal` and choices `Meal photo` and `Nutrition label`.
- **Dismiss.** Click `Close` (sr-only on the dialog X). Dialog is gone; empty meals copy remains.
- **Proof.** Save snapshot to `artifacts/today-macros/today.aria.txt` and screenshot to `artifacts/today-macros/today.png`. Both show Today chrome and the empty-state sentence.

## Gotchas

- Macro card always shows `Calories` (and Protein/Carbs/Fat) even when zero — assert empty list copy, not absence of the summary.
- Pending meals appear in the list but do not change totals (`sumMeals` counts only Logged).
- Date heading text depends on the machine locale/format from `formatDisplayDate`; assert the `Today` eyebrow plus empty copy rather than a hard-coded weekday string.
- Do not treat a leftover meal from a reused isolated context name as a Today failure; clear data first.
