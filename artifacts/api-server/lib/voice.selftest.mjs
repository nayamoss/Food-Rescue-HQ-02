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
assert.match(x, /Food rescue pickup\. Pick up 100 tacos at Arena &amp; Co and drop off at Hope Kitchen\. Press 1 to accept, 2 to decline\./);
assert.match(x, /<Gather numDigits="1" action="https:\/\/example.test\/voice\/answer\?volunteerId=v1&amp;offerId=o1"/);
assert.match(x, /No response\. Goodbye\.<\/Say><Hangup\/>/);
assert.ok(x.includes("Arena &amp; Co"));

x = await run("/voice/answer", { volunteerId: "v1", offerId: "o1" }, { Digits: "1" });
assert.deepEqual(calls.at(-1), ["o1", "accept"]);
assert.match(x, /within 30 minutes/);
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

// ---- two-stage flow end to end against the real core (temp DATA_DIR, fetch stubbed, no network) ----
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const path = await import("node:path");
const dir = mkdtempSync(path.join(tmpdir(), "food-rescue-voice-"));
process.env.DATA_DIR = dir;
const realFetch = globalThis.fetch;
const dialed = [];
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith("https://api.twilio.com/"), "only Twilio is called");
  const p = new URLSearchParams(init.body);
  dialed.push({ to: p.get("To"), url: p.get("Url") });
  return { ok: true, status: 201, json: async () => ({}) };
};
try {
  const c = await import("./core.js");
  // Same adapter shape as server.js.
  const vc = {
    getState: () => c.internalState(),
    describeOffer: (id) => c.describeOffer(id),
    respondToOffer: (id, a) => c.respondToOffer(id, a),
    placeAnswer: (id, a) => c.placeAnswer(id, a),
    deliverOffer: (id, o) => c.deliverOffer(id, o),
    openJobForPhone: (p) => c.openJobForPhone(p),
    callTarget: (id) => c.callTarget(id),
    addFeed: (t) => c.postUpdate(t),
  };
  for (const k of Object.keys(routes)) delete routes[k];
  registerVoice(fakeApp, vc);
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_FROM_NUMBER = "+15005550006";

  c.resetAll();
  c.patchPlace("p1", { phone: "646 555 0101", address: "1 Shelter Way" });
  c.patchPlace("p2", { phone: "+16465550102" });
  c.patchPlace("p3", { phone: "+16465550103" });
  c.patchVolunteer("v2", { phone: "6465550202" });
  c.patchVolunteer("v3", { phone: "6465550203" });
  c.createEvent({ name: "Gala", venue: "Main Hall", items: [{ item: "Tacos", ordered: 100 }], goodForMinutes: 45 });
  c.submitReport({ items: [{ item: "Tacos", left: 60 }] });
  c.startPlaceOutreach({});
  const ids = c.takePendingCalls();
  assert.equal(ids.length, 3, "every place with a phone");
  let out = await callForOffers(vc, ids);
  assert.ok(out.results.every((x) => x.ok && x.kind === "place"));
  assert.deepEqual(dialed.map((d) => d.to).sort(), ["+16465550101", "+16465550102", "+16465550103"]);
  assert.ok(dialed.every((d) => d.url.startsWith("https://example.test/voice/offer?offerId=")));
  const byPlace = (pid) => c.snapshot().offers.find((o) => o.placeId === pid).id;
  const [a, b2, k] = [byPlace("p1"), byPlace("p2"), byPlace("p3")];

  x = await run("/voice/offer", { offerId: a, placeId: "p1" });
  assert.match(x, /Food rescue\. 60 Tacos available at Main Hall, pickup within \d+ minutes\. Press 1 if you can take it, 2 if not\./);
  assert.ok(x.includes(`/voice/answer?offerId=${a}&amp;placeId=p1`));

  // kitchen says no, shelter B says yes first and wins, shelter A's late yes hears it is claimed
  x = await run("/voice/answer", { offerId: k, placeId: "p3" }, { Digits: "2" });
  assert.match(x, /Understood\. Thank you\./);
  assert.equal(c.getOffer(k).status, "declined");
  x = await run("/voice/answer", { offerId: b2, placeId: "p2" }, { Digits: "1" });
  assert.match(x, /Partner shelter B has the Tacos/);
  assert.equal(c.getOffer(a).status, "taken");
  x = await run("/voice/answer", { offerId: a, placeId: "p1" }, { Digits: "1" });
  assert.match(x, /Thanks, this has already been claimed\./);
  x = await run("/voice/offer", { offerId: a, placeId: "p1" });
  assert.match(x, /already been claimed/, "a call answered after the lot was taken");
  assert.equal(c.snapshot().lots[0].label, "Partner shelter B said yes. Calling Jordan Lee");

  // stage 2: Jordan is called, declines, Sam is called and accepts
  dialed.length = 0;
  out = await callForOffers(vc, c.takePendingCalls());
  assert.deepEqual(dialed.map((d) => d.to), ["+16465550202"]);
  assert.ok(dialed[0].url.includes("volunteerId=v2"));
  x = await run("/voice/offer", { volunteerId: "v2", offerId: b2 });
  assert.match(x, /Food rescue pickup\. Pick up 60 Tacos at Main Hall and drop off at Partner shelter B\. Press 1 to accept, 2 to decline\./);
  x = await run("/voice/answer", { volunteerId: "v2", offerId: b2 }, { Digits: "2" });
  assert.match(x, /Understood/);
  assert.equal(c.getOffer(b2).volunteerId, "v3");
  dialed.length = 0;
  await callForOffers(vc, c.takePendingCalls());
  assert.deepEqual(dialed.map((d) => d.to), ["+16465550203"]);
  x = await run("/voice/answer", { volunteerId: "v2", offerId: b2 }, { Digits: "1" });
  assert.match(x, /no longer available/, "Jordan's stale call cannot accept Sam's job");
  x = await run("/voice/answer", { volunteerId: "v3", offerId: b2 }, { Digits: "1" });
  assert.match(x, /When you have dropped it off, call this number back or open your link and tap Delivered\./);
  assert.equal(c.getOffer(b2).status, "accepted");
  assert.equal(c.snapshot().summary.rescued, 0, "not rescued until delivered");

  // inbound: Sam calls back and presses 1
  x = await run("/voice/inbound", {}, { From: "+19995550000" });
  assert.match(x, /could not find a volunteer/);
  x = await run("/voice/inbound", {}, { From: "+16465550202" });
  assert.match(x, /no open pickup/);
  x = await run("/voice/inbound", {}, { From: "+16465550203" });
  assert.match(x, /Hi Sam Taylor\. Your pickup: 60 Tacos from Main Hall to Partner shelter B\. Press 1 if you have delivered it\./);
  assert.ok(x.includes(`/voice/delivered?offerId=${b2}&amp;volunteerId=v3`));
  x = await run("/voice/delivered", { offerId: b2, volunteerId: "v2" }, { Digits: "1" });
  assert.match(x, /could not be marked/, "someone else's phone cannot confirm");
  x = await run("/voice/delivered", { offerId: b2, volunteerId: "v3" }, { Digits: "9" });
  assert.equal(c.getOffer(b2).status, "accepted");
  x = await run("/voice/delivered", { offerId: b2, volunteerId: "v3" }, { Digits: "1" });
  assert.match(x, /marked as delivered/);
  const snap = c.snapshot();
  assert.equal(snap.lots[0].status, "delivered");
  assert.equal(snap.summary.rescued, 60);
  assert.equal(snap.incident.status, "resolved");
  assert.ok(!JSON.stringify(snap).includes("6465550"), "no full phone number in the snapshot");

  // drop-off address is read to the volunteer when the place has one
  c.createEvent({ name: "Gala 2", venue: "Main Hall", items: [{ item: "Soup", ordered: 10 }], goodForMinutes: 45 });
  c.submitReport({ items: [{ item: "Soup", left: 10 }] });
  c.startPlaceOutreach({});
  c.takePendingCalls();
  const soup = c.snapshot().offers.find((o) => o.placeId === "p1").id;
  x = await run("/voice/answer", { offerId: soup, placeId: "p1" }, { Digits: "1" });
  x = await run("/voice/offer", { volunteerId: "v2", offerId: soup });
  assert.match(x, /drop off at Partner shelter A, 1 Shelter Way\./);
} finally {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
}
console.log("voice self-test passed");
