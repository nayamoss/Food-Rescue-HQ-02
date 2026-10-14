// Agent brain for Food Rescue HQ.
// Step 2: ask the organizer short questions to complete the event details.
// Step 4: explain the proposed offers in plain language.
// Uses the OpenAI Responses API when configured; otherwise (or on any failure) a scripted flow.

const TIMEOUT_MS = 20000;
const MAX_HISTORY = 12;
const MINUTE_CHIPS = ["30 minutes", "45 minutes", "60 minutes", "90 minutes"];
const SPECIAL_CHIPS = ["Nothing special", "Contains nuts", "Vegetarian", "Vegan"];
const WHERE_CHIPS = ["Front entrance", "Loading dock", "Kitchen door", "Side door"];
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

// ---- small helpers ----------------------------------------------------------
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clean = (v, max) => text(v, max).replace(EMOJI, "").replace(PHONE, "[number hidden]").replace(/\s{2,}/g, " ").trim();
const hasPickup = (notes) => /pick[ -]?up/i.test(notes || "");
const specialPart = (notes) => (notes || "").replace(/[^.]*pick[ -]?up[^.]*\.?/gi, "").trim();
const appendNote = (notes, line) => [text(notes, 1000), line].filter(Boolean).join(" ").slice(0, 1000);

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((h) => h && typeof h.text === "string" && h.text.trim())
    .slice(-MAX_HISTORY)
    .map((h) => ({ role: h.role === "user" ? "user" : "assistant", text: h.text.trim().slice(0, 500) }));
}

export function parseMinutes(message) {
  const m = String(message || "").toLowerCase();
  if (/half an? hour/.test(m)) return 30;
  if (/\b(an|one) hour\b/.test(m) && !/\d/.test(m)) return 60;
  const hours = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(m);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const mins = /(\d+)/.exec(m);
  return mins ? Number(mins[1]) : null;
}

// ---- scripted flow ----------------------------------------------------------
// The four questions, in order. Each knows when it is done from the event alone.
const QUESTIONS = [
  { key: "goodForMinutes", done: (e) => Number.isFinite(e.goodForMinutes) },
  { key: "pickup", done: (e) => hasPickup(e.notes) },
  { key: "contact", done: (e) => Boolean(e.contact) },
  { key: "notes", done: (e) => Boolean(specialPart(e.notes)) },
];

function ask(key, event) {
  switch (key) {
    case "goodForMinutes":
      return { reply: "How long is the food good for? You decide the window.", chips: MINUTE_CHIPS };
    case "pickup":
      return event.venue
        ? { reply: `Where should volunteers pick up the food? Is it at ${event.venue}?`, chips: ["Use the venue", "Somewhere else"] }
        : { reply: "Where should volunteers pick up the food?", chips: WHERE_CHIPS };
    case "contact":
      return { reply: "Who should volunteers ask for on site? A name or role is enough.", chips: ["Me", "Event staff on site", "Venue manager"] };
    case "notes":
      return { reply: "Anything special about the food, like allergens or dietary labels?", chips: SPECIAL_CHIPS };
    default:
      return { reply: "", chips: [] };
  }
}

const nextQuestion = (event) => QUESTIONS.find((q) => !q.done(event))?.key ?? null;

// Turn one organizer answer into event updates for the pending question.
// Returns { updates } or { reply, chips } when it needs to ask again.
function answer(key, message, event) {
  const msg = text(message, 500);
  const lower = msg.toLowerCase();
  if (key === "goodForMinutes") {
    const minutes = parseMinutes(msg);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return { reply: "How many minutes? Pick one or type a number.", chips: MINUTE_CHIPS };
    }
    return { updates: { goodForMinutes: minutes } };
  }
  if (key === "pickup") {
    if (lower === "somewhere else") return { reply: "Where exactly should they go?", chips: WHERE_CHIPS };
    const atVenue = event.venue && /^(use the venue|yes|yep|yeah|same|at the venue|the venue)\b/.test(lower);
    if (atVenue) return { updates: { notes: appendNote(event.notes, "Pickup at the venue.") } };
    const place = msg.replace(/\.$/, "").slice(0, 200);
    const updates = { notes: appendNote(event.notes, `Pickup at ${place}.`) };
    if (!event.venue) updates.venue = place;
    return { updates };
  }
  if (key === "contact") {
    const who = lower === "me" ? event.organizer || "The organizer" : msg.slice(0, 200);
    return { updates: { contact: who } };
  }
  if (key === "notes") {
    const none = /^(nothing|none|no|nope|nothing special|n\/a)\b/.test(lower);
    return { updates: { notes: appendNote(event.notes, none ? "Nothing special noted." : `${msg.replace(/\.$/, "")}.`) } };
  }
  return { updates: null };
}

const DONE_REPLY = { reply: "Thanks. I have what I need. Next, take a photo of what is left.", chips: ["Take a photo"], done: true };
const NO_EVENT = { reply: "Add the event first. Then I will ask a few quick questions.", chips: [], done: false };

// Pure: returns { reply, chips, updates?, done }. Applies the message to the first missing field.
export function scriptedTurn(event, message) {
  if (!event) return { ...NO_EVENT };
  const pending = nextQuestion(event);
  if (!pending) return { ...DONE_REPLY };
  if (!text(message, 500)) return { ...ask(pending, event), done: false };
  const result = answer(pending, message, event);
  if (!result.updates) return { reply: result.reply, chips: result.chips, done: false };
  const after = { ...event, ...result.updates };
  const next = nextQuestion(after);
  if (!next) return { ...DONE_REPLY, reply: `Got it. ${DONE_REPLY.reply}`, updates: result.updates };
  const q = ask(next, after);
  return { reply: `Got it. ${q.reply}`, chips: q.chips, updates: result.updates, done: false };
}

// ---- OpenAI -----------------------------------------------------------------
export function extractText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  const parts = [];
  for (const out of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(out?.content) ? out.content : []) {
      if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n");
}

export function firstJsonObject(str) {
  if (typeof str !== "string") return null;
  const start = str.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(str.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function config() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_VISION_MODEL;
  return apiKey && model ? { apiKey, model } : null;
}

async function callModel({ apiKey, model }, instructions, input) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenAI responded ${response.status}`);
  return firstJsonObject(extractText(await response.json()));
}

const STYLE_RULES = [
  "Use short sentences and plain language. No emojis. No markdown.",
  "Never decide or say whether food is safe to eat. The organizer sets how long it is good for.",
  "Never ask for phone numbers and never repeat a phone number.",
  "Return JSON only, no prose and no code fences.",
];

// Event facts for the model. Phone-like text is hidden so it can never be repeated.
function eventFacts(event) {
  return {
    name: clean(event.name, 120), venue: clean(event.venue, 200), date: clean(event.date, 60),
    organizer: clean(event.organizer, 120), contact: clean(event.contact, 200),
    goodForMinutes: Number.isFinite(event.goodForMinutes) ? event.goodForMinutes : null,
    notes: clean(event.notes, 1000), items: (event.items || []).map((i) => ({ item: clean(i.item, 100), ordered: i.ordered })),
  };
}

export function messageInstructions(event) {
  const pending = nextQuestion(event);
  return [
    "You help an event organizer finish the details for a leftover food rescue.",
    "You need: how many minutes the food is good for (goodForMinutes), the pickup location, a contact person on site (a name or role), and anything special such as allergens or dietary labels.",
    "Ask one question at a time. Offer 2 to 4 short quick-reply chips that answer your question.",
    "When the organizer answers, put the new values in updates. Only include fields they actually gave you.",
    "notes replaces the whole notes field: keep the existing notes and add to them. Write the pickup location into notes as 'Pickup at ...'. Set venue only if it is empty.",
    "goodForMinutes must be a whole number of minutes from 1 to 1440.",
    "Set done to true only when all four details are known. Then say the next step is a photo of what is left.",
    ...STYLE_RULES,
    'Shape: {"reply":string,"chips":[string],"updates":{"goodForMinutes"?:number,"contact"?:string,"notes"?:string,"venue"?:string},"done":boolean}',
    `Current event: ${JSON.stringify(eventFacts(event))}`,
    `Next missing detail by our checklist: ${pending ?? "none"}.`,
  ].join("\n");
}

// Validate a model answer. Returns null if it is unusable.
export function parseAgentReply(raw) {
  if (!raw || typeof raw !== "object") return null;
  const reply = clean(raw.reply, 400);
  if (!reply) return null;
  const chips = (Array.isArray(raw.chips) ? raw.chips : []).map((c) => clean(c, 40)).filter(Boolean).slice(0, 4);
  const updates = {};
  const u = raw.updates && typeof raw.updates === "object" ? raw.updates : {};
  const minutes = typeof u.goodForMinutes === "string" ? parseMinutes(u.goodForMinutes) : u.goodForMinutes;
  if (Number.isFinite(minutes)) {
    const m = Math.round(minutes);
    if (m >= 1 && m <= 1440) updates.goodForMinutes = m;
  }
  for (const [key, max] of [["contact", 200], ["notes", 1000], ["venue", 200]]) {
    const v = text(u[key], max);
    if (v) updates[key] = v;
  }
  return { reply, chips, updates: Object.keys(updates).length ? updates : null, done: raw.done === true };
}

async function modelTurn(cfg, event, message, history) {
  const input = history.map((h) => ({ role: h.role, content: h.text }));
  const msg = text(message, 500);
  if (msg) input.push({ role: "user", content: msg });
  if (!input.length) input.push({ role: "user", content: "Start. Ask your first question." });
  return parseAgentReply(await callModel(cfg, messageInstructions(event), input));
}

// ---- explain ----------------------------------------------------------------
export function offerFacts(snap, categorize) {
  const places = Array.isArray(snap?.places) ? snap.places : [];
  const offers = (Array.isArray(snap?.offers) ? snap.offers : []).filter((o) => o.status !== "declined");
  const groups = [];
  for (const o of offers) {
    const place = places.find((p) => p.id === o.placeId);
    if (!place) continue;
    let g = groups.find((x) => x.placeId === place.id);
    if (!g) {
      g = { placeId: place.id, name: place.name, type: place.type, distanceMiles: place.distanceMiles,
        capacity: place.capacity, accepts: place.accepts || [], items: [] };
      groups.push(g);
    }
    g.items.push({ item: o.item, portions: o.portions, kind: categorize ? categorize(o.item) : null });
  }
  return groups;
}

const list = (arr) => (arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`);

export function scriptedExplain(groups) {
  if (!groups.length) return "There are no places matched yet. Confirm what is left first.";
  const parts = groups.map((g) => {
    const what = list(g.items.map((i) => `${i.portions} ${i.item}`));
    const takes = g.accepts.length ? `, and takes ${list(g.accepts.map((a) => ({ prepared: "prepared food", packaged: "packaged food" })[a] || a))}` : "";
    return `${g.name} gets ${what} because it is ${g.distanceMiles} miles away, has room for ${g.capacity}${takes}.`;
  });
  return parts.length === 1 ? parts[0] : `Closest places first. ${parts.join(" ")}`;
}

function explainInstructions(groups) {
  return [
    "Explain to an event organizer why leftover food was matched to these places.",
    "Write one or two sentences. Mention distance, room (capacity) and what each place accepts.",
    "Use only the facts below. Never invent places, numbers, times or details.",
    ...STYLE_RULES,
    'Shape: {"reply":string}',
    `Facts: ${JSON.stringify(groups)}`,
  ].join("\n");
}

// ---- routes -----------------------------------------------------------------
// core must provide snapshot(), patchEvent(body) and HttpError; categorize() is optional.
export function registerAgent(app, core) {
  app.post("/api/agent/message", async (req, res, next) => {
    try {
      const message = text(req.body?.message, 500);
      const history = cleanHistory(req.body?.history);
      const event = core.snapshot().event;
      let turn = null;
      const cfg = config();
      if (event && cfg) {
        try { turn = await modelTurn(cfg, event, message, history); } catch { turn = null; }
      }
      if (!turn) turn = scriptedTurn(event, message);

      const out = { reply: turn.reply, chips: turn.chips };
      if (turn.updates && event) {
        try {
          out.snapshot = core.patchEvent(turn.updates);
          out.updates = turn.updates;
        } catch (error) {
          if (!(error instanceof core.HttpError)) throw error;
          // The model sent something the event cannot hold. Ask again in plain words.
          const again = scriptedTurn(event, "");
          return res.json({ reply: `That did not fit. ${again.reply}`, chips: again.chips, done: false });
        }
      }
      const finalEvent = out.snapshot?.event ?? event;
      const complete = Boolean(finalEvent) && !nextQuestion(finalEvent);
      out.done = Boolean(turn.done) && complete;
      if (turn.done && !complete) {
        // The model thinks it is finished but a detail is still missing: ask for it.
        const q = ask(nextQuestion(finalEvent), finalEvent);
        out.reply = q.reply; out.chips = q.chips;
      }
      res.json(out);
    } catch (error) { next(error); }
  });

  app.post("/api/agent/explain", async (_req, res, next) => {
    try {
      const groups = offerFacts(core.snapshot(), core.categorize);
      const reasons = groups.map((g) => ({ placeId: g.placeId, name: g.name, text: scriptedExplain([g]) }));
      let reply = null;
      const cfg = config();
      if (groups.length && cfg) {
        try {
          const raw = await callModel(cfg, explainInstructions(groups), [{ role: "user", content: "Explain the matches." }]);
          reply = clean(raw?.reply, 600) || null;
        } catch { reply = null; }
      }
      res.json({ reply: reply ?? scriptedExplain(groups), reasons });
    } catch (error) { next(error); }
  });
}
