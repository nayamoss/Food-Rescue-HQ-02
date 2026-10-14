// Run: node artifacts/api-server/lib/connect.selftest.mjs  (no network: fetch is stubbed; temp DATA_DIR)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "food-rescue-connect-"));
process.env.DATA_DIR = dir;
// Fake values only: never real credentials.
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_FROM_NUMBER = "+15005550006";
process.env.PUBLIC_BASE_URL = "https://example.test/";

const realFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith("https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls.json"), "only Twilio is called");
  sent.push({ url: String(url), auth: init.headers.Authorization, body: new URLSearchParams(init.body) });
  return { ok: true, status: 201, json: async () => ({}) };
};

try {
  const core = await import("./core.js");
  const { connectVolunteer, connectTwiml, registerConnect, NO_COORDINATOR, NO_VOLUNTEER_PHONE } = await import("./connect.js");
  const adapter = {
    getVolunteer: (id) => core.getVolunteer(id),
    volunteerPhone: (id) => core.volunteerPhone(id),
    coordinatorPhone: () => core.coordinatorPhone(),
    addFeed: (t) => core.postUpdate(t),
  };

  // Settings: masked in the snapshot, normalised like volunteers, empty clears.
  let snap = core.snapshot();
  assert.deepEqual(snap.settings, { coordinatorPhoneSet: false, coordinatorPhoneLast4: "" });
  assert.throws(() => core.setSettings({ coordinatorPhone: "123" }), /10-digit/);

  // 1. Missing coordinator phone.
  let r = await connectVolunteer(adapter, "v2");
  assert.equal(r.status, 409);
  assert.equal(r.body.error, NO_COORDINATOR);

  snap = core.setSettings({ coordinatorPhone: "(762) 235-7374" });
  assert.deepEqual(snap.settings, { coordinatorPhoneSet: true, coordinatorPhoneLast4: "7374" });
  assert.equal(core.coordinatorPhone(), "+17622357374");
  assert.ok(!JSON.stringify(core.snapshot()).includes("7622357374"), "snapshot never has the full number");

  // 2. Missing volunteer phone.
  r = await connectVolunteer(adapter, "v2");
  assert.equal(r.status, 409);
  assert.equal(r.body.error, NO_VOLUNTEER_PHONE);
  assert.equal(sent.length, 0);

  // Unknown volunteer.
  r = await connectVolunteer(adapter, "nope");
  assert.equal(r.status, 404);

  // 3. Success: request shape.
  core.patchVolunteer("v2", { phone: "1 646 555 0123" });
  r = await connectVolunteer(adapter, "v2");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, message: "Calling your phone now. Answer to be connected to Jordan." });
  assert.equal(sent.length, 1);
  const call = sent[0];
  assert.equal(call.auth, "Basic " + Buffer.from("ACtest:test-token").toString("base64"));
  assert.equal(call.body.get("To"), "+17622357374");
  assert.equal(call.body.get("From"), "+15005550006");
  assert.equal(call.body.get("Url"), "https://example.test/voice/connect?volunteerId=v2");
  const feedLine = core.snapshot().feed.find((f) => f.text.includes("Connecting HQ"));
  assert.equal(feedLine?.text, "Connecting HQ to Jordan Lee by phone.");
  assert.ok(!core.snapshot().feed.some((f) => /\d{4}/.test(f.text) && f.text.includes("Jordan")), "no numbers in the feed");

  // Missing env: skipped, nothing dialed.
  delete process.env.TWILIO_AUTH_TOKEN;
  r = await connectVolunteer(adapter, "v2");
  assert.equal(r.status, 409);
  assert.equal(sent.length, 1);
  process.env.TWILIO_AUTH_TOKEN = "test-token";

  // 4. TwiML for /voice/connect (through the registered route).
  const routes = {};
  const fakeApp = {
    post(p, h) { routes[`POST ${p}`] = h; },
    use(prefix, router) { for (const l of router.stack) if (l.route) for (const m of Object.keys(l.route.methods)) routes[`${m.toUpperCase()} ${prefix}${l.route.path}`] = l.route.stack.at(-1).handle; },
  };
  registerConnect(fakeApp, adapter);
  const twimlFor = (volunteerId) => new Promise((resolve) => {
    const res = { status() { return this; }, type() { return this; }, send: resolve };
    routes["POST /voice/connect"]({ query: { volunteerId }, body: {} }, res);
  });
  let x = await twimlFor("v2");
  assert.equal(x, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you to Jordan Lee.</Say>' +
    '<Dial callerId="+15005550006" timeout="25">+16465550123</Dial><Say>The call has ended.</Say></Response>');
  x = await twimlFor("ghost");
  assert.match(x, /<Say>That volunteer is not available\.<\/Say><Hangup\/>/);
  assert.ok(!x.includes("<Dial"));

  // XML escaping of the volunteer name.
  core.patchVolunteer("v2", { name: "Jo <&> Lee" });
  x = connectTwiml(adapter, "v2");
  assert.ok(x.includes("Connecting you to Jo &lt;&amp;&gt; Lee."));

  // The API route returns the same status/body.
  const json = await new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, b }); } };
    routes["POST /api/volunteers/:id/connect"]({ params: { id: "v2" } }, res);
  });
  assert.equal(json.code, 200);
  assert.equal(json.b.ok, true);

  // Empty clears the coordinator phone.
  snap = core.setSettings({ coordinatorPhone: "" });
  assert.deepEqual(snap.settings, { coordinatorPhoneSet: false, coordinatorPhoneLast4: "" });
  assert.equal(core.coordinatorPhone(), "");

  console.log("connect selftest: ok");
} finally {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
}
