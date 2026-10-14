# Build contract (single source of truth for parallel work)

Repo base: Express server `artifacts/api-server/server.js`, vanilla chat UI in `public/` (rescue-chat.js, styles.css, index.html), state saved to `data/state.json`. Routes are served at `/api/*` and `/food-rescue-hq/api/*` (prefix is stripped). Keep state atomic-write behaviour. Do not add a database. Never hardcode secrets: read env vars only.

## Journey (six steps)
1 add event, 2 agent questions fill event details, 3 photo of what is left, 4 agent matches places, 5 volunteers asked, 6 call (and text later) to coordinate. Summary at the end.

## State additions (all keys optional on old saved state; normalise on load)
```
event:   { id, name, venue, date, organizer, contact, goodForMinutes, items:[{item, ordered}], notes }
report:  { items:[{item, ordered, left, unit, source:"manual"|"photo"|"photo_edited", confidence?}], confirmedAt }
places:  [{ id, name, type:"shelter"|"kitchen"|"food bank", distanceMiles, capacity, accepts:["prepared","packaged","drinks"] }]
offers:  [{ id, placeId, volunteerId, item, portions, status:"proposed"|"offered"|"accepted"|"declined"|"picked_up"|"dropped_off", updatedAt }]
volunteers: [{ id, name, phone, optedIn, status:"ready"|"asked"|"accepted"|"declined"|"on_the_way"|"dropped_off" }]
```
Seed places: Partner shelter A (shelter, 2 mi, cap 150), Partner shelter B (shelter, 4 mi, cap 200), Community kitchen (kitchen, 6 mi, cap 100). Seed volunteers: Alex Rivera, Jordan Lee, Sam Taylor (all with placeholder phones, editable).
Feed entries: `{id, at, text, kind}`; system/HQ messages use kind "hq". Plain-language text only.

## Endpoints
| Method | Path | Body | Effect |
|---|---|---|---|
| POST | /api/event | {name, venue, date, items:[{item,ordered}], goodForMinutes?} | create or replace the event, clear old feed and offers |
| PATCH | /api/event | partial event fields | update details (used by agent questions) |
| POST | /api/report | {items:[{item,left,unit,source,confidence?}]} | confirm what is left, open the incident, compute proposed offers |
| POST | /api/offers/send | {offers?:[{id,portions}]} | adjust amounts, set status offered, assign volunteers, trigger calls if configured |
| POST | /api/offers/:id/respond | {action:"accept"\|"decline"} | update offer and volunteer status |
| POST | /api/offers/:id/pickup | {} | picked_up |
| POST | /api/offers/:id/dropoff | {} | dropped_off, update rescued totals |
| POST | /api/volunteers/:id/phone | {phone} | set demo phone (E.164), never echoed in the feed |
| POST | /api/estimate | {images:[dataUrl,...], items:[{item,ordered}]} | OpenAI vision estimate, returns {items:[{item,count,unit,confidence,note}], unreadable} |
| POST | /voice/offer | query volunteerId, offerId | TwiML: say the offer, Gather 1 accept / 2 decline |
| POST | /voice/answer | query volunteerId, offerId, form Digits | apply accept/decline, TwiML reply |
| GET | /v/:id | | volunteer page (static HTML that reads /api/state) |
Existing: GET /api/state, GET /api/stream, POST /api/updates, POST /api/demo/fast-forward, POST /api/demo/reset (reset also restores seeds).

`snapshot()` must include event, report, places, offers, volunteers, journeyStep ("event"|"details"|"photo"|"match"|"outreach"|"done"), summary {ordered, eaten, left, rescued, notRescued, byPlace[]}, plus existing totals.

## Env vars (add to .env.example, never commit values)
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL, OPENAI_API_KEY, OPENAI_VISION_MODEL.
Missing credentials must never crash the app: skip the call or estimate and say so in plain language.

## File ownership (avoid conflicts)
- core data/matching/offers: `artifacts/api-server/lib/core.js` + minimal wiring lines in server.js
- voice: `artifacts/api-server/lib/voice.js`
- estimate: `artifacts/api-server/lib/estimate.js`
- frontend: files in `public/` only
