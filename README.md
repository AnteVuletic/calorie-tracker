# Calorie Tracker PWA

Personal daily calorie tracker. Snap a meal photo, Gemini estimates calories/macros, everything stays on-device in IndexedDB for 30 days.

## Stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- IndexedDB (`idb`)
- Gemini vision (`@google/generative-ai`)
- Offline app shell via `vite-plugin-pwa`

## Develop

```bash
npm install
npm run dev
```

`npm run dev` listens on your LAN (`--host`). On the same Wi‑Fi, open the **Network** URL Vite prints (e.g. `http://192.168.x.x:5173`) in your phone’s browser.

Open Settings, paste your Gemini API key, then add a meal from Today.

## Preview production build on your phone

```bash
npm run build
npm run preview
```

Use the **Network** URL (port `4173`). Phone and PC must be on the same Wi‑Fi. If it doesn’t load, allow Node.js through Windows Firewall for private networks.

On iPhone: Safari → Share → **Add to Home Screen**. Note: full offline service-worker install needs HTTPS; over plain LAN HTTP the app still runs while your PC is serving it.

## Deploy (GitHub Pages)

Pushing to `master` builds and deploys via GitHub Actions.

Site URL: `https://<your-username>.github.io/calorie-tracker/`

In the GitHub repo: **Settings → Pages → Source → GitHub Actions**.

Restrict your Gemini API key HTTP referrer to that Pages origin in Google AI Studio.

## Privacy

- Meals, photos, and your API key are stored only in the browser (IndexedDB)
- Scan photos are sent to Google Gemini at analyze time
- Meals older than 30 days are deleted automatically
- Do not commit API keys (`.gitignore` already excludes `gemini ai key.txt` and `.env`)
- Restrict your Gemini key (HTTP referrer + API scope + spend cap) in Google AI Studio
