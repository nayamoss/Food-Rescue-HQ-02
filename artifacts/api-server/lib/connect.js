// "Call the volunteer from the app": Twilio rings the coordinator's phone first, then bridges
// the call to the volunteer. Same env vars and skip-when-missing behaviour as voice.js.
// Phone numbers never appear in responses or feed lines.
import express from "express";

const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const strip = (v) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
const say = (t) => `<Say>${esc(strip(t))}</Say>`;
const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const base = () => (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

export const NO_COORDINATOR = "Add your phone number in the account menu first, so we can connect you.";
export const NO_VOLUNTEER_PHONE = "Add a phone number for this volunteer first.";
const firstName = (name) => String(name || "the volunteer").trim().split(/\s+/)[0];

// TwiML for the bridged call. Unknown volunteer (or no phone): say so and hang up.
export function connectTwiml(core, volunteerId, placeId) {
  const v = placeId ? core.getPlace?.(placeId) : volunteerId ? core.getVolunteer(volunteerId) : null;
  const phone = !v ? "" : placeId ? core.placePhone?.(placeId) || "" : core.volunteerPhone(volunteerId);
  if (!v || !phone) return twiml(`${say("That volunteer is not available.")}<Hangup/>`);
  const from = process.env.TWILIO_FROM_NUMBER || "";
  return twiml(`${say(`Connecting you to ${v.name}.`)}<Dial callerId="${esc(from)}" timeout="25">${esc(phone)}</Dial>${say("The call has ended.")}`);
}

// Start the call. Returns { status, body } for the HTTP route.
export async function connectVolunteer(core, volunteerId, placeId) {
  const v = placeId ? core.getPlace?.(placeId) : core.getVolunteer(volunteerId);
  if (!v) return { status: 404, body: { error: placeId ? "That partner no longer exists." : "That volunteer no longer exists." } };
  const coordinator = core.coordinatorPhone();
  if (!coordinator) return { status: 409, body: { error: NO_COORDINATOR } };
  const theirPhone = placeId ? core.placePhone?.(placeId) : core.volunteerPhone(volunteerId);
  if (!theirPhone) return { status: 409, body: { error: placeId ? "Add a phone number for this partner first." : NO_VOLUNTEER_PHONE } };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const publicBase = base();
  if (!sid || !token || !from || !publicBase) return { status: 409, body: { error: "Calls are not set up yet." }, skipped: true };

  const body = new URLSearchParams({
    To: coordinator,
    From: from,
    Url: `${publicBase}/voice/connect?${placeId ? "placeId" : "volunteerId"}=${encodeURIComponent(v.id)}`,
    Method: "POST",
    Timeout: "25",
  });
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) return { status: 502, body: { error: "The call did not go through. Check the numbers and try again." } };
  } catch {
    return { status: 502, body: { error: "The call did not go through. Try again." } };
  }
  try { core.addFeed?.(`Connecting HQ to ${v.name} by phone.`); } catch { /* feed is best effort */ }
  return { status: 200, body: { ok: true, message: `Calling your phone now. Answer to be connected to ${firstName(v.name)}.` } };
}

// core: { getVolunteer, volunteerPhone, coordinatorPhone, addFeed }
export function registerConnect(app, core) {
  app.post("/api/volunteers/:id/connect", async (req, res) => {
    const out = await connectVolunteer(core, String(req.params.id ?? ""));
    res.status(out.status).json(out.body);
  });
  app.post("/api/places/:id/connect", async (req, res) => {
    const out = await connectVolunteer(core, "", String(req.params.id ?? ""));
    res.status(out.status).json(out.body);
  });
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));
  router.post("/connect", (req, res) => {
    res.status(200).type("text/xml").send(connectTwiml(core, String(req.query.volunteerId ?? ""), String(req.query.placeId ?? "")));
  });
  router.get("/connect", (_req, res) => res.type("text/plain").send("This address is for Twilio. It is working. Calls are sent here with POST."));
  app.use("/voice", router);
  return router;
}
