# Clear local data

Danger zone on Settings erases all meals and the saved API key after a browser confirm, then toasts success.

## Sub-features

- `clear-confirm` accepts the confirm and wipes local data.
- `clear-cancel` dismisses the confirm and leaves data intact.
- `clear-effect` Today returns to empty state and Settings key is empty.

## How to get to it (user POV)

- Settings → **Clear all data** under Danger zone.

## Driving it with chrome-devtools

Preconditions:

- Doctor is green.
- Seed something first (save the fake API key and/or queue one meal) so wipe is observable.

- **Cancel path.** On `/settings`, click `Clear all data`. Confirm text is `Delete all local data?`. MCP `handle_dialog` with `dismiss` (click may time out until the dialog is handled — that is expected). Key/meals remain.
- **Accept path.** Click `Clear all data` again. `handle_dialog` with `accept`. Wait for `All local data cleared`.
- **Confirm empty Settings.** Show key; field empty.
- **Confirm empty Today.** Navigate to `/` (wipe does not push a meals-changed event while you stay on Settings). Empty meals copy is back; macros at zero.
- **Proof.** `artifacts/clear-local-data/cleared.aria.txt` and `cleared.png` on Today empty state after wipe.

## Gotchas

- `window.confirm` must be handled via MCP `handle_dialog`; ignoring it blocks the page.
- Cleanup of the Vite process must not be confused with this feature — process cleanup never deletes `artifacts/`.
- Only run accept-wipe inside the disposable `isolatedContext` from this verify run.
