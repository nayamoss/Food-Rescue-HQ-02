import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from "pino";
import * as core from "./lib/core.js";
import { registerQuick } from "./lib/quick.js";
import { registerEstimate } from "./lib/estimate.js";
import { registerAgent } from "./lib/agent.js";

const log = pino();
const root = fileURLToPath(new URL("../../", import.meta.url));
const clients = new Set();
core.onChange((snap) => {
  const message = `data: ${JSON.stringify(snap)}\n\n`;
  for (const res of clients) res.write(message);
});

// Optional voice module (owned separately). If it is missing or a call fails, the app keeps working.
let voice = null;
try { voice = await import("./lib/voice.js"); } catch { voice = null; }
// The voice module talks to the core only through this small adapter.
// getState returns the internal state (real phone numbers) because voice and sms must dial and match them.
// It is server-side only; the browser gets core.snapshot(), which masks phones.
const voiceCore = {
  getState: () => core.internalState(),
  volunteerPhone: (id) => core.volunteerPhone(id),
  describeOffer: (id) => core.describeOffer(id),
  respondToOffer: (id, action) => { const snap = core.respondToOffer(id, action); Promise.resolve().then(placeCalls).catch(() => {}); return snap; },
  addFeed: (text) => { try { core.postUpdate(text); } catch { /* feed is best effort */ } },
  pickupOffer: (id) => core.pickupOffer(id),
  dropoffOffer: (id) => core.dropoffOffer(id),
};
// Optional SMS module (same adapter). Texts and calls are independent and best effort.
let sms = null;
try { sms = await import("./lib/sms.js"); } catch { sms = null; }
async function placeCalls() {
  const ids = core.takePendingCalls();
  if (!ids.length) return;
  const calls = typeof voice?.callForOffers === "function" ? voice.callForOffers(voiceCore, ids) : null;
  // Voice is the channel. Texts only go out when SMS_ENABLED=true.
  const texts = process.env.SMS_ENABLED === "true" && typeof sms?.textForOffers === "function" ? sms.textForOffers(voiceCore, ids) : null;
  const [c, t] = await Promise.allSettled([calls, texts]);
  if (c.status === "rejected") log.error({ err: c.reason?.name }, "Voice call failed");
  if (t.status === "rejected") log.error({ err: t.reason?.name }, "Text message failed");
}

const app = express();
// The graduated app has a prefixed API route; the original dashboard keeps /api.
app.use((req, _res, next) => {
  if (req.url === "/food-rescue-hq/api" || req.url.startsWith("/food-rescue-hq/api/")) {
    req.url = req.url.slice("/food-rescue-hq".length);
  }
  next();
});
app.disable("x-powered-by");
registerEstimate(app); // before the global json parser: has its own larger body limit
if (voice?.registerVoice) voice.registerVoice(app, voiceCore); // Twilio voice webhooks (own urlencoded parser)
if (sms?.registerSms) sms.registerSms(app, voiceCore); // Twilio messaging webhook (own urlencoded parser)
app.use(express.json({ limit: "64kb" }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
// Friendly answers when someone opens the Twilio webhook addresses in a browser (Twilio itself uses POST).
for (const hook of ["/sms/inbound", "/voice/offer", "/voice/answer"]) {
  app.get(hook, (_req, res) => res.type("text/plain").send("This address is for Twilio. It is working. Texts and calls are sent here with POST."));
}
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/api/state", (_req, res) => { core.expire(); res.json(core.snapshot()); });
app.get("/api/stream", (req, res) => {
  core.expire();
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(core.snapshot())}\n\n`);
  clients.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => { clearInterval(heartbeat); clients.delete(res); });
});
const route = (status, fn, after) => async (req, res, next) => {
  try {
    const out = fn(req);
    res.status(status).json(out);
    if (after) await after();
  } catch (error) { next(error); }
};
registerAgent(app, core); // agent questions (step 2) and match explanations (step 4)
app.post("/api/incidents", route(201, (req) => core.createIncident(req.body)));
app.post("/api/demo/fast-forward", route(200, () => core.fastForward()));
// Coordinator updates only appear in the shared thread; nothing is texted yet.
app.post("/api/updates", route(201, (req) => core.postUpdate(req.body?.text)));
app.post("/api/demo/reset", route(200, () => core.reset())); // keeps the user's volunteers and places
app.post("/api/demo/reset-all", route(200, () => core.resetAll())); // back to seeded volunteers and places
app.post("/api/event", route(201, (req) => core.createEvent(req.body)));
app.patch("/api/event", route(200, (req) => core.patchEvent(req.body)));
app.post("/api/report", route(201, (req) => core.submitReport(req.body)));
registerQuick(app, core, placeCalls);
app.post("/api/offers/send", route(200, (req) => core.sendOffers(req.body), placeCalls));
app.post("/api/offers/:id/respond", route(200, (req) => core.respondToOffer(req.params.id, req.body?.action), placeCalls));
app.post("/api/offers/:id/pickup", route(200, (req) => core.pickupOffer(req.params.id)));
app.post("/api/offers/:id/dropoff", route(200, (req) => core.dropoffOffer(req.params.id)));
// Call the volunteer for one offer right now (used by the "Call now" button).
app.post("/api/offers/:id/call", async (req, res) => {
  const offer = core.getOffer(req.params.id);
  if (!offer) return res.status(404).json({ error: "That offer no longer exists." });
  if (typeof voice?.callForOffers !== "function") return res.status(503).json({ error: "Calling is not available." });
  try {
    const out = await voice.callForOffers(voiceCore, [offer.id]);
    if (out?.skipped) return res.status(409).json({ error: "Calls are not set up yet." });
    const r = out?.results?.[0];
    if (r?.ok) return res.json({ ok: true, message: "Calling now. Answer and press 1 to accept." });
    if (r?.skipped) return res.status(409).json({ error: "Add a real phone number for this volunteer first." });
    return res.status(502).json({ error: "The call did not go through. Check the number and try again." });
  } catch (error) {
    log.error({ err: error?.name }, "Call now failed");
    return res.status(502).json({ error: "The call did not go through. Try again." });
  }
});
app.post("/api/volunteers", route(201, (req) => core.addVolunteer(req.body)));
app.patch("/api/volunteers/:id", route(200, (req) => core.patchVolunteer(req.params.id, req.body)));
app.delete("/api/volunteers/:id", route(200, (req) => core.deleteVolunteer(req.params.id)));
app.post("/api/volunteers/:id/phone", route(200, (req) => core.setVolunteerPhone(req.params.id, req.body?.phone)));
app.post("/api/places", route(201, (req) => core.addPlace(req.body)));
app.patch("/api/places/:id", route(200, (req) => core.patchPlace(req.params.id, req.body)));
app.delete("/api/places/:id", route(200, (req) => core.deletePlace(req.params.id)));
app.get("/v/:id", (_req, res) => {
  const page = path.join(root, "public", "v.html");
  if (existsSync(page)) return res.sendFile(page);
  res.type("html").send("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Food Rescue HQ</title><p style='font-family:sans-serif;padding:24px'>Volunteer page coming soon.</p>");
});
app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use(express.static(path.join(root, "public"), { etag: false, maxAge: 0 }));
app.use((err, _req, res, _next) => {
  if (err instanceof core.HttpError) return res.status(err.status).json({ error: err.message });
  if (err.status === 413) return res.status(413).json({ error: "That request is too large." });
  if (err.status === 400 || err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON request." });
  log.error(err);
  res.status(500).json({ error: "Unable to save or load state. Please try again." });
});
const timer = setInterval(() => { try { core.expire(); } catch (error) { log.error(error, "Unable to expire incident"); } }, 1000);
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be set to a valid port.");
const server = app.listen(port, "0.0.0.0", () => log.info({ port }, "Food Rescue HQ is listening"));
process.on("SIGTERM", () => {
  clearInterval(timer);
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
});
