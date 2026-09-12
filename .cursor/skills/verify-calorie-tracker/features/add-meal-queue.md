# Add meal queue

Add meal lets the user choose meal photo or nutrition label (New), attach an image from Gallery or Camera, optionally enter portion/context, and queue a pending scan. Online with a key starts background analysis; offline (or missing key while online) follows the UI toasts documented below. Previous-label reuse with a nutrient cache is covered in [deterministic-label-reuse.md](./deterministic-label-reuse.md).

## Sub-features

- `add-choose-meal` opens Scan meal from Meal photo.
- `add-choose-label` opens Scan nutrition label from Nutrition label (New tab).
- `add-gallery` attaches the fixture image and shows a preview.
- `add-queue-pending` queues a meal and returns to Today with a pending card (does not require Logged/Gemini success).

## How to get to it (user POV)

- On Today, choose **Add**, then **Meal photo** or **Nutrition label**.

## Driving it with chrome-devtools

Preconditions:

- Doctor is green; isolated context preferred empty.
- Fixture exists at `.cursor/skills/verify-calorie-tracker/helpers/fixtures/meal-sample.png`.
- For online Analyze without a Gemini spend: either stay offline (button label `Save pending`) or accept that a missing key while online toasts `Add your Gemini API key in Settings` and does **not** create a meal — save a throwaway key first if you need a queued card online.

- **Open dialog.** From Today click `Add`. Title `Add meal`.
- **Meal path.** Click `Meal photo`. Title `Scan meal`. Camera and Gallery are both available; click `Gallery` (or `upload_file` on the file-chooser target). Attach `helpers/fixtures/meal-sample.png`. Snapshot shows `Meal preview` instead of `No photo yet` (preview may take a moment after upload).
- **Optional context.** Fill `Extra context (optional)` with `verify harness sample`.
- **Queue.** Click `Analyze` (online) or `Save pending` (offline). Expect toast `Queued for analysis` or `Saved offline — will scan when you're back online`. Dialog closes.
- **Result on Today.** Snapshot shows a meal card with status `Pending` or `Processing` (or `Logged` / `Fail` if a real or fake key already finished). Empty-state copy is gone. A fake key that fails Gemini is still a valid queue proof if the card appeared.
- **Label New path (separate run or after clear).** Add → `Nutrition label` → New → Gallery + fixture → fill `Amount eaten` with `100` → Analyze/Save pending. Same Today proof.
- **Proof.** `artifacts/add-meal-queue/queued.aria.txt` and `queued.png` showing the meal list with a non-empty card. Do not claim `Logged` macros unless the card status is `Logged` and calories are non-zero from a real scan.

## Gotchas

- Hidden file inputs may not appear in a compact a11y snapshot; click the visible `Gallery` button and use `upload_file` on the file-chooser target the MCP associates with that click, or evaluate only as a last resort to set the input files — still trigger through Gallery.
- Nutrition label New requires a parsed portion (`100` or `1 teaspoon`); Analyze stays disabled without it.
- Online without an API key blocks *pending* queueing with a toast — that is a valid negative proof for key gating, not a queue success. Cached Previous + grams can still log without a key (see deterministic-label-reuse).
- Gemini `Logged` success costs API usage and is flaky offline; default proofs stop at Pending/queued UI.
