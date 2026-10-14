// Twilio voice module: outbound calls (places in stage 1, volunteers in stage 2), inbound delivery
// confirmation, and the TwiML webhooks. No npm deps beyond express.
import express from "express";

const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const strip = (v) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
const say = (t) => `<Say>${esc(strip(t))}</Say>`;
const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const base = () => (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const qs = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const safeFeed = (core, text) => { try { core?.addFeed?.(text); } catch { /* ignore */ } };
const hangup = (text) => twiml(`${say(text)}<Hangup/>`);
const gather = (path, query, text, noAnswer = "No response. Goodbye.") =>
  twiml(`<Gather numDigits="1" action="${esc(`${base()}${path}?${qs(query)}`)}" method="POST" timeout="8">${say(text)}</Gather>${say(noAnswer)}<Hangup/>`);

const CLAIMED_MSG = "Thanks, this has already been claimed. Goodbye.";
const GONE_MSG = "Sorry, this offer is no longer available. Goodbye.";
const DELIVERED_HINT = "When you have dropped it off, call this number back or open your link and tap Delivered.";

function describe(core, offerId) {
  try {
    return typeof core?.describeOffer === "function" ? core.describeOffer(offerId) || null : null;
  } catch {
    return null;
  }
}
// Offers described without a kind come from older cores: they are volunteer offers.
const kindOf = (d) => d.kind || "volunteer";

export function placeMessage(d) {
  return `Food rescue. ${d.portions} ${d.item} available at ${d.venue}, pickup within ${d.minutes} minutes. Press 1 if you can take it, 2 if not.`;
}
export function volunteerMessage(d) {
  const drop = d.placeAddress ? `${d.placeName}, ${d.placeAddress}` : d.placeName;
  return `Food rescue pickup. Pick up ${d.portions} ${d.item} at ${d.venue} and drop off at ${drop}. Press 1 to accept, 2 to decline.`;
}
const jobMessage = (j) => {
  const drop = j.placeAddress ? `${j.placeName}, ${j.placeAddress}` : j.placeName;
  return `Hi ${j.volunteerName}. Your pickup: ${j.portions} ${j.item} from ${j.venue} to ${drop}. Press 1 if you have delivered it.`;
};

function offerTwiml(d, query, retry) {
  const q = { ...query, ...(retry ? { retry: "1" } : {}) };
  return gather("/voice/answer", q, kindOf(d) === "place" ? placeMessage(d) : volunteerMessage(d));
}

export function registerVoice(app, core) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));
  const send = (res, xml) => res.status(200).type("text/xml").send(xml);
  const stillTheirs = (d, volunteerId) => !volunteerId || !d.volunteerId || d.volunteerId === volunteerId;

  // Outbound call answered: say the offer (place or volunteer) and gather 1 / 2.
  router.post("/offer", (req, res) => {
    const volunteerId = String(req.query.volunteerId ?? "");
    const offerId = String(req.query.offerId ?? "");
    const d = describe(core, offerId);
    if (!d) return send(res, hangup(GONE_MSG));
    if (kindOf(d) === "place") {
      if (d.status === "taken") return send(res, hangup(CLAIMED_MSG));
      if (d.status && d.status !== "calling") return send(res, hangup(GONE_MSG));
      return send(res, offerTwiml(d, { offerId, placeId: d.placeId || "" }, false));
    }
    if (!stillTheirs(d, volunteerId)) return send(res, hangup(GONE_MSG));
    // A volunteer who already accepted (manual "Call now") hears their job and can confirm delivery.
    if (d.status === "accepted" || d.status === "picked_up") {
      return send(res, gather("/voice/delivered", { offerId, volunteerId: d.volunteerId || volunteerId },
        jobMessage({ ...d, volunteerName: d.volunteerName })));
    }
    if (d.status && d.status !== "offered") return send(res, hangup(GONE_MSG));
    send(res, offerTwiml(d, { volunteerId, offerId }, false));
  });

  router.post("/answer", (req, res) => {
    const volunteerId = String(req.query.volunteerId ?? "");
    const offerId = String(req.query.offerId ?? "");
    const retry = req.query.retry;
    const digit = String(req.body?.Digits ?? "").trim();
    const d = describe(core, offerId);
    if (!d) return send(res, hangup(GONE_MSG));
    const isPlace = kindOf(d) === "place";
    if (digit === "1" || digit === "2") {
      const action = digit === "1" ? "accept" : "decline";
      if (isPlace) {
        let r = "closed";
        try { r = core?.placeAnswer?.(offerId, action) ?? "closed"; } catch { r = "closed"; }
        if (r === "won") return send(res, hangup(`Thank you. ${d.placeName} has the ${d.item}. A volunteer will bring ${d.portions} ${d.item} soon. Goodbye.`));
        if (r === "declined") return send(res, hangup("Understood. Thank you."));
        if (r === "taken" || d.status === "taken") return send(res, hangup(CLAIMED_MSG));
        return send(res, hangup(action === "accept" ? GONE_MSG : "Understood. Thank you."));
      }
      if (!stillTheirs(d, volunteerId) || (d.status && d.status !== "offered")) return send(res, hangup(GONE_MSG));
      try { core?.respondToOffer?.(offerId, action); } catch { return send(res, hangup(GONE_MSG)); }
      const msg = digit === "1"
        ? `Thank you ${d.volunteerName}. Please pick up the food within ${d.minutes ?? "the next few"} minutes. ${DELIVERED_HINT} Goodbye.`
        : "Understood. Thank you.";
      return send(res, hangup(msg));
    }
    if (retry) return send(res, hangup("No valid response. Goodbye."));
    send(res, offerTwiml(d, isPlace ? { offerId, placeId: d.placeId || "" } : { volunteerId, offerId }, true));
  });

  // A volunteer calls the Twilio number back: read their open job and let them confirm delivery.
  router.post("/inbound", (req, res) => {
    const from = String(req.body?.From ?? "");
    let job = null;
    try { job = core?.openJobForPhone?.(from) ?? null; } catch { job = null; }
    if (!job) return send(res, hangup("This is Food Rescue H Q. We could not find a volunteer with this number. Goodbye."));
    if (!job.offerId) return send(res, hangup(`Hi ${job.volunteerName}. You have no open pickup right now. Thank you. Goodbye.`));
    send(res, gather("/voice/delivered", { offerId: job.offerId, volunteerId: job.volunteerId }, jobMessage(job)));
  });

  router.post("/delivered", (req, res) => {
    const volunteerId = String(req.query.volunteerId ?? "");
    const offerId = String(req.query.offerId ?? "");
    const digit = String(req.body?.Digits ?? "").trim();
    if (digit !== "1") return send(res, hangup(`OK. ${DELIVERED_HINT} Goodbye.`));
    try {
      core?.deliverOffer?.(offerId, { volunteerId });
      return send(res, hangup("Thank you. It is marked as delivered. Goodbye."));
    } catch {
      return send(res, hangup("Sorry, that pickup could not be marked as delivered. Open your link and tap Delivered. Goodbye."));
    }
  });

  app.use("/voice", router);
  return router;
}

// Phone whoever should be asked about each offer: the place (stage 1) or the volunteer (stage 2).
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
      let target = null;
      if (typeof core.callTarget === "function") {
        target = core.callTarget(offerId);
      } else {
        const v = volunteers.find((x) => x.id === d.volunteerId) || volunteers.find((x) => x.name === d.volunteerName);
        target = v ? { kind: "volunteer", id: v.id, name: v.name, phone: v.optedIn === false ? "" : v.phone } : null;
      }
      const phone = target?.phone;
      if (!phone || /^\+1202555/.test(phone)) { results.push({ offerId, kind: target?.kind, skipped: true, reason: "no phone or not opted in" }); continue; }
      const query = target.kind === "place" ? { offerId, placeId: target.id } : { volunteerId: target.id, offerId };
      const body = new URLSearchParams({
        To: phone,
        From: from,
        Url: `${publicBase}/voice/offer?${qs(query)}`,
        Method: "POST",
        Timeout: "25",
      });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (r.ok) {
        safeFeed(core, `Calling ${target.name} about ${d.portions} ${d.item}.`);
        results.push({ offerId, kind: target.kind, ok: true });
      } else {
        results.push({ offerId, kind: target.kind, ok: false, status: r.status });
      }
    } catch (e) {
      results.push({ offerId, ok: false, error: e?.name || "error" });
    }
  }
  return { skipped: false, results };
}
