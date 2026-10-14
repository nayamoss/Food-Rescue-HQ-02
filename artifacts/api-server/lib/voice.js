// Twilio voice module: outbound offer calls + TwiML webhooks. No npm deps.
import express from "express";

const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const strip = (v) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 200);
const say = (t) => `<Say>${esc(strip(t))}</Say>`;
const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const base = () => (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const qs = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const safeFeed = (core, text) => { try { core?.addFeed?.(text); } catch { /* ignore */ } };

function describe(core, offerId) {
  try {
    return typeof core?.describeOffer === "function" ? core.describeOffer(offerId) || null : null;
  } catch {
    return null;
  }
}

function offerMessage(d) {
  return `Food rescue. ${d.portions} ${d.item} to ${d.placeName}, from ${d.venue}. Pick up within ${d.minutes} minutes. Press 1 to accept, press 2 to decline.`;
}

function offerTwiml(d, volunteerId, offerId, retry) {
  const action = `${base()}/voice/answer?${qs({ volunteerId, offerId, ...(retry ? { retry: "1" } : {}) })}`;
  return twiml(
    `<Gather numDigits="1" action="${esc(action)}" method="POST" timeout="8">${say(offerMessage(d))}</Gather>` +
      `${say("No response. Goodbye.")}<Hangup/>`
  );
}

export function registerVoice(app, core) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));
  const send = (res, xml) => res.status(200).type("text/xml").send(xml);
  const fallback = () => twiml(`${say("Sorry, this offer is no longer available. Goodbye.")}<Hangup/>`);

  router.post("/offer", (req, res) => {
    const { volunteerId = "", offerId = "" } = req.query;
    const d = describe(core, String(offerId));
    send(res, d ? offerTwiml(d, String(volunteerId), String(offerId), false) : fallback());
  });

  router.post("/answer", (req, res) => {
    const { volunteerId = "", offerId = "", retry } = req.query;
    const digit = String(req.body?.Digits ?? "").trim();
    const id = String(offerId);
    const d = describe(core, id);
    if (!d) return send(res, fallback());
    if (digit === "1" || digit === "2") {
      const action = digit === "1" ? "accept" : "decline";
      try { core?.respondToOffer?.(id, action); } catch { /* degrade */ }
      const msg = digit === "1"
        ? `Thank you ${d.volunteerName}. Please pick up the food within ${d.minutes ?? "the next few"} minutes. Goodbye.`
        : "Understood. Thank you.";
      return send(res, twiml(`${say(msg)}<Hangup/>`));
    }
    if (retry) return send(res, twiml(`${say("No valid response. Goodbye.")}<Hangup/>`));
    send(res, offerTwiml(d, String(volunteerId), id, true));
  });

  app.use("/voice", router);
  return router;
}

export async function callForOffers(core, offerIds) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const publicBase = base();
  const missing = [["TWILIO_ACCOUNT_SID", sid], ["TWILIO_AUTH_TOKEN", token], ["TWILIO_FROM_NUMBER", from], ["PUBLIC_BASE_URL", publicBase]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { skipped: true, reason: `Missing env: ${missing.join(", ")}` };
  if (!core || typeof core.describeOffer !== "function") return { skipped: true, reason: "core.describeOffer unavailable" };

  let volunteers = [];
  try { volunteers = core.getState?.()?.volunteers ?? []; } catch { /* ignore */ }
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const results = [];

  for (const offerId of Array.isArray(offerIds) ? offerIds : []) {
    try {
      const d = describe(core, offerId);
      if (!d) { results.push({ offerId, skipped: true, reason: "unknown offer" }); continue; }
      const v = volunteers.find((x) => x.id === d.volunteerId) || volunteers.find((x) => x.name === d.volunteerName);
      const phone = d.phone || v?.phone;
      if (!phone || /^\+1202555/.test(phone) || v?.optedIn === false) { results.push({ offerId, skipped: true, reason: "no phone or not opted in" }); continue; }
      const body = new URLSearchParams({
        To: phone,
        From: from,
        Url: `${publicBase}/voice/offer?${qs({ volunteerId: v?.id ?? d.volunteerId ?? "", offerId })}`,
        Method: "POST",
        Timeout: "25",
      });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (r.ok) {
        safeFeed(core, `Calling ${d.volunteerName} about ${d.portions} ${d.item}.`);
        results.push({ offerId, ok: true });
      } else {
        results.push({ offerId, ok: false, status: r.status });
      }
    } catch (e) {
      results.push({ offerId, ok: false, error: e?.name || "error" });
    }
  }
  return { skipped: false, results };
}
