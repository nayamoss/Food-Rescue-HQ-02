// Run: node artifacts/api-server/lib/sms.selftest.mjs  (no network; needs express resolvable)
import assert from "node:assert/strict";
import { registerSms, textForOffers, phoneDigits, parseCommand } from "./sms.js";

const routes = {};
const fakeApp = { use(prefix, router) {
  for (const layer of router.stack) if (layer.route) routes[`${prefix}${layer.route.path}`] = layer.route.stack.at(-1).handle;
} };
const calls = [], feed = [];
const state = {
  volunteers: [
    { id: "v1", name: "Alex Rivera", phone: "+14155550101", optedIn: true },
    { id: "v2", name: "Jordan Lee", phone: "+14155550102", optedIn: true },
  ],
  offers: [
    { id: "o1", volunteerId: "v1", item: "Tacos", portions: 100, status: "offered", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "o2", volunteerId: "v2", item: "Soda", portions: 20, status: "offered", updatedAt: "2026-01-01T00:00:00Z" },
  ],
};
const setStatus = (id, status) => { state.offers.find((o) => o.id === id).status = status; };
const core = {
  getState: () => state,
  describeOffer: (id) => {
    const o = state.offers.find((x) => x.id === id);
    return o ? { volunteerName: "Alex Rivera", placeName: "Partner shelter A", item: o.item, portions: o.portions, venue: "Arena & Co", minutes: 30 } : null;
  },
  respondToOffer: (id, a) => { calls.push([id, a]); setStatus(id, a === "accept" ? "accepted" : "declined"); },
  pickupOffer: (id) => { calls.push([id, "pickup"]); setStatus(id, "picked_up"); },
  dropoffOffer: (id) => { calls.push([id, "dropoff"]); setStatus(id, "dropped_off"); },
  addFeed: (t) => feed.push(t),
};

// helpers
assert.equal(phoneDigits("+1 (202) 555-0101"), "14155550101");
assert.equal(phoneDigits("4155550101"), "14155550101");
assert.equal(parseCommand(" yes! "), "accept");
assert.equal(parseCommand("picked up"), "pickup");
assert.equal(parseCommand("maybe"), null);

// skip when unconfigured
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) delete process.env[k];
let out = await textForOffers(core, ["o1"]);
assert.equal(out.skipped, true);
assert.match(out.reason, /TWILIO_ACCOUNT_SID/);

// send (stub fetch)
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "tok";
process.env.TWILIO_FROM_NUMBER = "+15550000000";
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 201 }; };
out = await textForOffers(core, ["o1", "missing"]);
assert.equal(out.skipped, false);
assert.deepEqual(out.results[0], { offerId: "o1", ok: true });
assert.equal(out.results[1].skipped, true);
assert.equal(sent.length, 1);
assert.equal(sent[0].url, "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
assert.equal(sent[0].init.headers.Authorization, "Basic " + Buffer.from("ACtest:tok").toString("base64"));
const form = sent[0].init.body;
assert.equal(form.get("To"), "+14155550101");
assert.equal(form.get("From"), "+15550000000");
assert.equal(form.get("Body"), "Food Rescue: 100 Tacos from Arena & Co to Partner shelter A. Pick up within 30 min. Reply YES to accept or NO to decline.");
assert.deepEqual(feed, ["Texted Alex Rivera about 100 Tacos."]);
assert.ok(!feed.join(" ").match(/\d{7,}/), "feed must not contain phone numbers");

// failed send does not throw
globalThis.fetch = async () => { throw new Error("offline"); };
out = await textForOffers(core, ["o1"]);
assert.equal(out.results[0].ok, false);

// inbound webhook
registerSms(fakeApp, core);
const inbound = (body) => new Promise((resolve) => {
  const res = { status() { return this; }, type() { return this; }, send: resolve };
  routes["/sms/inbound"]({ body }, res);
});

let x = await inbound({ From: "+14155550101", Body: "Yes" });
assert.deepEqual(calls.at(-1), ["o1", "accept"]);
assert.match(x, /^<\?xml[^>]*\?><Response><Message>Thanks Alex Rivera!/);
assert.ok(x.includes("Partner shelter A"));

x = await inbound({ From: "+14155550101", Body: "PICKED UP" });
assert.deepEqual(calls.at(-1), ["o1", "pickup"]);
x = await inbound({ From: "+14155550101", Body: "done" });
assert.deepEqual(calls.at(-1), ["o1", "dropoff"]);
assert.match(x, /Delivered!/);

x = await inbound({ From: "+1 202 555 0102", Body: "no" });
assert.deepEqual(calls.at(-1), ["o2", "decline"]);
assert.match(x, /Understood/);

const before = calls.length;
x = await inbound({ From: "+14155550102", Body: "YES" });
assert.equal(calls.length, before);
assert.match(x, /no open offer/);

x = await inbound({ From: "+19998887777", Body: "YES" });
assert.equal(calls.length, before);
assert.match(x, /do not recognise this number/);
assert.ok(!x.includes("9998887777"), "reply must not echo the number");

x = await inbound({ From: "+14155550101", Body: "<b>huh</b>" });
assert.match(x, /did not understand/);
assert.ok(!x.includes("<b>"));

console.log("sms selftest: all passed");
