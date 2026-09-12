# Deterministic previous label reuse

Nutrition label **Previous** lets the user pick a logged label meal, enter an amount, and scale macros from the saved printed nutrients when `labelNutrition` is present — without calling Gemini.

## Sub-features

- `previous-tab` opens the Previous list (search, empty copy, or logged label entries).
- `previous-grams-cached` with a usable `labelNutrition` cache and a gram amount logs immediately (`Meal logged`) with scaled macros.
- `previous-uncached-fallback` without a usable cache queues the label image for AI OCR (same as New), then persists `labelNutrition` for later picks.

## How to get to it (user POV)

- Today → **Add** → **Nutrition label** → **Previous**.

## Driving it with chrome-devtools

Preconditions:

- Doctor is green.
- For the cached path: isolated store already has at least one **Logged** nutrition-label meal with `labelNutrition` (basisGrams + macros). Seed only through a prior real New-label OCR (or a previous verify run that left that meal). Do not invent meals via IndexedDB helpers.
- For empty Previous only: wipe first (**Clear all data**).

- **Empty Previous.** After wipe: Add → Nutrition label → Previous. Snapshot shows `No previous nutrition labels yet. Scan one in the New tab.`
- **Cached grams path.** With a cached logged label present: Previous → pick the entry → fill `Amount eaten` with a plain gram value (e.g. `200`) → **Analyze**. Expect toast `Meal logged` and a Today card `LOGGED` whose kcal/macros equal `scaleLabelNutrition(cache, grams)` (e.g. 59 per 100g → 118 kcal at 200g). Dialog closes without a Pending card.
- **No Gemini.** After Analyze, `list_network_requests` for fetch/xhr should show no new `generativelanguage.googleapis.com` calls for that action. Online Analyze with cache does **not** require a valid API key.
- **Proof.** `artifacts/deterministic-label-reuse/` — snapshot + screenshot of the Logged scaled meal (and optional notes of the expected scale math).

## Gotchas

- Previous lists only logged label meals (`getLoggedLabelMeals`), not meal-photo scans or pending/fail cards.
- Free-text portions (not plain grams) still call AI for gram estimation even when the cache exists; default proofs use numeric grams.
- Meals logged before `labelNutrition` existed need one New-tab OCR to seed the cache; then reuse is deterministic.
- Fake verify API keys must not be treated as successful OCR seeds — only a real Logged label with cache proves the scale path.
