# Calorie Tracker verification map

This directory is the maintained source for verifying user-facing behavior of Calorie Tracker. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs launch --port 5199`.
- Run `… doctor` and require `"ok": true` and `"ownedByThisHelper": true`.
- Open MCP `new_page` at the helper `url` with `isolatedContext` equal to the helper's `isolatedContext` so IndexedDB is disposable and not the user's daily profile.
- Never drive an instance that was not started by this verification run.
- Start every recipe from an empty isolated store unless the feature file says otherwise (use **Clear all data** on Settings if a prior proof left state in the same isolated context name).

## Driving conventions

- Prefer a11y snapshot names over CSS selectors or coordinates.
- Treat every MCP step as literal: click/fill the `uid` from the **latest** `take_snapshot`.
- Gallery uploads use `.cursor/skills/verify-calorie-tracker/helpers/fixtures/meal-sample.png`.
- Restore or clear disposable data after a mutation. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with Today/History/Settings chrome visible.
- Mutation proof includes a second user-facing view (reload route or visit another page) that still shows the change.
- Record the feature ID and entry point with every artifact under `artifacts/<feature-id>/`.
- Report an unreachable path with the attempted step and unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then exactly these H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with chrome-devtools`, `Gotchas`.

## Features

- [Today macros and empty state](./today-macros.md) — Today heading, calorie summary, empty meals copy, Add entry.
- [Settings API key](./settings-api-key.md) — save, show/hide, clear key, persistence across reload.
- [Add meal queue](./add-meal-queue.md) — meal photo / nutrition label (New) dialog, gallery upload, queue without requiring Gemini success.
- [Deterministic previous label reuse](./deterministic-label-reuse.md) — Previous tab + cached `labelNutrition` scales grams without Gemini.
- [History browse](./history-browse.md) — Month / Week / Day tabs and empty day copy.
- [Clear local data](./clear-local-data.md) — danger-zone wipe via confirm dialog.
