# Bet Tracker

A football bet tracker: log bets and match results manually, and see team form,
head-to-head records, and betting analysis build up over time. Works fully offline
and stores everything in your browser's local storage — no backend, no API keys.

## Run it locally first (optional but recommended)

You'll need [Node.js](https://nodejs.org) installed (any recent version).

```bash
npm install
npm run dev
```

This opens the app at `http://localhost:5173`. Open that on your phone (same wifi
network, use your computer's local IP instead of localhost) to test it before deploying.

## Deploy it for free (Vercel)

1. Create a free account at [vercel.com](https://vercel.com).
2. Install the Vercel CLI: `npm install -g vercel`
3. From this folder, run: `vercel`
4. Follow the prompts (accept the defaults — it auto-detects Vite).
5. You'll get a live URL like `bet-tracker-yourname.vercel.app`.

Alternative: drag-and-drop deploy. Run `npm run build`, then drag the generated
`dist` folder onto [app.netlify.com/drop](https://app.netlify.com/drop) — no
account needed for a quick test link.

## Install it on your phone like an app

1. Open your deployed URL in Safari (iPhone) or Chrome (Android).
2. **iPhone:** tap the Share button → "Add to Home Screen".
3. **Android:** tap the menu (⋮) → "Add to Home screen" or "Install app".
4. It now opens full-screen from your home screen icon, no browser bar — feels
   like a real installed app.

## Important notes

- **Your data lives in the browser it's used in.** If you install it on your phone
  and later open the same URL on a different device, you'll see a fresh empty app —
  local storage doesn't sync across devices. Use Settings → Export to back up your
  data as JSON or CSV periodically.
- Clearing your browser's site data/cache for this app will also clear your bets.
- If you want your data to sync across devices, that requires adding a real backend
  (a database + a login system) — let me know if you want help with that next.

## Project structure

```
index.html          entry HTML
src/main.jsx         React bootstrap
src/App.jsx           the whole app
vite.config.js        build + PWA config
public/icon-*.png     app icons (placeholders — swap these for your own)
```
