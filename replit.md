# Food Rescue HQ

A single-page demo for coordinating the rescue of surplus conference food before its safety deadline.

## Run

- Graduated web app: `artifacts/food-rescue-hq`, served at `/food-rescue-hq/` by its managed workflow. It retains the selected canvas design and uses the shared incident service through `/food-rescue-hq/api`.
- The original `/` dashboard and the independent canvas copy are preserved.

- `npm start` or `node server.js` with `PORT` set.
- The existing managed service serves both the dashboard at `/` and endpoints at `/api`.
- Frontend: plain HTML, CSS, and vanilla JavaScript in `public/`.
- Express implementation: `artifacts/api-server/server.js`, loaded by the root `server.js`.
- No database, authentication, Twilio, or Deepgram integration.

## State

State lives in memory and is atomically written to `data/state.json` after every change. Startup reloads it and immediately expires any overdue active incident. Derived counters are never saved.

Local JSON persistence supports workspace process restarts; it is not a promise of durable storage across cloud deployments or multiple instances.

## Scope and decisions

- The user confirmed this is a web dashboard, not a mobile app.
- Keep one page and only the three requested demo actions; do not add extra features or messaging integrations.
- Preserve the provided workspace infrastructure rather than destructively replacing it. The application itself uses only Express and plain browser files.
- The brief contains truncated lines. Interpret restart persistence as local JSON persistence, and fast-forward as a deadline 60 seconds from now.
- Placeholder volunteers are for display only. No simulated claims, pickups, or texts.
- UI: light grey page, white cards, green accent `#2F6B50`, no borders or shadows, card radius at most 12px.

## Manual demo

1. Open `/`; expect Idle and “All clear. No surplus food reported.”
2. Click Create sample incident; expect Urgent, approximately 45:00, and 400 unclaimed tacos.
3. Click Fast-forward; expect 01:00, then Expired after one minute.
4. Click Reset; expect Idle.
5. Create an incident and restart the workflow; the incident and original deadline should remain.
