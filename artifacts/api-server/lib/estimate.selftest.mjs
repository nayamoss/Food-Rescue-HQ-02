import assert from "node:assert/strict";
import express from "express";
import { registerEstimate, parseEstimate, buildInstruction, reconcileCounts } from "./estimate.js";

const png = "data:image/png;base64,iVBORw0KGgo=";
const realFetch = globalThis.fetch;
const calls = [];
let mode = "ok";

globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.openai.com/")) {
    calls.push({ url: String(url), opts });
    if (mode === "error") return new Response("{}", { status: 500 });
    if (mode === "throw") throw new Error("network down");
    const text = 'Here you go {"items":[{"item":"Pizza","count":6.4,"unit":"boxes","confidence":"high","note":"ok"},' +
      '{"item":"Bad","count":"lots"},{"item":"Neg","count":-3,"unit":"x","confidence":"zzz"},' +
      '{"item":"Huge","count":9999999,"unit":"x","confidence":"low"}],"unreadable":false,"overall_note":"fine"} trailing';
    return Response.json({ output: [{ content: [{ type: "output_text", text }] }] });
  }
  return realFetch(url, opts);
};

const parsed = parseEstimate('x {"items":[{"item":"A","count":2}],"unreadable":false,"overall_note":"n"}');
assert.equal(parsed.items[0].count, 2);
assert.equal(parsed.items[0].count_method, "estimated");
assert.equal(parseEstimate("no json"), null);

// Two counts that roughly agree: keep the larger. Far apart: keep the first, flag low confidence.
const two = parseEstimate('{"items":[{"item":"Tacos","count":28,"recount":31,"count_method":"rows_by_columns","confidence":"high","note":"5 rows"},' +
  '{"item":"Chips","count":10,"recount":40,"count_method":"bogus","confidence":"high","note":"pile"},' +
  '{"item":"Rice","count":"7","recount":"x","confidence":"medium"}],"unreadable":false}');
assert.deepEqual(two.items.map((i) => [i.item, i.count, i.confidence, i.count_method]),
  [["Tacos", 31, "high", "rows_by_columns"], ["Chips", 10, "low", "estimated"], ["Rice", 7, "medium", "estimated"]]);
assert.match(two.items[1].note, /^pile Two counts disagreed \(10 and 40\)/);
assert.deepEqual(reconcileCounts(30, 30, "high", "n"), { count: 30, confidence: "high", note: "n" });
assert.equal(reconcileCounts(4, 5, "high", "").count, 5);
assert.equal(reconcileCounts(1, 2, "high", "").confidence, "low");

// Instruction asks for careful, complete counts and names the expected items.
const text = buildInstruction([{ item: "Tacos", ordered: 40 }, { item: "Chips", ordered: null }]);
for (const needle of ["rows_by_columns", "recount", "Count carefully and completely", "ONLY food that is actually visible", "Never default to a small",
  "much larger than a casual glance", "Ordered items: Tacos (ordered 40), Chips."]) {
  assert.ok(text.includes(needle), `instruction missing: ${needle}`);
}
assert.ok(buildInstruction([]).includes("none were given"));

const app = express();
registerEstimate(app);
app.use(express.json({ limit: "8kb" }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/estimate`;
const post = async (body) => {
  const r = await realFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const body = { images: [png], items: [{ item: "Pizza", ordered: 10 }] };

delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_VISION_MODEL;
let r = await post(body);
assert.equal(r.json.notConfigured, true);
assert.equal(calls.length, 0);

process.env.OPENAI_API_KEY = "test-key";
process.env.OPENAI_VISION_MODEL = "test-model";
r = await post(body);
assert.equal(r.status, 200);
assert.deepEqual(r.json.items.map((i) => [i.item, i.count, i.confidence]),
  [["Pizza", 6, "high"], ["Neg", 0, "low"], ["Huge", 100000, "low"]]);
assert.equal(r.json.unreadable, false);
assert.equal(r.json.overallNote, "fine");
const sent = JSON.parse(calls[0].opts.body);
assert.equal(sent.model, "test-model");
assert.equal(calls[0].opts.headers.Authorization, "Bearer test-key");
assert.equal(sent.input[0].content.find((p) => p.type === "input_image").detail, "high");

// Body larger than the global 8kb limit still works on this route.
const big = "data:image/png;base64," + "A".repeat(40000);
r = await post({ images: [big], items: [] });
assert.equal(r.status, 200);
assert.equal(r.json.items.length, 3);

mode = "error";
r = await post(body);
assert.equal(r.json.failed, true);
mode = "throw";
r = await post(body);
assert.equal(r.json.failed, true);

mode = "ok";
assert.equal((await post({ images: [], items: [] })).status, 400);
assert.equal((await post({ images: ["data:text/plain;base64,AAAA"], items: [] })).status, 400);

server.close();
console.log("estimate self-test passed");
