import assert from "node:assert/strict";
import express from "express";
import { registerEstimate, parseEstimate } from "./estimate.js";

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
assert.equal(parseEstimate("no json"), null);

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
