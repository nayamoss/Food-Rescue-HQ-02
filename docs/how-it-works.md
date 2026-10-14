# Food Rescue HQ: how the code works

## 30-second script (read aloud)

It is one Node process. `server.js` loads `artifacts/api-server/server.js`, which holds every Express route. A photo goes to `estimate.js`, which asks OpenAI vision for a JSON count; the mic goes to `transcribe.js`. Every result lands in `core.js`, one plain state document with the lot state machine and atomic JSON writes. One tap starts outreach: `voice.js` calls each partner through Twilio, first press-1 wins, then calls a volunteer. Every change streams to `rescue-chat.js` over SSE. Browsers never see phone numbers.

## Code map (in the order a request flows)

- `server.js`: entry point; imports the real server.
- `artifacts/api-server/server.js`: Express routes, module wiring, SSE broadcast, and the adapter that hands real phone numbers only to server-side modules.
- `artifacts/api-server/lib/core.js`: state, matching, lots, the two-stage outreach state machine, atomic JSON persistence, phone masking.
- `artifacts/api-server/lib/quick.js`: one typed or spoken sentence becomes event, report and outreach.
- `artifacts/api-server/lib/estimate.js`: OpenAI vision JSON contract, count and recount reconcile.
- `artifacts/api-server/lib/transcribe.js`: multipart audio upload to OpenAI transcription.
- `artifacts/api-server/lib/agent.js`: event-detail questions and match explanations, scripted fallback when no key.
- `artifacts/api-server/lib/voice.js`: Twilio REST calls and TwiML for `/voice/offer`, `/voice/answer`, `/voice/inbound`; first yes wins.
- `artifacts/api-server/lib/connect.js`: click-to-call bridge from the coordinator to a volunteer.
- `public/rescue-chat.js`: single-file UI; state from `/api/state` plus SSE, tabs, camera, mic recorder.
- `public/v.html`: volunteer page with the Delivered button.

## 3 design decisions worth saying out loud

1. One plain state document, atomic writes, derived totals. No database for a 4-hour build; the Cloudflare D1 port is ready.
2. Every integration is optional and degrades: no OpenAI key means manual entry, no Twilio means simulate. Nothing crashes.
3. Phone numbers never reach the browser. Snapshots carry only `phoneSet` and `phoneLast4`.

## Tests

Seven self-test files (`artifacts/api-server/lib/*.selftest.mjs`: core, voice, sms, agent, estimate, transcribe, connect). Run each with `node`, no network needed.

## What is next

Cloudflare D1 in the cloud, texting alongside calls, automatic re-offers for unclaimed lots, and login.
