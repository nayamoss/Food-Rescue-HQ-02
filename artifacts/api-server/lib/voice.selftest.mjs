// Run: node artifacts/api-server/lib/voice.selftest.mjs  (no network; needs express resolvable)
import assert from "node:assert/strict";
import { registerVoice, callForOffers } from "./voice.js";

process.env.PUBLIC_BASE_URL = "https://example.test";
const routes = {};
const fakeApp = { use(prefix, router) {
  for (const layer of router.stack) if (layer.route) routes[`${prefix}${layer.route.path}`] = layer.route.stack.at(-1).handle;
} };
const calls = [], feed = [];
const core = {
  getState: () => ({ volunteers: [] }),
  describeOffer: (id) => id === "o1" ? { volunteerName: "Alex <Rivera>", placeName: "Hope Kitchen", item: "tacos", portions: 100, venue: "Arena & Co", minutes: 30, deadlineText: "6:30 PM" } : null,
  respondToOffer: (id, a) => calls.push([id, a]),
  addFeed: (t) => feed.push(t),
};
registerVoice(fakeApp, core);
const run = (path, query, body = {}) => new Promise((resolve) => {
  const res = { status() { return this; }, type() { return this; }, send: resolve };
  routes[path]({ query, body }, res);
});

let x = await run("/voice/offer", { volunteerId: "v1", offerId: "o1" });
assert.match(x, /Press 1 to accept, press 2 to decline/);
assert.match(x, /<Gather numDigits="1" action="https:\/\/example.test\/voice\/answer\?volunteerId=v1&amp;offerId=o1"/);
assert.match(x, /No response\. Goodbye\.<\/Say><Hangup\/>/);
assert.ok(x.includes("Arena &amp; Co"));

x = await run("/voice/answer", { volunteerId: "v1", offerId: "o1" }, { Digits: "1" });
assert.deepEqual(calls.at(-1), ["o1", "accept"]);
assert.match(x, /6:30 PM/);
assert.ok(x.includes("Alex &lt;Rivera&gt;"));
x = await run("/voice/answer", { volunteerId: "v1", offerId: "o1" }, { Digits: "2" });
assert.deepEqual(calls.at(-1), ["o1", "decline"]);
assert.match(x, /Understood\. Thank you\./);
x = await run("/voice/answer", { volunteerId: "v1", offerId: "o1" }, { Digits: "9" });
assert.match(x, /<Gather/);
assert.match(x, /retry=1/);
x = await run("/voice/answer", { volunteerId: "v1", offerId: "o1", retry: "1" }, { Digits: "9" });
assert.ok(!x.includes("<Gather"));

for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) delete process.env[k];
const r = await callForOffers(core, ["o1"]);
assert.equal(r.skipped, true);
console.log("voice self-test passed");
