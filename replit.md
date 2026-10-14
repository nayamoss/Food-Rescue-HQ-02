# Food Rescue HQ

A single-page demo for coordinating the rescue of surplus conference food before its safety deadline.

## Run

- Graduated web app: `artifacts/food-rescue-hq`, served at `/food-rescue-hq/` by its managed workflow. It retains the selected canvas design and uses the shared incident service through `/food-rescue-hq/api`.
- The original `/` dashboard and the independent canvas copy are preserved.

- `npm start` or `node server.js` with `PORT` set.
- The existing managed service serves both the dashboard at `/` and endpoints at `/api`.
- Frontend: plain HTML, CSS, and vanilla JavaScript in `public/`. The Rescue chat UI lives in `public/rescue-chat.js` and `public/styles.css`; the graduated app at `/food-rescue-hq/` imports the same files.
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
- UI: Pocket HQ direction, flow 3 (Rescue chat). Phone first: a pinned timer bar, one rescue thread, quick-reply chips and a pull-up status sheet. From 1024px wide it becomes three columns (team, thread, status). Apricot `#FFE7D3`, plum `#2B1B3D`, chili `#F2541B`, violet `#6A4BEA`, mint `#108A5C`; Bricolage Grotesque and Figtree.
- `POST /api/updates { text }` adds a coordinator update (1 to 280 characters) to the thread. Nothing is texted yet. The feed keeps the newest 200 entries.

## Manual demo

1. Open `/`; expect “All clear” in the pinned bar and an HQ message saying no surplus food is reported.
2. Tap Start sample rescue; expect “Rescue open”, approximately 45:00, and 400 unclaimed.
3. Type an update and send it; expect it in the thread. Tap “Who’s free?”; expect the team list.
4. Tap Fast-forward; expect 01:00, then “Ended” after one minute.
5. Tap Start a new rescue; expect “All clear”.
6. Create an incident and restart the workflow; the incident and original deadline should remain.
