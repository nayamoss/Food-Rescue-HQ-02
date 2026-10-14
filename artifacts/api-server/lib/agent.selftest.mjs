import assert from "node:assert/strict";
import express from "express";
import { registerAgent, scriptedTurn, parseAgentReply, firstJsonObject, parseMinutes } from "./agent.js";

// ---- fake core (no disk) ----------------------------------------------------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
let state;
const resetState = () => {
  state = {
    event: { id: "e1", name: "Gala", venue: "Town Hall", date: "Fri", organizer: "Naya", contact: "", notes: "",
      items: [{ item: "Pizza", ordered: 20 }] },
    places: [
      { id: "p1", name: "Partner shelter A", type: "shelter", distanceMiles: 2, capacity: 150, accepts: ["prepared", "packaged", "drinks"] },
      { id: "p3", name: "Community kitchen", type: "kitchen", distanceMiles: 6, capacity: 100, accepts: ["prepared", "packaged"] },
    ],
    offers: [],
  };
};
const fakeCore = {
  HttpError,
  categorize: () => "prepared",
  snapshot: () => structuredClone(state),
  patchEvent: (b) => {
    if (b.goodForMinutes !== undefined && (!Number.isInteger(b.goodForMinutes) || b.goodForMinutes < 1 || b.goodForMinutes > 1440)) {
      throw new HttpError(400, "bad minutes");
    }
    state.event = { ...state.event, ...b };
    return structuredClone(state);
  },
};

// ---- stub fetch -------------------------------------------------------------
const realFetch = globalThis.fetch;
const calls = [];
let modelText = "";
let mode = "ok";
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.openai.com/")) {
    calls.push({ url: String(url), body: JSON.parse(opts.body), opts });
    if (mode === "error") return new Response("{}", { status: 500 });
    if (mode === "throw") throw new Error("network down");
    return Response.json({ output: [{ content: [{ type: "output_text", text: modelText }] }] });
  }
  return realFetch(url, opts);
};

// ---- pure helpers -----------------------------------------------------------
assert.equal(parseMinutes("45 minutes"), 45);
assert.equal(parseMinutes("2 hours"), 120);
assert.equal(parseMinutes("half an hour"), 30);
assert.equal(parseMinutes("not sure"), null);
assert.deepEqual(firstJsonObject('x {"a":"}"} y {"b":1}'), { a: "}" });
assert.equal(firstJsonObject("no json"), null);
assert.equal(parseAgentReply({ chips: [] }), null, "empty reply is unusable");
const p = parseAgentReply({ reply: "Call 555-123-4567 now \u{1F600}", chips: ["a", "b", "c", "d", "e"], updates: { goodForMinutes: 99999, contact: "Sam" }, done: "yes" });
assert.ok(!p.reply.includes("555"), "phone numbers are hidden");
assert.ok(!/\p{Extended_Pictographic}/u.test(p.reply), "emojis are stripped");
assert.equal(p.chips.length, 4);
assert.deepEqual(p.updates, { contact: "Sam" }, "out-of-range minutes dropped");
assert.equal(p.done, false);
assert.equal(scriptedTurn(null, "").chips.length, 0);

// ---- server -----------------------------------------------------------------
const app = express();
app.use(express.json());
registerAgent(app, fakeCore);
app.use((err, _req, res, _next) => res.status(500).json({ error: String(err) }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/agent`;
const post = async (path, body = {}) => {
  const r = await realFetch(`${base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

// 1. Scripted path (no key): full conversation in order.
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_AGENT_MODEL;
delete process.env.OPENAI_VISION_MODEL;
resetState();
let r = await post("message", {});
assert.match(r.json.reply, /How long is the food good for/);
assert.deepEqual(r.json.chips.slice(0, 3), ["30 minutes", "45 minutes", "60 minutes"]);
assert.equal(r.json.done, false);
assert.ok(!/configur|api key|openai/i.test(r.json.reply), "never mentions configuration");
r = await post("message", { message: "soon-ish" });
assert.match(r.json.reply, /How many minutes/);
assert.equal(r.json.snapshot, undefined);
r = await post("message", { message: "45 minutes" });
assert.equal(r.json.snapshot.event.goodForMinutes, 45);
assert.deepEqual(r.json.updates, { goodForMinutes: 45 });
assert.ok(r.json.chips.includes("Use the venue"));
r = await post("message", { message: "Use the venue" });
assert.match(state.event.notes, /Pickup at the venue/);
assert.match(r.json.reply, /Who should volunteers ask for/);
r = await post("message", { message: "Me" });
assert.equal(state.event.contact, "Naya");
assert.match(r.json.reply, /allergens/);
r = await post("message", { message: "Contains nuts" });
assert.equal(r.json.done, true);
assert.match(state.event.notes, /Contains nuts/);
r = await post("message", {});
assert.equal(r.json.done, true);
assert.equal(calls.length, 0, "no network without a key");

// 2. Parsed model response (agent model wins over vision model).
process.env.OPENAI_API_KEY = "test-key";
process.env.OPENAI_VISION_MODEL = "vision-model";
process.env.OPENAI_AGENT_MODEL = "agent-model";
resetState();
modelText = 'Sure! {"reply":"Got it. Who is the contact on site?","chips":["Me","Venue manager"],"updates":{"goodForMinutes":60},"done":false} thanks';
r = await post("message", { message: "an hour", history: [{ role: "assistant", text: "How long is the food good for?" }, { role: "bogus", text: "" }] });
assert.equal(r.json.reply, "Got it. Who is the contact on site?");
assert.deepEqual(r.json.chips, ["Me", "Venue manager"]);
assert.equal(r.json.snapshot.event.goodForMinutes, 60);
assert.equal(calls.at(-1).body.model, "agent-model");
assert.equal(calls.at(-1).opts.headers.Authorization, "Bearer test-key");
assert.match(calls.at(-1).body.instructions, /Never ask for phone numbers/);
assert.equal(calls.at(-1).body.input.length, 2, "empty history entries dropped, message appended");
delete process.env.OPENAI_AGENT_MODEL;
await post("message", {});
assert.equal(calls.at(-1).body.model, "vision-model", "falls back to the vision model");

// Model claims done too early: we ask for what is missing instead.
modelText = '{"reply":"All set.","chips":[],"done":true}';
r = await post("message", { message: "ok" });
assert.equal(r.json.done, false);
assert.match(r.json.reply, /pick up/);

// 3. Malformed model response falls back to the scripted flow.
resetState();
modelText = "I think it is about 45 minutes {not json";
r = await post("message", { message: "45" });
assert.equal(r.json.snapshot.event.goodForMinutes, 45);
assert.match(r.json.reply, /pick up/);
mode = "error";
r = await post("message", { message: "Loading dock" });
assert.match(state.event.notes, /Pickup at Loading dock/);
mode = "throw";
r = await post("message", {});
assert.match(r.json.reply, /Who should volunteers ask for/);
mode = "ok";
modelText = '{"reply":"Okay","updates":{"goodForMinutes":"5000"}}';
r = await post("message", { message: "x" });
assert.equal(r.json.reply, "Okay", "invalid update is dropped, reply kept");
assert.equal(r.json.snapshot, undefined);

// 4. Explain.
resetState();
r = await post("explain");
assert.match(r.json.reply, /no places matched/);
state.offers = [
  { id: "o1", placeId: "p1", item: "Pizza", portions: 12, status: "proposed" },
  { id: "o2", placeId: "p3", item: "Salad", portions: 5, status: "proposed" },
];
delete process.env.OPENAI_API_KEY;
r = await post("explain");
assert.match(r.json.reply, /Partner shelter A gets 12 Pizza because it is 2 miles away, has room for 150/);
assert.equal(r.json.reasons.length, 2);
process.env.OPENAI_API_KEY = "test-key";
modelText = '{"reply":"Shelter A is closest and has room. The kitchen takes the rest."}';
r = await post("explain");
assert.equal(r.json.reply, "Shelter A is closest and has room. The kitchen takes the rest.");
assert.match(calls.at(-1).body.instructions, /Never invent/);
modelText = "garbage";
r = await post("explain");
assert.match(r.json.reply, /Partner shelter A gets 12 Pizza/);

server.close();
globalThis.fetch = realFetch;
console.log("agent self-test passed");
