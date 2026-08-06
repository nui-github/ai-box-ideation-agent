---
name: run
description: Launch this Angular + Express app (UX Flow AI) locally for preview. Use whenever asked to run, start, or preview this app.
---

# Run UX Flow AI locally

Angular 18 frontend + Express backend (`server.mjs`) calling Gemini API. Dev mode runs both concurrently: Express on :3001 (API), Angular dev server on :3000 (proxies `/api/*` to :3001 via `proxy.conf.json`).

## Prerequisites

- `GEMINI_API_KEY` required. Check `.env.local` first:
  ```bash
  cat .env.local 2>/dev/null
  ```
  If missing or empty, ask the user for a Gemini API key before starting — the AI features (`/api/design`, `/api/models/usage`) fail without it. Don't guess or reuse a key from another session.

- `node_modules` must be installed:
  ```bash
  ls node_modules 2>/dev/null | wc -l
  ```
  If 0, run `npm install` first (takes ~20s, ~900 packages).

## Launch

Ports 3000/3001 are the most common failure — a previous session's process often lingers. Always clear them before starting:

```bash
lsof -ti:3000 -ti:3001 | xargs -r kill -9
```

Then start dev mode in the background, sourcing the key from `.env.local`:

```bash
cd /Users/nui.kunawut/Desktop/ai-box-ideation-agent
export $(grep -v '^#' .env.local | xargs) && npm run dev > /tmp/ai-box-dev.log 2>&1 &
disown
sleep 10
tail -n 40 /tmp/ai-box-dev.log
```

Success looks like:
```
Server listening on port 3001
...
➜  Local:   http://localhost:3000/
```

If you see `Port 3000 is already in use` — the kill step above was skipped or didn't catch a zombie process. Re-run the `lsof` kill command and retry.

## Preview

Open `http://localhost:3000` in the Browser pane (`preview_start` / `navigate`). Do NOT open :3001 directly — that's the API-only Express server with no static assets in dev mode.

## Verify it's actually working (not just launched)

Type any requirement into the chat input and send it — confirms the Gemini API key is valid and the `/api/design` streaming endpoint responds. A blank page or an error toast means the key is missing/invalid, not that the servers failed to start.

## Stopping

```bash
lsof -ti:3000 -ti:3001 | xargs -r kill -9
```
