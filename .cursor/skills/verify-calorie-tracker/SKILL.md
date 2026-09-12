---
name: verify-calorie-tracker
description: Drive the Calorie Tracker PWA in a real browser (Chrome DevTools MCP), prove Today/History/Settings and meal-queue flows with screenshots and a11y snapshots. Use when verifying user-facing changes before shipping.
---

# Verify Calorie Tracker

Project-local verification for the **Calorie Tracker** React+Vite PWA. Agents read this cold mid-task. Prefer this skill over inventing a one-off browser checklist.

**Repo root:** the directory that contains `package.json` with `"name": "calorie-tracker"`. All helper commands below are relative to that root.

**Harness:** Chrome DevTools MCP (`plugin-devtools-for-agents-chrome-devtools` / server name `chrome-devtools`) plus `helpers/control-calorie-tracker.mjs` for Vite process lifecycle.

## Launch

1. From repo root:

```bash
node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs launch --port 5199
```

2. Ready when the helper prints JSON with `"doctor":"pass"` and `url` like `http://127.0.0.1:5199/`. Vite also appends to `.cursor/skills/verify-calorie-tracker/.run/vite.log`.
3. Open an **isolated** browser context (do not reuse the user's everyday profile):

- MCP `new_page` with `url` = the helper `url`, and `isolatedContext` = the helper's `isolatedContext` (e.g. `calorie-tracker-verify-ct-…`).
- Same-origin IndexedDB is shared only inside that isolated context name. Different `isolatedContext` values do not share meals or API keys.

4. Teardown: see **Cleanup**. Never `taskkill` by image name (`node.exe` / `vite`); only kill the pid recorded by the helper.

Default verify port is **5199** so it does not collide with everyday `npm run dev` on **5173** or `preview` on **4173**.

## Doctor

Read-only health check before any drive:

```bash
node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs doctor
```

Require JSON `"ok": true`, matching `url`/`port`, and `"ownedByThisHelper": true`. If the URL answers but the recorded pid is dead, **refuse to drive** — that may be a foreign Vite on the same port.

Optional in-page check after opening the isolated tab: MCP `take_snapshot` should show nav links **Today**, **History**, **Settings** and page chrome for the route you opened.

## Drive

1. Run **Doctor**.
2. Open the feature map: `.cursor/skills/verify-calorie-tracker/features/README.md`, then the matching feature file.
3. Drive with Chrome DevTools MCP only against the instance this run launched:
   - `list_pages` / `new_page` / `navigate_page`
   - `take_snapshot` → use returned `uid` values
   - `click`, `fill`, `upload_file`, `press_key`, `wait_for`
   - `handle_dialog` for `window.confirm` (Clear all data)
   - `evaluate_script` only for read-only IndexedDB probes when the UI cannot show the side effect; never use it to bypass the user path to create meals.
4. Prefer accessible names from the snapshot: buttons **Add**, **Save**, **Clear key**, **Clear all data**, **Analyze** / **Save pending**, **Meal photo**, **Nutrition label**, **Camera**, **Gallery**, **Search**, **Back to list**; tabs **New** / **Previous**, **Month** / **Week** / **Day**; links **Today** / **History** / **Settings**; textbox **API key**, **Amount eaten**, **Extra context (optional)**; searchbox **Search previous labels…**; dialog titles **Add meal**, **Scan meal**, **Scan nutrition label**; sr-only **Close**, **Meal actions**, **Show key** / **Hide key**.
5. Stable routes: `/`, `/history`, `/settings` (local `base` is `/`).
6. Do **not** drive `http://127.0.0.1:5173` (or any URL not printed by this run's helper) unless doctor proves that pid is ours.

Fixture image for Gallery uploads: `.cursor/skills/verify-calorie-tracker/helpers/fixtures/meal-sample.png`.

## Evidence

Write proofs under:

`.cursor/skills/verify-calorie-tracker/artifacts/<feature-id>/`

For each proof:

| Artifact | How |
|----------|-----|
| A11y snapshot | MCP `take_snapshot` (inline is fine). Persist the text to `….aria.txt` under `artifacts/` via the Write tool if MCP `filePath` is blocked by workspace roots. |
| Screenshot | Prefer MCP `take_screenshot`. If `filePath` is blocked, run `node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs screenshot --out .cursor/skills/verify-calorie-tracker/artifacts/<feature-id>/<name>.png` (uses system Chrome headless; path should be absolute or repo-relative). App chrome (nav or page heading) must be visible. |
| Notes | Optional `notes.md` with feature id, entry point, and what changed |

**Proof standards**

- Exercise the real UI path (nav, dialogs, buttons). Do not insert meals via IndexedDB helpers or internal hooks.
- Capture the **action** and the **resulting state** (e.g. toast text + Settings reload still showing a saved key; or Today list gaining a **Pending** / **Logged** meal).
- Side effects: IndexedDB `calorie-tracker` stores `meals` / `settings`. Gemini network calls happen only when a scan actually runs online with a real key — a fake verify key must not be treated as a successful Logged scan.
- Mocks: none in-app. Offline queueing is a real user path (`Save pending` when offline). Live Gemini spend is optional; prefer proving queue/UI without calling Gemini unless the change under test requires a Logged meal.

## Cleanup

```bash
node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs cleanup
```

Kills only the recorded Vite pid (and its process tree on Windows via `taskkill /t`) and deletes `.cursor/skills/verify-calorie-tracker/.run/`. **Does not** delete `artifacts/`. Close isolated MCP pages when done so the next run starts clean; do not wipe the user's non-isolated browser profile.

## Helpers

| Command | Purpose |
|---------|---------|
| `node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs launch [--port 5199]` | Start Vite; write `.run/state.json` |
| `… doctor` | HTTP + pid ownership check |
| `… status` | Print state |
| `… cleanup` | Stop owned Vite; remove `.run/` only |
| `… screenshot --out <path> [--url url]` | Headless Chrome PNG into artifacts (fallback when MCP cannot write files) |

Invocation examples are literal. Do not reverse-engineer flags beyond `--port`, `--out`, and `--url`.
