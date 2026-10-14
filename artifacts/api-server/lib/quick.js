// Quick report: one spoken or typed sentence becomes event, report, matched offers and calls.
// Example: "About 100 tacos and 10 sandwiches left at the main hall, good for 45 minutes."
// Uses OpenAI when configured; otherwise a simple parser handles the common shapes.

const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, "a hundred": 100 };
const UNITS = /^(bags?|boxes?|trays?|cases?|pans?|plates?|pieces?|portions?|bottles?|cans?|cups?|dozen)\s+of\s+/i;
const STOP = /\b(left|leftover|remaining|at|in|for|good|by|from|we have|there (are|is)|about|around|roughly|maybe)\b/gi;

function toNumber(word) {
  if (/^\d+$/.test(word)) return Number(word);
  return WORD_NUMBERS[word.toLowerCase()] ?? null;
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalize(text) {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/\b(um+|uh+|like|so|okay|ok|basically|just|maybe|about|around|roughly|approximately|like)\b/g, " ")
    .replace(/\bit'?s\b/g, " ")
    .replace(/\b(half an hour|half hour|half-hour)\b/g, "30 minutes")
    .replace(/\b(an|one) hour\b/g, "60 minutes")
    .replace(/\b(a|one) hundred\b/g, "100").replace(/\bhundred\b/g, "100")
    .replace(/\b(\d+) hundred\b/g, (_, n) => String(Number(n) * 100))
    .replace(/\b(a )?dozen\b/g, "12")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export function parseQuick(text) {
  const t = normalize(text);
  const out = { items: [], venue: "", goodForMinutes: null, eventName: "" };

  const mins = t.match(/(\d+|an?|one|two|half an?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (mins) {
    const n = /half/i.test(mins[1]) ? 0.5 : toNumber(mins[1]) ?? 1;
    out.goodForMinutes = Math.round(/^h/i.test(mins[2]) ? n * 60 : n);
  }
  const venue = t.match(/\b(?:at|in)\s+(?:the\s+)?([a-z0-9' ]{2,40}?)(?=,|\.|;| good| for | until| by |$| and )/i);
  if (venue && !/^\d/.test(venue[1])) out.venue = titleCase(venue[1].trim());
  const name = t.match(/\b(?:from|after)\s+(?:the\s+)?([a-z0-9' ]{3,40}?)(?=,|\.| at | in |$)/i);
  if (name) out.eventName = titleCase(name[1].trim());

  // "<number> [unit of] <food words>" chunks, split on commas and "and".
  const chunks = t.split(/,|;|\band\b|\.|\bplus\b/i);
  for (const chunk of chunks) {
    const m = chunk.trim().match(/^(?:about|around|roughly|maybe|we have|there are|there is|got)?\s*(\d+|[a-z]+)\s+(.+)$/i);
    if (!m) continue;
    const n = toNumber(m[1]);
    if (!n || n > 100000) continue;
    let rest = m[2];
    const unit = rest.match(UNITS);
    rest = rest.replace(UNITS, "");
    rest = rest.split(STOP)[0].replace(/[^a-z' -]/gi, " ").replace(/\s+/g, " ").trim();
    if (!rest || /^(minutes?|mins?|hours?|hrs?)$/i.test(rest)) continue;
    out.items.push({ item: titleCase(rest), left: n, unit: unit ? unit[1].toLowerCase().replace(/s$/, "") + "s" : "portions" });
  }
  return out;
}

function firstJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

async function parseWithModel(text) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_VISION_MODEL;
  if (!key || !model) return null;
  const instruction = `Turn this food rescue report into JSON only, no other text:
{"eventName": string, "venue": string, "goodForMinutes": number|null, "items": [{"item": string, "left": number, "unit": string}]}
Rules: use only facts in the report; item names short and plain (for example "Tacos"); left is a whole number; unit like "portions", "bags", "trays"; if a time window is not stated use null. Report: ${JSON.stringify(text)}`;
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: instruction }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const textOut = data.output_text ?? (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("");
    const j = firstJson(textOut);
    if (!j || !Array.isArray(j.items)) return null;
    const items = j.items
      .map((i) => ({ item: String(i.item || "").trim().slice(0, 100), left: Math.max(0, Math.round(Number(i.left))), unit: String(i.unit || "portions").slice(0, 30) }))
      .filter((i) => i.item && Number.isFinite(i.left) && i.left > 0);
    if (!items.length) return null;
    const g = Number(j.goodForMinutes);
    return { items, venue: String(j.venue || "").slice(0, 200), eventName: String(j.eventName || "").slice(0, 120), goodForMinutes: Number.isFinite(g) && g > 0 ? Math.round(g) : null };
  } catch {
    return null;
  }
}

// core: { snapshot, createEvent, patchEvent, submitReport, sendOffers }, after(): places the calls.
export function registerQuick(app, core, after) {
  app.post("/api/quick", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 600) return res.status(400).json({ error: "Say or type what is left, for example: 100 tacos at the main hall, good for 45 minutes." });
    const parsed = (await parseWithModel(text)) || parseQuick(text);
    if (!parsed.items.length) return res.status(400).json({ error: "I could not find any food and amounts. Try: 100 tacos and 10 sandwiches at the main hall." });
    const goodFor = parsed.goodForMinutes || 45;
    try {
      const existing = core.snapshot().event;
      const venue = parsed.venue || existing?.venue || "Event venue";
      const name = parsed.eventName || existing?.name || `Leftovers at ${venue}`;
      core.createEvent({ name, venue, date: new Date().toISOString().slice(0, 10), goodForMinutes: goodFor,
        items: parsed.items.map((i) => ({ item: i.item, ordered: i.left })), notes: `Reported by voice: ${text.slice(0, 300)}` });
      core.submitReport({ items: parsed.items.map((i) => ({ item: i.item, left: i.left, unit: i.unit, source: "manual" })) });
      const snap = core.sendOffers({});
      res.json({ ...snap, quick: { understood: parsed, goodForMinutes: goodFor } });
      Promise.resolve().then(after).catch(() => {});
    } catch (error) {
      res.status(error?.status || 500).json({ error: error?.status ? error.message : "Could not start the rescue. Try again." });
    }
  });
}
