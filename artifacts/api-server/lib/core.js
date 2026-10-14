// Core state, matching and offer lifecycle for Food Rescue HQ.
// State lives in data/state.json (atomic writes). No database.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dataDir = path.join(root, "data");
const stateFile = path.join(dataDir, "state.json");
mkdirSync(dataDir, { recursive: true });

const FEED_LIMIT = 200;
const DEFAULT_WINDOW_MINUTES = 120;
const VOLUNTEER_STATUSES = ["ready", "asked", "accepted", "declined", "on_the_way", "dropped_off"];
const SOURCES = ["manual", "photo", "photo_edited"];
const RESCUED = ["picked_up", "dropped_off"];
const CLAIMED = ["accepted", ...RESCUED];

const seedPlaces = () => [
  { id: "p1", name: "Partner shelter A", type: "shelter", distanceMiles: 2, capacity: 150, accepts: ["prepared", "packaged", "drinks"] },
  { id: "p2", name: "Partner shelter B", type: "shelter", distanceMiles: 4, capacity: 200, accepts: ["prepared", "packaged", "drinks"] },
  { id: "p3", name: "Community kitchen", type: "kitchen", distanceMiles: 6, capacity: 100, accepts: ["prepared", "packaged"] },
];
const seedVolunteers = () => [
  { id: "v1", name: "Alex Rivera", phone: "+12025550101", optedIn: true, status: "ready" },
  { id: "v2", name: "Jordan Lee", phone: "+12025550102", optedIn: true, status: "ready" },
  { id: "v3", name: "Sam Taylor", phone: "+12025550103", optedIn: true, status: "ready" },
];
const initial = () => ({
  event: null, report: null, places: seedPlaces(), offers: [], volunteers: seedVolunteers(),
  incident: null, feed: [],
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
  s.places = Array.isArray(raw.places) && raw.places.length ? raw.places : seedPlaces();
  const kept = raw.volunteers.filter((v) => v && !OLD_FAKE.has(v.name));
  for (const seed of seedVolunteers()) {
    if (!kept.some((v) => v.id === seed.id || v.name === seed.name)) kept.push(seed);
  }
  s.volunteers = kept.map((v) => ({
    ...v,
    optedIn: v.optedIn !== false,
    status: VOLUNTEER_STATUSES.includes(v.status) ? v.status : "ready",
  }));
  s.feed = raw.feed.map((f) => ({ ...f, kind: f.kind || "system" }));
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
    const mine = state.offers.filter((o) => o.placeId === p.id && o.status !== "declined");
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
  if (!state.offers.length) return "done";
  if (state.offers.every((o) => o.status === "proposed")) return "match";
  const settled = state.offers.every((o) => ["declined", "dropped_off"].includes(o.status));
  if (settled || (state.incident && !active())) return "done";
  return "outreach";
}

export function snapshot() {
  const incident = state.incident;
  const total = incident?.total ?? 0;
  const assignments = derivedAssignments();
  const assigned = sum(assignments, (a) => a.claimed);
  const rescued = sum(assignments, (a) => a.pickedUp);
  return {
    ...state,
    incident: incident ? { ...incident, assignments } : null,
    journeyStep: journeyStep(),
    summary: summary(),
    totals: { total, unclaimed: Math.max(0, total - assigned), claimed: Math.max(0, assigned - rescued), rescued },
  };
}

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
export function reset() { commit(initial()); return snapshot(); }

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
function propose(reportItems) {
  const remaining = new Map(state.places.map((p) => [p.id, p.capacity]));
  const ordered = [...state.places].sort((a, b) => a.distanceMiles - b.distanceMiles);
  const offers = [];
  for (const it of reportItems) {
    let left = it.left;
    if (left <= 0) continue;
    const cat = categorize(it.item);
    for (const place of ordered) {
      if (left <= 0) break;
      const accepts = Array.isArray(place.accepts) ? place.accepts : [];
      if (accepts.length && !accepts.includes(cat)) continue;
      const room = remaining.get(place.id);
      if (room <= 0) continue;
      const portions = Math.min(room, left);
      remaining.set(place.id, room - portions);
      left -= portions;
      offers.push({ id: randomUUID(), placeId: place.id, volunteerId: null, item: it.item, portions,
        status: "proposed", updatedAt: new Date().toISOString() });
    }
  }
  return offers;
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
  const offers = propose(items);
  const total = sum(items, (i) => i.left);
  const placed = sum(offers, (o) => o.portions);
  const texts = [];
  const leftText = items.filter((i) => i.left > 0).map((i) => `${i.left} ${i.item}`).join(", ");
  texts.push(total > 0 ? `Confirmed what is left: ${leftText}.` : "Confirmed that nothing is left over.");
  for (const o of offers) texts.push(`Matched ${o.portions} ${o.item} to ${placeById(o.placeId).name}.`);
  if (total > placed) texts.push(`${total - placed} portions have no place that can take them yet.`);
  const minutes = state.event.goodForMinutes ?? DEFAULT_WINDOW_MINUTES;
  const incident = total > 0 ? {
    id: randomUUID(), food: items.filter((i) => i.left > 0).map((i) => i.item).join(", ").slice(0, 100), total,
    location: state.event.venue || state.event.name, createdAt: new Date().toISOString(),
    windowSeconds: minutes * 60, deadline: new Date(Date.now() + minutes * 60000).toISOString(),
    status: "open", assignments: [],
  } : null;
  commit({
    ...state, report, offers, incident,
    volunteers: state.volunteers.map((v) => ({ ...v, status: "ready" })),
    feed: withFeed(texts),
  });
  return snapshot();
}

// ---- offers -----------------------------------------------------------------
let pendingCalls = [];
// Offer ids that were just sent to a volunteer and should be phoned (if voice is configured).
export const takePendingCalls = () => { const c = pendingCalls; pendingCalls = []; return c; };

export function sendOffers(body) {
  if (!state.offers.length) throw conflict("There are no proposed offers yet. Confirm what is left first.");
  const adjust = new Map();
  if (body?.offers !== undefined) {
    if (!Array.isArray(body.offers)) throw bad("offers must be a list.");
    for (const a of body.offers) {
      const o = offerById(a?.id);
      if (!o) throw notFound("One of those offers does not exist.");
      adjust.set(o.id, count(a.portions, "Portions", { min: 0, max: placeById(o.placeId)?.capacity ?? 1000000 }));
    }
  }
  const stamp = new Date().toISOString();
  let offers = state.offers
    .map((o) => (adjust.has(o.id) && o.status === "proposed" ? { ...o, portions: adjust.get(o.id) } : o))
    .filter((o) => o.portions > 0);
  const pool = state.volunteers.filter((v) => v.optedIn);
  let turn = offers.filter((o) => o.volunteerId).length;
  const volunteers = state.volunteers.map((v) => ({ ...v }));
  const texts = [];
  const called = [];
  offers = offers.map((o) => {
    if (o.status !== "proposed") return o;
    const vol = pool.length ? pool[turn++ % pool.length] : null;
    const place = placeById(o.placeId);
    if (vol) {
      const v = volunteers.find((x) => x.id === vol.id);
      if (v.status === "ready" || v.status === "dropped_off") v.status = "asked";
      texts.push(`Offered ${o.portions} ${o.item} to ${place.name}. Asked ${vol.name} to deliver it.`);
      called.push(o.id);
    } else {
      texts.push(`Offered ${o.portions} ${o.item} to ${place.name}. No volunteer is available yet.`);
    }
    return { ...o, volunteerId: vol ? vol.id : null, status: "offered", updatedAt: stamp };
  });
  if (!texts.length) throw conflict("Every offer has already been sent.");
  commit({
    ...state, offers, volunteers,
    incident: state.incident ? { ...state.incident, status: "in_progress" } : null,
    feed: withFeed(texts),
  });
  pendingCalls.push(...called);
  return snapshot();
}

function setOffer(offerId, status, { volunteerStatus, feedText, from }) {
  const o = offerById(offerId);
  if (!o) throw notFound("That offer does not exist.");
  if (!from.includes(o.status)) throw conflict(`This offer is ${o.status.replace("_", " ")}, so that is not possible right now.`);
  const stamp = new Date().toISOString();
  const offers = state.offers.map((x) => (x.id === offerId ? { ...x, status, updatedAt: stamp } : x));
  const volunteers = state.volunteers.map((v) => (v.id === o.volunteerId ? { ...v, status: volunteerStatus } : v));
  const texts = [feedText(o, placeById(o.placeId), volunteerById(o.volunteerId))];
  let incident = state.incident;
  const allDone = offers.every((x) => ["declined", "dropped_off"].includes(x.status));
  if (allDone && incident && active()) {
    const rescued = sum(offers.filter((x) => RESCUED.includes(x.status)), (x) => x.portions);
    const full = rescued >= incident.total;
    texts.push(full ? "All food rescued." : `Rescue finished: ${rescued} of ${incident.total} portions delivered.`);
    incident = { ...incident, status: full ? "resolved" : "expired" };
  }
  commit({ ...state, offers, volunteers, incident, feed: withFeed(texts) });
}

export function respondToOffer(offerId, action) {
  if (!["accept", "decline"].includes(action)) throw bad("Action must be accept or decline.");
  const who = (v) => (v ? v.name : "A volunteer");
  if (action === "accept") {
    setOffer(offerId, "accepted", { from: ["offered"], volunteerStatus: "accepted",
      feedText: (o, p, v) => `${who(v)} accepted ${o.portions} ${o.item} for ${p.name}.` });
  } else {
    setOffer(offerId, "declined", { from: ["offered"], volunteerStatus: "declined",
      feedText: (o, p, v) => `${who(v)} declined ${o.portions} ${o.item} for ${p.name}.` });
  }
  return snapshot();
}
export function pickupOffer(offerId) {
  setOffer(offerId, "picked_up", { from: ["accepted"], volunteerStatus: "on_the_way",
    feedText: (o, p, v) => `${v ? v.name : "A volunteer"} picked up ${o.portions} ${o.item} and is heading to ${p.name}.` });
  return snapshot();
}
export function dropoffOffer(offerId) {
  setOffer(offerId, "dropped_off", { from: ["picked_up", "accepted"], volunteerStatus: "dropped_off",
    feedText: (o, p) => `${o.portions} ${o.item} delivered to ${p.name}.` });
  return snapshot();
}

export function setVolunteerPhone(id, phone) {
  const v = volunteerById(id);
  if (!v) throw notFound("That volunteer does not exist.");
  if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
    throw bad("Phone must be in international format, like +12025550123.");
  }
  commit({
    ...state,
    volunteers: state.volunteers.map((x) => (x.id === id ? { ...x, phone: phone.trim() } : x)),
    feed: withFeed(`Saved a phone number for ${v.name}.`),
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
    volunteerName: vol?.name ?? "there",
    placeName: place?.name ?? "a partner",
    item: o.item,
    portions: o.portions,
    venue: state.event?.venue || state.incident?.location || "the event",
    minutes,
    deadlineText: clock ? `in about ${minutes} minutes, by ${clock}` : `within about ${minutes} minutes`,
  };
}

export const getVolunteer = (id) => volunteerById(id) ?? null;
export const getOffer = (id) => offerById(id) ?? null;
