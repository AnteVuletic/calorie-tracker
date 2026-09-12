# Settings API key

Settings lets the user paste a Gemini API key into IndexedDB, show or hide it, clear it, and see confirmation toasts. Saving does not validate the key with Google. If the user is online and has pending meals, Save can start background scans (real Gemini calls) — use an empty isolated store for key-only proofs.

## Sub-features

- `settings-open` reaches Preferences via nav or `/settings`.
- `settings-save` stores the draft key and toasts `API key saved`.
- `settings-show-hide` toggles the password field via `Show key` / `Hide key`.
- `settings-clear` removes the key and toasts `API key cleared`.
- `settings-persist` still shows the saved value after reload (before clear).

## How to get to it (user POV)

- Choose bottom nav **Settings**, or open `/settings`.

## Driving it with chrome-devtools

Preconditions:

- Doctor is green.
- Use a disposable fake key only, e.g. `verify-skill-test-key-not-real` — never a production secret in artifacts.

- **Open Settings.** Navigate to `/settings`. Snapshot shows eyebrow `Settings`, heading `Preferences`, and `Gemini API key`.
- **Save key.** Fill textbox `API key` with `verify-skill-test-key-not-real`. Click `Save`. Wait for text `API key saved`.
- **Show key.** Click `Show key`. The field reveals the saved value.
- **Confirm persistence.** `navigate_page` reload (or reopen `/settings`). Fill/show again if needed; the key value is still present.
- **Clear key.** Click `Clear key`. Wait for `API key cleared`. Show key; the field is empty.
- **Proof.** Artifacts under `artifacts/settings-api-key/`: snapshot after save (`saved.aria.txt`), screenshot with Preferences visible (`saved.png`), and snapshot after clear (`cleared.aria.txt`).

## Gotchas

- The input is `type=password` until Show key. The control is icon-only with accessible name `Show key` / `Hide key` — assert via snapshot name or revealed value, not visible button text in a screenshot.
- A successful save toast is not proof of Gemini access.
- Do not commit real keys into `artifacts/` or chat logs.
