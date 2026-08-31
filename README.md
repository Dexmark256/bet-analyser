# Bet Tracker

A football bet tracker: log bets (including accumulators) and match results
manually, and see team form, head-to-head records, and betting analysis build
up over time. Works fully offline and stores everything in your browser's
local storage — no backend, no API keys.

## Files in this project

Everything sits flat at the top level — no subfolders to worry about:

```
index.html       entry point
main.jsx          React bootstrap
App.jsx           the whole app
manifest.json     app icons + name (embedded, no separate image files)
package.json      dependencies
vite.config.js    build config
```

This flat structure is intentional: nested folders are the most common reason
uploads to GitHub go wrong (a subfolder silently not coming along for the
ride). With everything at the root, there's nothing to lose.

## Run it locally first (optional but recommended)

You'll need [Node.js](https://nodejs.org) installed.

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Push to GitHub (the reliable way)

Open a terminal in this folder and run:

```bash
git init
git add .
git commit -m "bet tracker"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main --force
```

This is far more reliable than dragging files into GitHub's website — `git`
guarantees every file makes it, in the right place, every time.

After pushing, refresh your GitHub repo page and confirm you see all 6 files
listed above at the top level (not inside any folder).

## Deploy for free (Vercel)

```bash
npm install -g vercel
vercel
```

Follow the prompts (accept the defaults — it auto-detects Vite). You'll get a
live URL like `bet-tracker-yourname.vercel.app`.

If you connected the GitHub repo to Vercel already, just pushing to `main`
will trigger a redeploy automatically — no need to run `vercel` again.

## Install it on your phone like an app

1. Open your deployed URL in Safari (iPhone) or Chrome (Android).
2. **iPhone:** tap Share → "Add to Home Screen".
3. **Android:** tap the menu (⋮) → "Add to Home screen" or "Install app".

## Important notes

- **Your data lives in the browser it's used in** — it doesn't sync across
  devices. Use Settings → Export in the app to back up your data as JSON or
  CSV periodically.
- Clearing your browser's site data for this app will also clear your bets.
- If the build fails again with a "failed to resolve import" error, it almost
  always means a file didn't make it to GitHub — check the repo page and
  compare against the file list above.
