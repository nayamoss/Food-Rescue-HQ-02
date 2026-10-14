// Twilio SMS module: outbound offer texts + inbound reply webhook. No npm deps.
// Never logs or echoes phone numbers, tokens or message bodies.
import express from "express";

const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const twiml = (msg) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(msg)}</Message></Response>`;
const safeFeed = (core, text) => { try { core?.addFeed?.(text); } catch { /* ignore */ } };
const state = (core) => { try { return core?.getState?.() ?? {}; } catch { return {}; } };
const describe = (core, id) => { try { return core?.describeOffer?.(id) || null; } catch { return null; } };

// Normalise to E.164 digits only (no plus). 10-digit numbers are treated as US/Canada.
export function phoneDigits(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d;
}

export function offerText(d) {
  return `Food Rescue: ${d.portions} ${d.item} from ${d.venue} to ${d.placeName}. Pick up within ${d.minutes} min. Reply YES to accept or NO to decline.`;
}

const COMMANDS = {
  accept: ["YES", "Y", "ACCEPT", "1"],
  decline: ["NO", "N", "DECLINE", "2"],
  pickup: ["PICKED", "PICKED UP", "PICKUP", "PICKED-UP"],
  dropoff: ["DONE", "DROPPED", "DROPPED OFF", "DELIVERED"],
};
export function parseCommand(body) {
  const t = String(body ?? "").trim().toUpperCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
  for (const [cmd, words] of Object.entries(COMMANDS)) if (words.includes(t)) return cmd;
  return null;
}

export async function textForOffers(core, offerIds) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const missing = [["TWILIO_ACCOUNT_SID", sid], ["TWILIO_AUTH_TOKEN", token], ["TWILIO_FROM_NUMBER", from]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { skipped: true, reason: `Missing env: ${missing.join(", ")}` };
  if (!core || typeof core.describeOffer !== "function") return { skipped: true, reason: "core.describeOffer unavailable" };

  const s = state(core);
  const volunteers = Array.isArray(s.volunteers) ? s.volunteers : [];
  const offers = Array.isArray(s.offers) ? s.offers : [];
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const results = [];

  for (const offerId of Array.isArray(offerIds) ? offerIds : []) {
    try {
      const d = describe(core, offerId);
      const o = offers.find((x) => x.id === offerId);
      if (!d || !o) { results.push({ offerId, skipped: true, reason: "unknown offer" }); continue; }
      const v = volunteers.find((x) => x.id === o.volunteerId);
      if (!v?.phone || v.optedIn === false) { results.push({ offerId, skipped: true, reason: "no phone or not opted in" }); continue; }
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: v.phone, From: from, Body: offerText(d) }),
      });
      if (r.ok) {
        safeFeed(core, `Texted ${v.name} about ${d.portions} ${d.item}.`);
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

// Latest offer for this volunteer whose status is one of `statuses`.
function latestOffer(offers, volunteerId, statuses) {
  return offers
    .filter((o) => o.volunteerId === volunteerId && statuses.includes(o.status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
}

export function handleInbound(core, from, body) {
  const s = state(core);
  const digits = phoneDigits(from);
  const v = digits ? (s.volunteers || []).find((x) => phoneDigits(x.phone) === digits) : null;
  if (!v) return "Food Rescue: we do not recognise this number. Ask your coordinator to add you as a volunteer.";
  const offers = Array.isArray(s.offers) ? s.offers : [];
  const cmd = parseCommand(body);
  const help = "Reply YES to accept, NO to decline, PICKED once you have the food, DONE once it is delivered.";
  if (!cmd) return `Food Rescue: sorry, we did not understand. ${help}`;

  const stepFor = {
    accept: { statuses: ["offered"], fn: "respondToOffer", arg: "accept" },
    decline: { statuses: ["offered"], fn: "respondToOffer", arg: "decline" },
    pickup: { statuses: ["accepted"], fn: "pickupOffer" },
    dropoff: { statuses: ["picked_up", "accepted"], fn: "dropoffOffer" },
  }[cmd];
  const o = latestOffer(offers, v.id, stepFor.statuses);
  if (!o) {
    const none = { accept: "You have no open offer right now.", decline: "You have no open offer right now.",
      pickup: "You have no accepted pickup right now.", dropoff: "You have no delivery in progress right now." }[cmd];
    return `Food Rescue: ${none} Thanks for checking in.`;
  }
  if (typeof core?.[stepFor.fn] !== "function") return "Food Rescue: that step is not available by text yet. Please tell your coordinator.";
  const d = describe(core, o.id) || { portions: o.portions, item: o.item, placeName: "the partner", minutes: "the next few" };
  try {
    stepFor.arg ? core[stepFor.fn](o.id, stepFor.arg) : core[stepFor.fn](o.id);
  } catch {
    return "Food Rescue: sorry, that offer can no longer be updated. Please check with your coordinator.";
  }
  switch (cmd) {
    case "accept": return `Thanks ${v.name}! Please pick up ${d.portions} ${d.item} within ${d.minutes} min and take it to ${d.placeName}. Reply PICKED once you have it.`;
    case "decline": return "Understood, thank you. We will ask someone else.";
    case "pickup": return `Great, you are on the way to ${d.placeName}. Reply DONE once it is delivered.`;
    default: return `Delivered! Thank you for rescuing ${d.portions} ${d.item}.`;
  }
}

export function registerSms(app, core) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));
  router.post("/inbound", (req, res) => {
    let reply;
    try { reply = handleInbound(core, req.body?.From, req.body?.Body); } catch { reply = "Food Rescue: something went wrong. Please try again."; }
    res.status(200).type("text/xml").send(twiml(reply));
  });
  app.use("/sms", router);
  return router;
}
