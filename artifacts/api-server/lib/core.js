// Core state, matching and offer lifecycle for Food Rescue HQ.
// State lives in data/state.json (atomic writes). No database.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
// DATA_DIR lets tests (or a host) keep state somewhere other than <repo>/data.
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const stateFile = path.join(dataDir, "state.json");
mkdirSync(dataDir, { recursive: true });

const FEED_LIMIT = 200;
const DEFAULT_WINDOW_MINUTES = 120;
const VOLUNTEER_STATUSES = ["ready", "asked", "accepted", "declined", "on_the_way", "dropped_off"];
const SOURCES = ["manual", "photo", "photo_edited"];
// Only a delivered confirmation counts as rescued.
const RESCUED = ["dropped_off"];
const CLAIMED = ["accepted", "picked_up", ...RESCUED];
// A place said yes to these (stage 2 onward).
const PLACE_YES = ["place_accepted", "offered", "accepted", "picked_up", "dropped_off"];
const PLACE_TYPES = ["shelter", "kitchen", "food bank"];
const FOOD_KINDS = ["prepared", "packaged", "drinks"];
const BUSY = ["offered", "accepted", "picked_up"]; // a volunteer holding one of these cannot be removed
// Stage 1: how long places have to say yes before a lot is unclaimed. Tests can change it.
let placeTimeoutMs = 10 * 60000;
export const setPlaceTimeoutMs = (ms) => { placeTimeoutMs = ms; };
const E164 = /^\+[1-9]\d{7,14}$/;
// Old demo placeholders (+1 202 555 xxxx). Never dial or keep these.
const PLACEHOLDER_PHONE = /^\+1202555\d{4}$/;

const seedPlaces = () => [
  { id: "p1", name: "Partner shelter A", type: "shelter", distanceMiles: 2, capacity: 150, accepts: ["prepared", "packaged", "drinks"], phone: "" },
  { id: "p2", name: "Partner shelter B", type: "shelter", distanceMiles: 4, capacity: 200, accepts: ["prepared", "packaged", "drinks"], phone: "" },
  { id: "p3", name: "Community kitchen", type: "kitchen", distanceMiles: 6, capacity: 100, accepts: ["prepared", "packaged"], phone: "" },
];
const seedVolunteers = () => [
  { id: "v1", name: "Alex Rivera", phone: "", optedIn: true, status: "ready" },
  { id: "v2", name: "Jordan Lee", phone: "", optedIn: true, status: "ready" },
  { id: "v3", name: "Sam Taylor", phone: "", optedIn: true, status: "ready" },
];
const initial = () => ({
  event: null, report: null, places: seedPlaces(), lots: [], offers: [], volunteers: seedVolunteers(),
  incident: null, feed: [], settings: { coordinatorPhone: "" },
});

// ---- load + normalise -------------------------------------------------------
const OLD_FAKE = new Set(["Morgan Chen", "Casey Brooks"]);
function normalise(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.volunteers) || !Array.isArray(raw.feed) ||
      (raw.incident != null && (!Array.isArray(raw.incident.assignments) || !Number.isFinite(Date.parse(raw.incident.deadline))))) {
    throw new Error("Invalid saved state. Refusing to overwrite data/state.json.");
  }
  const s = { ...raw };
  s.incident = raw.incident ?? null;
  s.event = raw.event ?? null;
  s.report = raw.report ?? null;
  s.offers = Array.isArray(raw.offers) ? raw.offers : [];
  s.lots = Array.isArray(raw.lots) ? raw.lots : [];
  // Older saved state has no places key: give it the seeds. An empty list the user made stays empty.
  s.places = (Array.isArray(raw.places) ? raw.places : seedPlaces()).map((p) => ({
    ...p, phone: typeof p.phone === "string" && E164.test(p.phone) && !PLACEHOLDER_PHONE.test(p.phone) ? p.phone : "",
  }));
  const kept = raw.volunteers.filter((v) => v && !OLD_FAKE.has(v.name));
  s.volunteers = kept.map((v) => ({
    ...v,
    phone: typeof v.phone === "string" && E164.test(v.phone) && !PLACEHOLDER_PHONE.test(v.phone) ? v.phone : "",
    optedIn: v.optedIn !== false,
    status: VOLUNTEER_STATUSES.includes(v.status) ? v.status : "ready",
  }));
  s.feed = raw.feed.map((f) => ({ ...f, kind: f.kind || "system" }));
  const cp = raw.settings?.coordinatorPhone;
  s.settings = { coordinatorPhone: typeof cp === "string" && E164.test(cp) && !PLACEHOLDER_PHONE.test(cp) ? cp : "" };
  return s;
}

let state = existsSync(stateFile) ? normalise(JSON.parse(readFileSync(stateFile, "utf8"))) : initial();
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---- helpers ----------------------------------------------------------------
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const conflict = (m) => new HttpError(409, m);
const notFound = (m) => new HttpError(404, m);

const entry = (text, kind = "hq") => ({ id: randomUUID(), at: new Date().toISOString(), text, kind });
const str = (v, max, label, { required = false } = {}) => {
  if (v === undefined || v === null || v === "") {
    if (required) throw bad(`${label} is required.`);
    return "";
  }
  if (typeof v !== "string" || v.trim().length > max) throw bad(`${label} must be text of at most ${max} characters.`);
  return v.trim();
};
const count = (v, label, { min = 0, max = 1000000 } = {}) => {
  if (!Number.isInteger(v) || v < min || v > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`);
  return v;
};
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

function parseItems(list, label) {
  if (!Array.isArray(list) || list.length > 30) throw bad(`${label} must be a list of up to 30 items.`);
  return list.map((it) => ({
    item: str(it?.item, 100, "Item name", { required: true }),
    ordered: count(it?.ordered, `Ordered amount for ${it?.item ?? "item"}`, { min: 1 }),
  }));
}

const KEYWORDS = {
  drinks: ["soda", "juice", "water", "drink", "coffee", "tea", "lemonade", "beer", "wine", "milk", "cola", "beverage", "kombucha"],
  packaged: ["packaged", "chips", "cookie", "granola", "snack", "bar", "bottle", "canned", "can", "bag", "bagged",
    "sandwich", "wrapped", "boxed", "yogurt", "bread", "bagel", "muffin", "pastry", "pastries", "donut"],
};
export function categorize(name) {
  const n = String(name || "").toLowerCase();
  for (const cat of ["drinks", "packaged"]) {
    if (KEYWORDS[cat].some((k) => new RegExp(`\\b${k}(s|es)?\\b`).test(n))) return cat;
  }
  return "prepared";
}

const placeById = (id) => state.places.find((p) => p.id === id);
const volunteerById = (id) => state.volunteers.find((v) => v.id === id);
const offerById = (id) => state.offers.find((o) => o.id === id);
const lotById = (id) => state.lots.find((l) => l.id === id);

// ---- snapshot ---------------------------------------------------------------
const active = () => state.incident && ["open", "in_progress"].includes(state.incident.status);

function derivedAssignments() {
  if (!state.offers.length) return state.incident?.assignments ?? [];
  return state.offers.filter((o) => o.volunteerId && CLAIMED.includes(o.status)).map((o) => ({
    volunteerId: o.volunteerId, offerId: o.id, claimed: o.portions,
    pickedUp: RESCUED.includes(o.status) ? o.portions : 0,
  }));
}

function summary() {
  const ordered = sum(state.event?.items ?? [], (i) => i.ordered);
  const left = sum(state.report?.items ?? [], (i) => i.left);
  const rescued = sum(state.offers.filter((o) => RESCUED.includes(o.status)), (o) => o.portions);
  const byPlace = state.places.map((p) => {
    // Lot offers only count once the place said yes; legacy offers (no lot) count unless declined.
    const mine = state.offers.filter((o) => o.placeId === p.id && (o.lotId ? PLACE_YES.includes(o.status) : o.status !== "declined"));
    return {
      placeId: p.id, name: p.name, portions: sum(mine, (o) => o.portions),
      rescued: sum(mine.filter((o) => RESCUED.includes(o.status)), (o) => o.portions),
    };
  }).filter((p) => p.portions > 0);
  return {
    ordered, eaten: state.report ? Math.max(0, ordered - left) : 0, left, rescued,
    notRescued: state.report ? Math.max(0, left - rescued) : 0, byPlace,
  };
}

function journeyStep() {
  const e = state.event;
  if (!e) return "event";
  const complete = e.venue && e.date && e.items.length > 0 && Number.isFinite(e.goodForMinutes);
  if (!state.report) return complete ? "photo" : "details";
  if (state.lots.length) {
    if (state.lots.every((l) => l.status === "proposed")) return "match";
    if (state.lots.every((l) => ["delivered", "unclaimed"].includes(l.status)) || (state.incident && !active())) return "done";
    return "outreach";
  }
  if (!state.offers.length) return "done";
  if (state.offers.every((o) => o.status === "proposed")) return "match";
  const settled = state.offers.every((o) => ["declined", "dropped_off"].includes(o.status));
  if (settled || (state.incident && !active())) return "done";
  return "outreach";
}

// Per-lot progress for the UI. One lot = one leftover item from the report.
const LOT_STEP_KEYS = ["places", "place_yes", "volunteer", "on_the_way", "delivered"];
function lotView(lot) {
  const mine = state.offers.filter((o) => o.lotId === lot.id);
  const win = lot.offerId ? mine.find((o) => o.id === lot.offerId) : null;
  const place = win ? placeById(win.placeId) : null;
  const vol = win?.volunteerId ? volunteerById(win.volunteerId) : null;
  let status = lot.status;
  if (lot.status === "placed" && win) {
    status = { place_accepted: "waiting_volunteer", offered: "calling_volunteer", accepted: "on_the_way",
      picked_up: "on_the_way", dropped_off: "delivered" }[win.status] || "waiting_volunteer";
  }
  const placeName = place?.name ?? "";
  const label = {
    proposed: "Ready to call nonprofits",
    calling_places: "Calling nonprofits",
    unclaimed: "Nobody took it",
    waiting_volunteer: `${placeName} said yes. Waiting for a free volunteer`,
    calling_volunteer: `${placeName} said yes. Calling ${vol?.name ?? "a volunteer"}`,
    on_the_way: `${vol?.name ?? "A volunteer"} is on the way`,
    delivered: `Delivered to ${placeName}`,
  }[status] ?? status;
  // Index of the step the lot is on now (steps before it are done). "unclaimed" fails at step 0.
  const at = { proposed: -1, calling_places: 0, unclaimed: 0, waiting_volunteer: 2, calling_volunteer: 2, on_the_way: 3, delivered: 5 }[status] ?? -1;
  const stepLabels = ["Calling nonprofits", place ? `${placeName} said yes` : "A place says yes",
    vol ? `Calling ${vol.name}` : "Calling a volunteer", "On the way", "Delivered"];
  const steps = LOT_STEP_KEYS.map((key, i) => ({
    key, label: stepLabels[i],
    state: i < at ? "done" : i > at || at < 0 ? "todo"
      : status === "unclaimed" ? "failed" : status === "waiting_volunteer" ? "waiting" : "active",
  }));
  return {
    id: lot.id, item: lot.item, unit: lot.unit, portions: lot.portions, kind: lot.kind,
    status, stage: { proposed: "match", calling_places: "places", unclaimed: "done", delivered: "done" }[status] ?? "volunteer",
    label, steps, placeDeadline: lot.placeDeadline ?? null,
    offerId: win?.id ?? null, placeId: place?.id ?? null, placeName, placeAddress: place?.address ?? "",
    volunteerId: vol?.id ?? null, volunteerName: vol?.name ?? "",
    places: mine.map((o) => ({ offerId: o.id, placeId: o.placeId, name: placeById(o.placeId)?.name ?? "",
      portions: o.portions, status: PLACE_YES.includes(o.status) ? "accepted" : o.status, phoneSet: Boolean(placeById(o.placeId)?.phone) })),
    updatedAt: lot.updatedAt,
  };
}

// The browser never sees a full phone number: only whether one is set and its last 4 digits.
const maskPhone = ({ phone, ...x }) => {
  const set = typeof phone === "string" && phone.length > 0;
  return { ...x, phoneSet: set, phoneLast4: set ? phone.slice(-4) : "" };
};

function fullSnapshot() {
  const incident = state.incident;
  const total = incident?.total ?? 0;
  const assignments = derivedAssignments();
  const assigned = sum(assignments, (a) => a.claimed);
  const rescued = sum(assignments, (a) => a.pickedUp);
  return {
    ...state,
    places: state.places.map((p) => ({ ...p })),
    volunteers: state.volunteers.map((v) => ({ ...v })),
    lots: state.lots.map(lotView),
    incident: incident ? { ...incident, assignments } : null,
    journeyStep: journeyStep(),
    summary: summary(),
    totals: { total, unclaimed: Math.max(0, total - assigned), claimed: Math.max(0, assigned - rescued), rescued },
  };
}

// Public snapshot: safe to send to the browser (GET /api/state, SSE, agent).
export function snapshot() {
  const snap = fullSnapshot();
  const cp = state.settings?.coordinatorPhone || "";
  return { ...snap, places: snap.places.map(maskPhone), volunteers: snap.volunteers.map(maskPhone),
    settings: { coordinatorPhoneSet: Boolean(cp), coordinatorPhoneLast4: cp ? cp.slice(-4) : "" } };
}

// Server-side only: same shape as snapshot() but with real phone numbers, for voice and sms.
// Never return this from an HTTP route.
export const internalState = () => fullSnapshot();
export const volunteerPhone = (id) => volunteerById(id)?.phone || "";
export const placePhone = (id) => placeById(id)?.phone || "";
export const coordinatorPhone = () => state.settings?.coordinatorPhone || "";

// ---- commit -----------------------------------------------------------------
function commit(next) {
  if (next.feed.length > FEED_LIMIT) next = { ...next, feed: next.feed.slice(0, FEED_LIMIT) };
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${stateFile}.tmp`, stateFile);
  state = next;
  const snap = snapshot();
  for (const fn of listeners) { try { fn(snap); } catch { /* listener errors never break state */ } }
}
// Newest first. Pass texts in the order they happened.
const withFeed = (texts, kind = "hq") => [...[].concat(texts).map((t) => entry(t, kind)).reverse(), ...state.feed];

export function expire() {
  checkTimeouts();
  if (active() && Date.now() >= Date.parse(state.incident.deadline)) {
    const rescued = snapshot().totals.rescued;
    const status = rescued >= state.incident.total ? "resolved" : "expired";
    commit({ ...state, incident: { ...state.incident, status }, feed: [
      entry(status === "expired" ? "Safety window ended. Remaining food is no longer available for rescue." : "All food rescued. Incident resolved.", status === "expired" ? "expired" : "hq"),
      ...state.feed,
    ] });
  }
}
if (!existsSync(stateFile)) commit(state);
expire();

// ---- legacy incident + feed endpoints --------------------------------------
export function createIncident(body) {
  expire();
  if (active()) throw conflict("An incident is already active. Reset it before creating another.");
  const { food, total, location, minutes } = body ?? {};
  if (typeof food !== "string" || !food.trim() || food.length > 100 ||
      typeof location !== "string" || !location.trim() || location.length > 200 ||
      !Number.isInteger(total) || total < 1 || total > 1000000 ||
      typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    throw bad("Provide food, location, a positive integer total, and minutes between 0 and 1440.");
  }
  const incident = { id: randomUUID(), food: food.trim(), total, location: location.trim(),
    createdAt: new Date().toISOString(), windowSeconds: Math.round(minutes * 60),
    deadline: new Date(Date.now() + minutes * 60000).toISOString(), status: "open", assignments: [] };
  commit({ ...state, incident, feed: [entry(`Incident opened: ${total} ${incident.food} at ${incident.location}. ${minutes}-minute safety window.`, "incident"), ...state.feed] });
  return snapshot();
}
export function fastForward() {
  expire();
  if (!active()) throw conflict("Create an active incident first.");
  commit({ ...state, incident: { ...state.incident, deadline: new Date(Date.now() + 60000).toISOString() },
    feed: [entry("Demo fast-forward: safety deadline set to 60 seconds from now.", "demo"), ...state.feed] });
  return snapshot();
}
export function postUpdate(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t || t.length > 280) throw bad("Write an update between 1 and 280 characters.");
  commit({ ...state, feed: [entry(t, "update"), ...state.feed] });
  return snapshot();
}
// Clears the event, report, offers, incident and feed. Keeps the volunteers and places the user has.
export function reset() {
  commit({ ...initial(), places: state.places, volunteers: state.volunteers.map((v) => ({ ...v, status: "ready" })), settings: state.settings });
  return snapshot();
}
// Full reset: back to the seeded places and volunteers (no phones).
export function resetAll() { commit(initial()); return snapshot(); }

// ---- event ------------------------------------------------------------------
export function createEvent(body) {
  const b = body ?? {};
  const event = {
    id: randomUUID(),
    name: str(b.name, 120, "Event name", { required: true }),
    venue: str(b.venue, 200, "Venue"),
    date: str(b.date, 60, "Date"),
    organizer: str(b.organizer, 120, "Organizer"),
    contact: str(b.contact, 200, "Contact"),
    items: b.items === undefined ? [] : parseItems(b.items, "Items"),
    notes: str(b.notes, 1000, "Notes"),
  };
  if (b.goodForMinutes !== undefined && b.goodForMinutes !== null) {
    event.goodForMinutes = count(b.goodForMinutes, "Good for minutes", { min: 1, max: 1440 });
  }
  commit({
    ...initial(), event, places: state.places,
    volunteers: state.volunteers.map((v) => ({ ...v, status: "ready" })),
    feed: [entry(`Added event ${event.name}${event.venue ? ` at ${event.venue}` : ""}.`)],
  });
  return snapshot();
}

export function patchEvent(body) {
  if (!state.event) throw conflict("Add an event first.");
  const b = body ?? {};
  const e = { ...state.event };
  const changed = [];
  for (const [key, max] of [["name", 120], ["venue", 200], ["date", 60], ["organizer", 120], ["contact", 200], ["notes", 1000]]) {
    if (b[key] !== undefined) {
      e[key] = str(b[key], max, key, { required: key === "name" });
      changed.push(key);
    }
  }
  if (b.goodForMinutes !== undefined) { e.goodForMinutes = count(b.goodForMinutes, "Good for minutes", { min: 1, max: 1440 }); changed.push("goodForMinutes"); }
  if (b.items !== undefined) { e.items = parseItems(b.items, "Items"); changed.push("items"); }
  if (!changed.length) throw bad("Send at least one event field to update.");
  const labels = { goodForMinutes: "how long the food stays good", items: "the food list" };
  commit({ ...state, event: e, feed: withFeed(`Updated the event: ${changed.map((k) => labels[k] || k).join(", ")}.`) });
  return snapshot();
}

// ---- report + matching ------------------------------------------------------
// Each leftover item becomes one lot. Every place that takes that kind of food is proposed for it
// (nearest first). Places that can hold the whole lot are preferred; if none can, every place that
// takes the food is proposed for as much as it can hold. In stage 1 the first place to say yes wins the lot.
function propose(reportItems) {
  const ordered = [...state.places].sort((a, b) => a.distanceMiles - b.distanceMiles);
  const stamp = new Date().toISOString();
  const lots = [];
  const offers = [];
  for (const it of reportItems) {
    if (it.left <= 0) continue;
    const kind = categorize(it.item);
    const lot = { id: randomUUID(), item: it.item, unit: it.unit, portions: it.left, kind,
      status: "proposed", placeDeadline: null, offerId: null, updatedAt: stamp };
    lots.push(lot);
    const fits = ordered.filter((p) => !Array.isArray(p.accepts) || !p.accepts.length || p.accepts.includes(kind));
    const roomy = fits.filter((p) => p.capacity >= it.left);
    for (const place of roomy.length ? roomy : fits) {
      offers.push({ id: randomUUID(), lotId: lot.id, placeId: place.id, volunteerId: null, item: it.item,
        portions: Math.min(place.capacity, it.left), status: "proposed", updatedAt: stamp });
    }
  }
  return { lots, offers };
}

export function submitReport(body) {
  if (!state.event) throw conflict("Add an event before reporting what is left.");
  const list = body?.items;
  if (!Array.isArray(list) || !list.length || list.length > 30) throw bad("Send a list of items with how many are left.");
  const items = list.map((it) => {
    const name = str(it?.item, 100, "Item name", { required: true });
    const match = state.event.items.find((e) => e.item.toLowerCase() === name.toLowerCase());
    const left = count(it?.left, `Amount left for ${name}`);
    const out = {
      item: name,
      ordered: match ? match.ordered : Number.isInteger(it?.ordered) && it.ordered >= left ? it.ordered : left,
      left,
      unit: str(it?.unit, 30, "Unit") || "portions",
      source: SOURCES.includes(it?.source) ? it.source : "manual",
    };
    if (typeof it?.confidence === "number" && Number.isFinite(it.confidence)) out.confidence = it.confidence;
    else if (typeof it?.confidence === "string" && it.confidence.length <= 20) out.confidence = it.confidence;
    return out;
  });
  const report = { items, confirmedAt: new Date().toISOString() };
  const { lots, offers } = propose(items);
  const total = sum(items, (i) => i.left);
  const texts = [];
  const leftText = items.filter((i) => i.left > 0).map((i) => `${i.left} ${i.item}`).join(", ");
  texts.push(total > 0 ? `Confirmed what is left: ${leftText}.` : "Confirmed that nothing is left over.");
  for (const lot of lots) {
    const names = offers.filter((o) => o.lotId === lot.id).map((o) => placeById(o.placeId).name);
    texts.push(names.length ? `${lot.portions} ${lot.item} could go to: ${names.join(", ")}.`
      : `${lot.portions} ${lot.item} have no place that can take them yet.`);
  }
  const minutes = state.event.goodForMinutes ?? DEFAULT_WINDOW_MINUTES;
  const incident = total > 0 ? {
    id: randomUUID(), food: items.filter((i) => i.left > 0).map((i) => i.item).join(", ").slice(0, 100), total,
    location: state.event.venue || state.event.name, createdAt: new Date().toISOString(),
    windowSeconds: minutes * 60, deadline: new Date(Date.now() + minutes * 60000).toISOString(),
    status: "open", assignments: [],
  } : null;
  commit({
    ...state, report, lots, offers, incident,
    volunteers: state.volunteers.map((v) => ({ ...v, status: "ready" })),
    feed: withFeed(texts),
  });
  return snapshot();
}

// ---- offers: two-stage outreach --------------------------------------------
// Stage 1: every proposed place with a phone is called at once about each lot. First yes wins the lot.
// Stage 2: the winning offer goes to the first free volunteer with a phone, who is called to carry it.
// Offer status: proposed -> calling (place being asked) -> place_accepted | declined | taken | unclaimed | skipped
//               place_accepted -> offered (volunteer asked) -> accepted -> picked_up -> dropped_off (delivered)
let pendingCalls = [];
// Offer ids that need a phone call now (a place in stage 1 or a volunteer in stage 2), if voice is configured.
export const takePendingCalls = () => { const c = pendingCalls; pendingCalls = []; return c; };

// A working copy of the parts of state an outreach step changes. Mutate it, then save().
const draft = () => ({
  ...state,
  lots: state.lots.map((l) => ({ ...l })),
  offers: state.offers.map((o) => ({ ...o })),
  volunteers: state.volunteers.map((v) => ({ ...v })),
});
const isActive = (inc) => inc && ["open", "in_progress"].includes(inc.status);

// The rescue is finished when every lot is delivered or unclaimed.
function finish(d, texts) {
  if (!d.lots.length || !isActive(d.incident)) return;
  if (!d.lots.every((l) => ["delivered", "unclaimed"].includes(l.status))) return;
  const rescued = sum(d.offers.filter((o) => RESCUED.includes(o.status)), (o) => o.portions);
  const full = rescued >= d.incident.total;
  texts.push(full ? "All food rescued." : `Rescue finished: ${rescued} of ${d.incident.total} portions delivered.`);
  d.incident = { ...d.incident, status: full ? "resolved" : "expired" };
}
function save(d, texts, calls = []) {
  finish(d, texts);
  commit({ ...d, feed: withFeed(texts) });
  pendingCalls.push(...calls);
}

// Give a place-accepted offer to the first free volunteer with a phone. Returns true if one was asked.
function assignVolunteer(d, o, texts, calls, { quiet = false } = {}) {
  const place = placeById(o.placeId);
  const busy = new Set(d.offers.filter((x) => x.id !== o.id && x.volunteerId && BUSY.includes(x.status)).map((x) => x.volunteerId));
  const skip = o.declinedBy || [];
  const v = d.volunteers.find((x) => x.optedIn && x.phone && !busy.has(x.id) && !skip.includes(x.id));
  const stamp = new Date().toISOString();
  if (!v) {
    o.status = "place_accepted"; o.volunteerId = null; o.updatedAt = stamp;
    if (!quiet) texts.push(`No volunteer with a phone is free to carry ${o.portions} ${o.item} to ${place?.name ?? "the place"} yet.`);
    return false;
  }
  o.status = "offered"; o.volunteerId = v.id; o.updatedAt = stamp;
  v.status = "asked";
  texts.push(`Asking ${v.name} to carry ${o.portions} ${o.item} to ${place?.name ?? "the place"}.`);
  calls.push(o.id);
  return true;
}
// Hand waiting lots to volunteers who just became free (or just got a phone).
function assignWaiting(d, texts, calls) {
  for (const o of d.offers) {
    if (o.lotId && o.status === "place_accepted" && !o.volunteerId) assignVolunteer(d, o, texts, calls, { quiet: true });
  }
}

// POST /api/outreach/places (and /api/offers/send, /api/quick): start stage 1.
export function startPlaceOutreach(body) {
  expire();
  if (!state.lots.length) throw conflict("There is nothing to send yet. Confirm what is left first.");
  const d = draft();
  if (body?.offers !== undefined) {
    if (!Array.isArray(body.offers)) throw bad("offers must be a list.");
    for (const a of body.offers) {
      const o = d.offers.find((x) => x.id === a?.id);
      if (!o) throw notFound("One of those offers does not exist.");
      const portions = count(a.portions, "Portions", { min: 0, max: placeById(o.placeId)?.capacity ?? 1000000 });
      if (o.status === "proposed") o.portions = portions;
    }
    d.offers = d.offers.filter((o) => o.portions > 0);
  }
  const todo = d.lots.filter((l) => l.status === "proposed");
  if (!todo.length) throw conflict("Every lot has already been sent out.");
  const stamp = new Date().toISOString();
  const deadline = new Date(Date.now() + placeTimeoutMs).toISOString();
  const texts = [];
  const calls = [];
  for (const lot of todo) {
    const mine = d.offers.filter((o) => o.lotId === lot.id && o.status === "proposed");
    const callable = mine.filter((o) => placeById(o.placeId)?.phone);
    for (const o of mine) { o.status = callable.includes(o) ? "calling" : "skipped"; o.updatedAt = stamp; }
    lot.updatedAt = stamp;
    if (!callable.length) {
      lot.status = "unclaimed";
      texts.push(`No place with a phone number can take ${lot.portions} ${lot.item}, so it is unclaimed. Add a phone number to a place to call it.`);
      continue;
    }
    lot.status = "calling_places";
    lot.placeDeadline = deadline;
    texts.push(`Calling nonprofits about ${lot.portions} ${lot.item}: ${callable.map((o) => placeById(o.placeId).name).join(", ")}.`);
    calls.push(...callable.map((o) => o.id));
  }
  if (d.incident && d.incident.status === "open") d.incident = { ...d.incident, status: "in_progress" };
  save(d, texts, calls);
  return snapshot();
}
export const sendOffers = startPlaceOutreach;

// A place answers a stage 1 call. Returns "won" (it gets the lot), "taken" (someone else said yes first),
// "declined", or "closed" (the lot is no longer open).
export function placeAnswer(offerId, action) {
  if (!["accept", "decline"].includes(action)) throw bad("Action must be accept or decline.");
  const o0 = offerById(offerId);
  if (!o0) throw notFound("That offer does not exist.");
  if (o0.status !== "calling") return o0.status === "taken" ? "taken" : "closed";
  const d = draft();
  const o = d.offers.find((x) => x.id === offerId);
  const lot = d.lots.find((l) => l.id === o.lotId);
  const place = placeById(o.placeId);
  const stamp = new Date().toISOString();
  const texts = [];
  const calls = [];
  if (!lot || lot.status !== "calling_places") return "closed";
  if (action === "decline") {
    o.status = "declined"; o.updatedAt = stamp;
    texts.push(`${place.name} can't take ${lot.portions} ${lot.item}.`);
    if (!d.offers.some((x) => x.lotId === lot.id && x.status === "calling")) {
      lot.status = "unclaimed"; lot.updatedAt = stamp;
      texts.push(`Every place said no to ${lot.portions} ${lot.item}. It is unclaimed.`);
    }
    save(d, texts);
    return "declined";
  }
  // First yes wins. The other places still being called are told it is taken and not called again.
  for (const x of d.offers) {
    if (x.lotId === lot.id && x.id !== o.id && x.status === "calling") { x.status = "taken"; x.updatedAt = stamp; }
  }
  lot.status = "placed"; lot.offerId = o.id; lot.updatedAt = stamp;
  texts.push(`${place.name} said yes to ${o.portions} ${o.item}.`);
  assignVolunteer(d, o, texts, calls);
  save(d, texts, calls);
  return "won";
}

function volunteerAnswer(offerId, action) {
  const d = draft();
  const o = d.offers.find((x) => x.id === offerId);
  if (o.status !== "offered") throw conflict(`This offer is ${o.status.replace("_", " ")}, so that is not possible right now.`);
  const place = placeById(o.placeId);
  const v = d.volunteers.find((x) => x.id === o.volunteerId);
  const who = v ? v.name : "A volunteer";
  const stamp = new Date().toISOString();
  const texts = [];
  const calls = [];
  if (action === "accept") {
    o.status = "accepted"; o.updatedAt = stamp;
    if (v) v.status = "accepted";
    texts.push(`${who} accepted: ${o.portions} ${o.item} to ${place?.name ?? "the place"}. On the way.`);
  } else {
    if (v) v.status = "declined";
    o.declinedBy = [...(o.declinedBy || []), o.volunteerId].filter(Boolean);
    texts.push(`${who} can't take ${o.portions} ${o.item}.`);
    if (o.lotId) {
      assignVolunteer(d, o, texts, calls);
    } else {
      // Legacy offer without a lot: hand it to the next free volunteer, or give up.
      const busy = new Set(d.offers.filter((x) => x.id !== o.id && x.volunteerId && BUSY.includes(x.status)).map((x) => x.volunteerId));
      const next = d.volunteers.find((x) => x.optedIn && x.phone && !busy.has(x.id) && !o.declinedBy.includes(x.id));
      if (next) { o.volunteerId = next.id; next.status = "asked"; texts.push(`Asking ${next.name} instead.`); calls.push(o.id); }
      else { o.status = "declined"; texts.push("No other volunteer is free."); }
      o.updatedAt = stamp;
    }
  }
  save(d, texts, calls);
}

// Accept/decline for whoever is being asked right now: the place in stage 1, the volunteer in stage 2.
export function respondToOffer(offerId, action) {
  if (!["accept", "decline"].includes(action)) throw bad("Action must be accept or decline.");
  const o = offerById(offerId);
  if (!o) throw notFound("That offer does not exist.");
  if (o.status === "calling" || o.status === "taken") {
    const r = placeAnswer(offerId, action);
    if (r === "taken") throw conflict("Another place already said yes to this food.");
    if (r === "closed") throw conflict("This offer is no longer open.");
  } else {
    volunteerAnswer(offerId, action);
  }
  return snapshot();
}

export function pickupOffer(offerId) {
  const o = offerById(offerId);
  if (!o) throw notFound("That offer does not exist.");
  if (o.status !== "accepted") throw conflict(`This offer is ${o.status.replace("_", " ")}, so that is not possible right now.`);
  const d = draft();
  const x = d.offers.find((y) => y.id === offerId);
  x.status = "picked_up"; x.updatedAt = new Date().toISOString();
  const v = d.volunteers.find((y) => y.id === x.volunteerId);
  if (v) v.status = "on_the_way";
  save(d, [`${v ? v.name : "A volunteer"} picked up ${x.portions} ${x.item} and is heading to ${placeById(x.placeId)?.name ?? "the place"}.`]);
  return snapshot();
}

// The volunteer confirms the drop-off (volunteer page, HQ, or inbound call). Only this counts as rescued.
// Pass volunteerId to make sure the confirmation comes from the volunteer holding the job.
export function deliverOffer(offerId, { volunteerId } = {}) {
  const o = offerById(offerId);
  if (!o) throw notFound("That offer does not exist.");
  if (volunteerId && o.volunteerId !== volunteerId) throw conflict("This pickup belongs to another volunteer.");
  if (!["accepted", "picked_up"].includes(o.status)) throw conflict(`This offer is ${o.status.replace("_", " ")}, so that is not possible right now.`);
  const d = draft();
  const x = d.offers.find((y) => y.id === offerId);
  const stamp = new Date().toISOString();
  x.status = "dropped_off"; x.updatedAt = stamp;
  const v = d.volunteers.find((y) => y.id === x.volunteerId);
  if (v) v.status = "dropped_off";
  const lot = d.lots.find((l) => l.id === x.lotId);
  if (lot) { lot.status = "delivered"; lot.updatedAt = stamp; }
  const texts = [`${v ? v.name : "A volunteer"} delivered ${x.portions} ${x.item} to ${placeById(x.placeId)?.name ?? "the place"}.`];
  const calls = [];
  assignWaiting(d, texts, calls); // this volunteer is free again
  if (!x.lotId && isActive(d.incident) && d.offers.every((y) => ["declined", "dropped_off"].includes(y.status))) {
    const rescued = sum(d.offers.filter((y) => RESCUED.includes(y.status)), (y) => y.portions);
    const full = rescued >= d.incident.total;
    texts.push(full ? "All food rescued." : `Rescue finished: ${rescued} of ${d.incident.total} portions delivered.`);
    d.incident = { ...d.incident, status: full ? "resolved" : "expired" };
  }
  save(d, texts, calls);
  return snapshot();
}
export const dropoffOffer = (offerId) => deliverOffer(offerId);

// Stage 1 timeout: lots nobody said yes to within the window become unclaimed. `now` is injectable for tests.
export function checkTimeouts(now = Date.now()) {
  const due = state.lots.filter((l) => l.status === "calling_places" && l.placeDeadline && Date.parse(l.placeDeadline) <= now);
  if (!due.length) return false;
  const d = draft();
  const stamp = new Date().toISOString();
  const texts = [];
  const minutes = Math.max(1, Math.round(placeTimeoutMs / 60000));
  for (const l of due) {
    const lot = d.lots.find((x) => x.id === l.id);
    lot.status = "unclaimed"; lot.updatedAt = stamp;
    for (const o of d.offers) if (o.lotId === lot.id && o.status === "calling") { o.status = "unclaimed"; o.updatedAt = stamp; }
    texts.push(`No place said yes to ${lot.portions} ${lot.item} within ${minutes} minutes. It is unclaimed.`);
  }
  save(d, texts);
  return true;
}

// Inbound call from a volunteer: their open job (accepted or picked up), oldest first. Server side only.
export function openJobForPhone(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const phone = normalizePhone(raw);
  const v = state.volunteers.find((x) => x.phone && x.phone === phone);
  if (!v) return null;
  const o = state.offers
    .filter((x) => x.volunteerId === v.id && ["accepted", "picked_up"].includes(x.status))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))[0];
  if (!o) return { volunteerId: v.id, volunteerName: v.name, offerId: null };
  const place = placeById(o.placeId);
  return { volunteerId: v.id, volunteerName: v.name, offerId: o.id, item: o.item, portions: o.portions,
    placeName: place?.name ?? "the place", placeAddress: place?.address ?? "",
    venue: state.event?.venue || state.incident?.location || "the event" };
}

// Who to phone for an offer right now. Server side only (real numbers).
export function callTarget(offerId) {
  const o = offerById(offerId);
  if (!o) return null;
  if (o.volunteerId && BUSY.includes(o.status)) {
    const v = volunteerById(o.volunteerId);
    return v ? { kind: "volunteer", id: v.id, name: v.name, phone: v.optedIn ? v.phone : "" } : null;
  }
  if (o.status === "calling") {
    const p = placeById(o.placeId);
    return p ? { kind: "place", id: p.id, name: p.name, phone: p.phone || "" } : null;
  }
  return null;
}

// ---- volunteers -------------------------------------------------------------
// Feed text and errors never include the phone number itself.
const PHONE_HELP = "Enter a 10-digit US phone number, like 762 235 7374.";
// US numbers can be typed any way: 7622357374, (762) 235-7374, 1 762 235 7374 or +17622357374.
function normalizePhone(raw) {
  const t = raw.trim();
  if (t.startsWith("+")) return "+" + t.slice(1).replace(/\D/g, "");
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return "+" + d;
}
function parsePhone(phone, { allowEmpty = false } = {}) {
  if (allowEmpty && (phone === null || phone === "")) return "";
  if (typeof phone !== "string") throw bad(PHONE_HELP);
  const p = normalizePhone(phone);
  if (!E164.test(p)) throw bad(PHONE_HELP);
  if (PLACEHOLDER_PHONE.test(p)) throw bad("That is a demo placeholder number. Add a real phone number.");
  return p;
}
// The coordinator's own phone (for "call the volunteer from the app"). Empty clears it.
export function setSettings(body) {
  const b = body && typeof body === "object" ? body : {};
  if (b.coordinatorPhone === undefined) throw bad("Send a coordinatorPhone to update.");
  const raw = typeof b.coordinatorPhone === "string" ? b.coordinatorPhone.trim() : b.coordinatorPhone;
  const phone = parsePhone(raw, { allowEmpty: true });
  commit({ ...state, settings: { ...(state.settings || {}), coordinatorPhone: phone },
    feed: withFeed(phone ? "Saved your phone number for calls." : "Removed your phone number.") });
  return snapshot();
}
// A volunteer was added, freed or given a phone: hand them a lot that is waiting for one.
function offerWaitingLots() {
  if (!state.offers.some((o) => o.lotId && o.status === "place_accepted" && !o.volunteerId)) return;
  const d = draft();
  const texts = [];
  const calls = [];
  assignWaiting(d, texts, calls);
  if (texts.length) save(d, texts, calls);
}
const volunteerName = (v, selfId = null) => {
  const name = str(v, 80, "Volunteer name", { required: true });
  if (state.volunteers.some((x) => x.id !== selfId && x.name.toLowerCase() === name.toLowerCase())) {
    throw conflict(`There is already a volunteer named ${name}.`);
  }
  return name;
};

export function addVolunteer(body) {
  const b = body ?? {};
  const v = {
    id: `v-${randomUUID()}`,
    name: volunteerName(b.name),
    phone: b.phone === undefined ? "" : parsePhone(b.phone, { allowEmpty: true }),
    optedIn: true,
    status: "ready",
  };
  if (b.optedIn !== undefined) {
    if (typeof b.optedIn !== "boolean") throw bad("optedIn must be true or false.");
    v.optedIn = b.optedIn;
  }
  commit({ ...state, volunteers: [...state.volunteers, v], feed: withFeed(`Added volunteer ${v.name}.`) });
  offerWaitingLots();
  return snapshot();
}

export function patchVolunteer(id, body) {
  const v = volunteerById(id);
  if (!v) throw notFound("That volunteer does not exist.");
  const b = body ?? {};
  const next = { ...v };
  const changed = [];
  if (b.name !== undefined) { next.name = volunteerName(b.name, id); if (next.name !== v.name) changed.push(`renamed to ${next.name}`); }
  if (b.phone !== undefined) { next.phone = parsePhone(b.phone, { allowEmpty: true }); changed.push(next.phone ? "phone number saved" : "phone number removed"); }
  if (b.optedIn !== undefined) {
    if (typeof b.optedIn !== "boolean") throw bad("optedIn must be true or false.");
    next.optedIn = b.optedIn;
    changed.push(b.optedIn ? "can be asked to help" : "will not be asked to help");
  }
  if (b.name === undefined && b.phone === undefined && b.optedIn === undefined) {
    throw bad("Send a name, phone or optedIn to update.");
  }
  commit({
    ...state,
    volunteers: state.volunteers.map((x) => (x.id === id ? next : x)),
    feed: changed.length ? withFeed(`Updated volunteer ${v.name}: ${changed.join(", ")}.`) : state.feed,
  });
  offerWaitingLots();
  return snapshot();
}

export function deleteVolunteer(id) {
  const v = volunteerById(id);
  if (!v) throw notFound("That volunteer does not exist.");
  if (state.offers.some((o) => o.volunteerId === id && BUSY.includes(o.status))) {
    throw conflict(`${v.name} is still delivering an offer. Wait until it is dropped off or declined.`);
  }
  commit({ ...state, volunteers: state.volunteers.filter((x) => x.id !== id), feed: withFeed(`Removed volunteer ${v.name}.`) });
  return snapshot();
}

export function setVolunteerPhone(id, phone) {
  const v = volunteerById(id);
  if (!v) throw notFound("That volunteer does not exist.");
  const p = parsePhone(phone);
  commit({
    ...state,
    volunteers: state.volunteers.map((x) => (x.id === id ? { ...x, phone: p } : x)),
    feed: withFeed(`Saved a phone number for ${v.name}.`),
  });
  offerWaitingLots();
  return snapshot();
}

// ---- places -----------------------------------------------------------------
function placeFields(b, { partial, selfId = null }) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has("name")) {
    out.name = str(b.name, 120, "Place name", { required: true });
    if (state.places.some((p) => p.id !== selfId && p.name.toLowerCase() === out.name.toLowerCase())) {
      throw conflict(`There is already a place named ${out.name}.`);
    }
  }
  if (!partial || has("type")) {
    if (!PLACE_TYPES.includes(b.type)) throw bad("Type must be shelter, kitchen or food bank.");
    out.type = b.type;
  }
  if (!partial || has("distanceMiles")) {
    if (typeof b.distanceMiles !== "number" || !Number.isFinite(b.distanceMiles) || b.distanceMiles < 0 || b.distanceMiles > 1000) {
      throw bad("Distance must be a number of miles from 0 to 1000.");
    }
    out.distanceMiles = Math.round(b.distanceMiles * 10) / 10;
  }
  if (!partial || has("capacity")) out.capacity = count(b.capacity, "Capacity", { min: 1 });
  if (!partial || has("accepts")) {
    if (!Array.isArray(b.accepts) || !b.accepts.length || b.accepts.some((k) => !FOOD_KINDS.includes(k))) {
      throw bad("Accepts must list one or more of: prepared, packaged, drinks.");
    }
    out.accepts = FOOD_KINDS.filter((k) => b.accepts.includes(k));
  }
  if (has("address")) out.address = str(b.address, 200, "Address");
  // Same rules as volunteers: E.164, US numbers typed without +1 are normalised. Never echoed in feed text.
  if (has("phone")) out.phone = parsePhone(b.phone, { allowEmpty: true });
  return out;
}

export function addPlace(body) {
  const fields = placeFields(body ?? {}, { partial: false });
  const place = { id: `p-${randomUUID()}`, ...fields, address: fields.address ?? "", phone: fields.phone ?? "" };
  commit({ ...state, places: [...state.places, place], feed: withFeed(`Added place ${place.name}.`) });
  return snapshot();
}

export function patchPlace(id, body) {
  const p = placeById(id);
  if (!p) throw notFound("That place does not exist.");
  const fields = placeFields(body ?? {}, { partial: true, selfId: id });
  if (!Object.keys(fields).length) throw bad("Send at least one place field to update.");
  commit({
    ...state,
    places: state.places.map((x) => (x.id === id ? { ...x, ...fields } : x)),
    feed: withFeed(`Updated place ${fields.name && fields.name !== p.name ? `${p.name} (now ${fields.name})` : p.name}.`),
  });
  return snapshot();
}

export function deletePlace(id) {
  const p = placeById(id);
  if (!p) throw notFound("That place does not exist.");
  if (state.offers.some((o) => o.placeId === id && o.status !== "proposed")) {
    throw conflict(`${p.name} already has offers sent to it, so it cannot be removed right now.`);
  }
  const dropped = state.offers.filter((o) => o.placeId === id);
  const texts = [`Removed place ${p.name}.`];
  if (dropped.length) texts.push(`${sum(dropped, (o) => o.portions)} proposed portions for ${p.name} no longer have a place.`);
  commit({
    ...state,
    places: state.places.filter((x) => x.id !== id),
    offers: state.offers.filter((o) => o.placeId !== id),
    feed: withFeed(texts),
  });
  return snapshot();
}

// ---- voice helper -----------------------------------------------------------
export function describeOffer(offerId) {
  const o = offerById(offerId);
  if (!o) return null;
  const place = placeById(o.placeId);
  const vol = volunteerById(o.volunteerId);
  const deadline = state.incident ? new Date(state.incident.deadline) : null;
  const minutes = deadline ? Math.max(1, Math.round((deadline.getTime() - Date.now()) / 60000))
    : state.event?.goodForMinutes ?? DEFAULT_WINDOW_MINUTES;
  const clock = deadline ? deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  return {
    // "place" while a place is being asked (stage 1), "volunteer" once a volunteer holds it (stage 2).
    kind: o.volunteerId && BUSY.includes(o.status) ? "volunteer" : "place",
    status: o.status,
    offerId: o.id,
    volunteerId: vol?.id ?? "",
    placeId: place?.id ?? "",
    volunteerName: vol?.name ?? "there",
    placeName: place?.name ?? "a partner",
    placeAddress: place?.address ?? "",
    item: o.item,
    portions: o.portions,
    venue: state.event?.venue || state.incident?.location || "the event",
    minutes,
    deadlineText: clock ? `in about ${minutes} minutes, by ${clock}` : `within about ${minutes} minutes`,
  };
}

export const getVolunteer = (id) => volunteerById(id) ?? null;
export const getOffer = (id) => offerById(id) ?? null;
