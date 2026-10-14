// Run: node artifacts/api-server/lib/core.selftest.mjs  (no network; uses a temp DATA_DIR, never touches data/)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "food-rescue-core-"));
process.env.DATA_DIR = dir;
const core = await import("./core.js");
const saved = () => JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8"));
const status = (fn) => { try { fn(); } catch (e) { return [e.status, e.message]; } return [200, ""]; };

try {
  let broadcasts = 0;
  core.onChange(() => { broadcasts += 1; });

  // ---- seeds: no phones anywhere --------------------------------------------
  let s = core.resetAll();
  assert.equal(s.volunteers.length, 3);
  assert.ok(s.volunteers.every((v) => v.phoneSet === false && v.phoneLast4 === "" && !("phone" in v)));
  assert.ok(saved().volunteers.every((v) => v.phone === ""));
  assert.equal(s.places.length, 3);

  // ---- volunteers: add -------------------------------------------------------
  const before = broadcasts;
  s = core.addVolunteer({ name: "  Riley Park ", phone: "+1 (415) 555-2671" });
  assert.equal(broadcasts, before + 1, "add broadcasts");
  const riley = s.volunteers.find((v) => v.name === "Riley Park");
  assert.ok(riley && riley.id.startsWith("v-"));
  assert.equal(riley.phoneSet, true);
  assert.equal(riley.phoneLast4, "2671");
  assert.equal(riley.optedIn, true);
  assert.equal(riley.status, "ready");
  assert.equal(riley.phone, undefined, "snapshot never exposes phone");
  assert.equal(saved().volunteers.find((v) => v.id === riley.id).phone, "+14155552671", "real number kept in saved state");
  assert.equal(core.internalState().volunteers.find((v) => v.id === riley.id).phone, "+14155552671");
  assert.equal(core.volunteerPhone(riley.id), "+14155552671");
  assert.ok(!JSON.stringify(s).includes("4155552671"), "full number nowhere in snapshot");
  assert.ok(!JSON.stringify(s.feed).includes("2671"), "phone never in feed");

  s = core.addVolunteer({ name: "Quinn" });
  const quinn = s.volunteers.find((v) => v.name === "Quinn");
  assert.equal(quinn.phoneSet, false);

  assert.equal(status(() => core.addVolunteer({}))[0], 400);
  assert.equal(status(() => core.addVolunteer({ name: "x".repeat(81) }))[0], 400);
  assert.equal(status(() => core.addVolunteer({ name: "Ann", phone: "12345" }))[0], 400, "too short rejected");
  assert.notEqual(status(() => core.addVolunteer({ name: "Ten Digits", phone: "(415) 555-2671" }))[0], 400, "US number without +1 accepted");
  assert.equal(core.internalState().volunteers.find((v) => v.name === "Ten Digits").phone, "+14155552671", "normalised to +1");
  assert.equal(status(() => core.addVolunteer({ name: "Ann", phone: "+12025550101" }))[0], 400, "placeholder rejected");
  assert.equal(status(() => core.addVolunteer({ name: "Ann", optedIn: "yes" }))[0], 400);
  assert.equal(status(() => core.addVolunteer({ name: "riley park" }))[0], 409, "duplicate name");
  const [, phoneMsg] = status(() => core.addVolunteer({ name: "Ann", phone: "+1415555267199999" }));
  assert.ok(!phoneMsg.includes("1415555267199999"), "error never echoes the number");

  // ---- volunteers: edit ------------------------------------------------------
  s = core.patchVolunteer(riley.id, { name: "Riley P.", optedIn: false });
  let r = s.volunteers.find((v) => v.id === riley.id);
  assert.equal(r.name, "Riley P.");
  assert.equal(r.optedIn, false);
  assert.equal(r.phoneLast4, "2671", "phone untouched");
  s = core.patchVolunteer(riley.id, { phone: "+447700900123" });
  assert.equal(s.volunteers.find((v) => v.id === riley.id).phoneLast4, "0123");
  assert.ok(!JSON.stringify(s.feed).includes("447700900123"));
  s = core.patchVolunteer(riley.id, { phone: "" });
  assert.equal(s.volunteers.find((v) => v.id === riley.id).phoneSet, false, "empty phone clears it");
  s = core.patchVolunteer(riley.id, { optedIn: true });
  assert.equal(status(() => core.patchVolunteer(riley.id, {}))[0], 400);
  assert.equal(status(() => core.patchVolunteer("nope", { name: "X" }))[0], 404);
  assert.equal(status(() => core.patchVolunteer(riley.id, { name: "Quinn" }))[0], 409);
  assert.equal(status(() => core.patchVolunteer(riley.id, { phone: "call me" }))[0], 400);

  // legacy phone endpoint still works and is masked
  s = core.setVolunteerPhone(quinn.id, "+15035550199");
  assert.equal(s.volunteers.find((v) => v.id === quinn.id).phoneLast4, "0199");
  assert.equal(status(() => core.setVolunteerPhone(quinn.id, "+12025550123"))[0], 400);

  // ---- places: add + edit ----------------------------------------------------
  s = core.addPlace({ name: "Eastside Food Bank", type: "food bank", distanceMiles: 1.25, capacity: 80, accepts: ["drinks", "packaged"], address: "12 Main St" });
  const bank = s.places.find((p) => p.name === "Eastside Food Bank");
  assert.ok(bank.id.startsWith("p-"));
  assert.equal(bank.distanceMiles, 1.3);
  assert.deepEqual(bank.accepts, ["packaged", "drinks"]);
  assert.equal(bank.address, "12 Main St");
  const good = { name: "Z", type: "shelter", distanceMiles: 0, capacity: 1, accepts: ["prepared"] };
  for (const badBody of [
    { ...good, name: "" }, { ...good, type: "restaurant" }, { ...good, distanceMiles: -1 },
    { ...good, distanceMiles: "2" }, { ...good, capacity: 0 }, { ...good, capacity: 1.5 },
    { ...good, accepts: [] }, { ...good, accepts: ["frozen"] }, { ...good, address: 5 },
  ]) assert.equal(status(() => core.addPlace(badBody))[0], 400, JSON.stringify(badBody));
  assert.equal(status(() => core.addPlace({ ...good, name: "eastside food bank" }))[0], 409);
  s = core.addPlace(good);
  assert.ok(s.places.some((p) => p.name === "Z" && p.distanceMiles === 0));

  s = core.patchPlace(bank.id, { capacity: 90, accepts: ["prepared", "packaged", "drinks"] });
  assert.equal(s.places.find((p) => p.id === bank.id).capacity, 90);
  assert.equal(s.places.find((p) => p.id === bank.id).type, "food bank", "partial patch keeps other fields");
  assert.equal(status(() => core.patchPlace(bank.id, {}))[0], 400);
  assert.equal(status(() => core.patchPlace(bank.id, { type: "bar" }))[0], 400);
  assert.equal(status(() => core.patchPlace("nope", { capacity: 5 }))[0], 404);

  // ---- place phones: same rules as volunteers, masked in the snapshot --------
  s = core.patchPlace(bank.id, { phone: "(212) 555-0142" });
  let b = s.places.find((p) => p.id === bank.id);
  assert.equal(b.phoneSet, true);
  assert.equal(b.phoneLast4, "0142");
  assert.equal(b.phone, undefined, "snapshot never exposes a place phone");
  assert.equal(core.placePhone(bank.id), "+12125550142", "US number without +1 normalised");
  assert.ok(!JSON.stringify(s).includes("2125550142"), "full place number nowhere in snapshot");
  assert.equal(status(() => core.patchPlace(bank.id, { phone: "12345" }))[0], 400);
  assert.equal(status(() => core.patchPlace(bank.id, { phone: "+12025550111" }))[0], 400, "placeholder rejected");
  core.patchPlace("p1", { phone: "+16465550101" });
  core.patchPlace("p2", { phone: "+16465550102" });
  s = core.addPlace({ name: "Phone Pantry", type: "food bank", distanceMiles: 9, capacity: 5, accepts: ["drinks"], phone: "6465550103" });
  const pantry = s.places.find((p) => p.name === "Phone Pantry");
  assert.equal(pantry.phoneLast4, "0103");
  assert.equal(core.placePhone(pantry.id), "+16465550103");
  assert.ok(s.places.filter((p) => !p.phoneSet).every((p) => p.phoneLast4 === ""));

  // ---- report: one lot per item, every place that takes it is proposed -------
  core.createEvent({ name: "Gala", venue: "Hall", items: [{ item: "Tacos", ordered: 100 }], goodForMinutes: 60 });
  s = core.submitReport({ items: [{ item: "Tacos", left: 40 }] });
  assert.equal(s.lots.length, 1);
  let lot = s.lots[0];
  assert.equal(lot.status, "proposed");
  assert.equal(lot.stage, "match");
  assert.equal(lot.label, "Ready to call nonprofits");
  assert.equal(s.journeyStep, "match");
  const z = s.places.find((p) => p.name === "Z");
  assert.ok(!s.offers.some((o) => o.placeId === z.id), "Z (capacity 1) is skipped when bigger places can take the lot");
  assert.ok(!s.offers.some((o) => o.placeId === pantry.id), "pantry takes drinks only");
  assert.deepEqual(s.offers.map((o) => o.placeId), [bank.id, "p1", "p2", "p3"], "nearest first");
  assert.ok(s.offers.every((o) => o.lotId === lot.id && o.portions === 40 && o.status === "proposed"));
  // proposed-only offers do not block removing a place; they are dropped with it
  s = core.deletePlace("p3");
  assert.ok(!s.offers.some((o) => o.placeId === "p3"));
  core.takePendingCalls();

  // ---- stage 1: every place with a phone is called at once -------------------
  s = core.startPlaceOutreach({});
  const offerAt = (pid) => core.snapshot().offers.find((o) => o.placeId === pid);
  const [oBank, oP1, oP2] = [offerAt(bank.id), offerAt("p1"), offerAt("p2")];
  assert.ok([oBank, oP1, oP2].every((o) => o.status === "calling"));
  lot = s.lots[0];
  assert.equal(lot.status, "calling_places");
  assert.equal(lot.stage, "places");
  assert.equal(lot.label, "Calling nonprofits");
  assert.equal(lot.steps[0].state, "active");
  assert.ok(Date.parse(lot.placeDeadline) > Date.now() + 9 * 60000, "10 minute window");
  assert.equal(s.journeyStep, "outreach");
  assert.equal(s.incident.status, "in_progress");
  assert.deepEqual(core.takePendingCalls().sort(), [oBank.id, oP1.id, oP2.id].sort(), "places are called, not volunteers");
  assert.deepEqual(core.callTarget(oBank.id), { kind: "place", id: bank.id, name: "Eastside Food Bank", phone: "+12125550142" });
  assert.equal(core.describeOffer(oBank.id).kind, "place");
  assert.ok(s.volunteers.every((v) => v.status === "ready"), "no volunteer asked yet");
  assert.equal(status(() => core.startPlaceOutreach({}))[0], 409, "cannot send twice");
  assert.equal(status(() => core.deletePlace(bank.id))[0], 409, "place being called cannot be removed");

  // a place says no
  assert.equal(core.placeAnswer(oP1.id, "decline"), "declined");
  assert.equal(offerAt("p1").status, "declined");
  assert.equal(core.snapshot().lots[0].status, "calling_places", "others still being called");

  // first yes wins; the others still ringing are told it is taken
  assert.equal(core.placeAnswer(oBank.id, "accept"), "won");
  s = core.snapshot();
  assert.equal(offerAt("p2").status, "taken");
  assert.equal(core.placeAnswer(oP2.id, "accept"), "taken", "a late yes hears it is already claimed");
  assert.equal(status(() => core.respondToOffer(oP2.id, "accept"))[0], 409);
  assert.equal(core.placeAnswer(oP1.id, "accept"), "closed", "a place that said no cannot win later");
  assert.equal(core.callTarget(oP2.id), null, "taken places are not called again");

  // ---- stage 2: first free volunteer with a phone is asked -------------------
  let win = core.getOffer(oBank.id);
  assert.equal(win.status, "offered");
  assert.equal(win.volunteerId, quinn.id, "first free volunteer with a phone (seeds and Riley have none)");
  lot = s.lots[0];
  assert.equal(lot.status, "calling_volunteer");
  assert.equal(lot.stage, "volunteer");
  assert.equal(lot.placeName, "Eastside Food Bank");
  assert.equal(lot.placeAddress, "12 Main St");
  assert.equal(lot.volunteerName, "Quinn");
  assert.equal(lot.label, "Eastside Food Bank said yes. Calling Quinn");
  assert.deepEqual(lot.steps.map((x) => x.state), ["done", "done", "active", "todo", "todo"]);
  assert.equal(lot.steps[1].label, "Eastside Food Bank said yes");
  assert.equal(lot.steps[2].label, "Calling Quinn");
  assert.equal(lot.places.find((p) => p.placeId === bank.id).status, "accepted");
  assert.deepEqual(core.takePendingCalls(), [oBank.id], "volunteer is called");
  assert.equal(core.callTarget(oBank.id).kind, "volunteer");
  assert.equal(core.describeOffer(oBank.id).kind, "volunteer");
  assert.equal(s.summary.byPlace.find((p) => p.placeId === bank.id).portions, 40);
  assert.ok(!s.summary.byPlace.some((p) => p.placeId === "p2"), "taken places are not counted");
  assert.equal(status(() => core.deleteVolunteer(quinn.id))[0], 409, "offered volunteer cannot be removed");

  // decline hands it to the next free volunteer with a phone
  s = core.respondToOffer(oBank.id, "decline");
  win = core.getOffer(oBank.id);
  const tenId = s.volunteers.find((v) => v.name === "Ten Digits").id;
  assert.equal(win.status, "offered");
  assert.equal(win.volunteerId, tenId);
  assert.deepEqual(win.declinedBy, [quinn.id]);
  assert.equal(s.volunteers.find((v) => v.id === quinn.id).status, "declined");
  assert.deepEqual(core.takePendingCalls(), [oBank.id]);
  // nobody else free: the lot waits for a volunteer
  s = core.respondToOffer(oBank.id, "decline");
  win = core.getOffer(oBank.id);
  assert.equal(win.status, "place_accepted");
  assert.equal(win.volunteerId, null);
  assert.equal(s.lots[0].status, "waiting_volunteer");
  assert.equal(s.lots[0].steps[2].state, "waiting");
  assert.ok(s.feed[0].text.startsWith("No volunteer with a phone is free"));
  assert.deepEqual(core.takePendingCalls(), []);
  // a new volunteer with a phone picks up the waiting lot
  s = core.addVolunteer({ name: "Pat", phone: "646 555 0123" });
  const pat = s.volunteers.find((v) => v.name === "Pat");
  assert.equal(core.getOffer(oBank.id).volunteerId, pat.id);
  assert.equal(core.getOffer(oBank.id).status, "offered");
  assert.deepEqual(core.takePendingCalls(), [oBank.id]);

  // accept: on the way, but nothing counts as rescued until delivered
  s = core.respondToOffer(oBank.id, "accept");
  assert.equal(s.lots[0].status, "on_the_way");
  assert.equal(s.lots[0].label, "Pat is on the way");
  assert.equal(s.summary.rescued, 0, "accepted is not rescued");
  assert.equal(s.totals.rescued, 0);
  assert.equal(status(() => core.deleteVolunteer(pat.id))[0], 409, "accepted volunteer cannot be removed");
  assert.equal(status(() => core.respondToOffer(oBank.id, "accept"))[0], 409);

  // inbound call from the volunteer's phone finds their open job
  const job = core.openJobForPhone("+16465550123");
  assert.equal(job.offerId, oBank.id);
  assert.equal(job.volunteerName, "Pat");
  assert.equal(job.placeName, "Eastside Food Bank");
  assert.equal(core.openJobForPhone("(646) 555-0123").offerId, oBank.id, "caller id normalised");
  assert.equal(core.openJobForPhone("+19175550000"), null, "unknown caller");
  assert.equal(core.openJobForPhone(core.volunteerPhone(quinn.id)).offerId, null, "known volunteer, no open job");

  // delivered: only the volunteer holding the job, only once
  assert.equal(status(() => core.deliverOffer(oBank.id, { volunteerId: quinn.id }))[0], 409);
  s = core.deliverOffer(oBank.id, { volunteerId: pat.id });
  assert.equal(core.getOffer(oBank.id).status, "dropped_off");
  assert.equal(s.lots[0].status, "delivered");
  assert.equal(s.lots[0].stage, "done");
  assert.ok(s.lots[0].steps.every((x) => x.state === "done"));
  assert.equal(s.summary.rescued, 40);
  assert.equal(s.totals.rescued, 40);
  assert.equal(s.incident.status, "resolved", "every lot delivered: rescue done");
  assert.equal(s.journeyStep, "done");
  assert.equal(status(() => core.deliverOffer(oBank.id))[0], 409, "cannot deliver twice");
  s = core.deleteVolunteer(pat.id);
  assert.ok(!s.volunteers.some((v) => v.id === pat.id), "volunteer removable once delivered");
  assert.equal(s.summary.rescued, 40, "summary still counts the delivered offer");

  // ---- all places say no -> unclaimed; nobody answers in 10 minutes -> unclaimed ----
  core.createEvent({ name: "Lunch", venue: "Annex", items: [{ item: "Tacos", ordered: 20 }, { item: "Soda", ordered: 10 }], goodForMinutes: 60 });
  s = core.submitReport({ items: [{ item: "Tacos", left: 10 }, { item: "Soda", left: 5 }] });
  s = core.startPlaceOutreach({});
  const [tacos, soda] = s.lots;
  assert.equal(tacos.item, "Tacos");
  assert.ok(soda.places.some((p) => p.placeId === pantry.id), "drinks also go to the pantry");
  core.takePendingCalls();
  for (const p of tacos.places.filter((x) => x.status === "calling")) assert.equal(core.placeAnswer(p.offerId, "decline"), "declined");
  s = core.snapshot();
  assert.equal(s.lots[0].status, "unclaimed");
  assert.equal(s.lots[0].label, "Nobody took it");
  assert.equal(s.lots[0].steps[0].state, "failed");
  assert.ok(s.feed.some((f) => f.text === "Every place said no to 10 Tacos. It is unclaimed." && f.kind === "hq"));
  assert.equal(s.incident.status, "in_progress", "soda still open");
  assert.equal(core.checkTimeouts(Date.now() + 5 * 60000), false, "not yet");
  assert.equal(core.checkTimeouts(Date.now() + 10 * 60000 + 1000), true);
  s = core.snapshot();
  assert.equal(s.lots[1].status, "unclaimed");
  assert.ok(s.offers.filter((o) => o.lotId === soda.id).every((o) => o.status === "unclaimed"));
  assert.ok(s.feed.some((f) => f.text === "No place said yes to 5 Soda within 10 minutes. It is unclaimed."));
  assert.equal(s.incident.status, "expired", "every lot unclaimed or delivered: rescue done");
  assert.ok(s.feed.some((f) => f.text === "Rescue finished: 0 of 15 portions delivered."));
  assert.equal(core.placeAnswer(soda.places[0].offerId, "accept"), "closed", "a yes after the window is too late");

  // injectable window: 0 ms means the next expire() tick unclaims it
  core.createEvent({ name: "Brunch", venue: "Annex", items: [{ item: "Bagels", ordered: 10 }], goodForMinutes: 60 });
  core.submitReport({ items: [{ item: "Bagels", left: 6 }] });
  core.setPlaceTimeoutMs(0);
  core.startPlaceOutreach({});
  core.expire();
  assert.equal(core.snapshot().lots[0].status, "unclaimed");
  core.setPlaceTimeoutMs(10 * 60000);
  core.takePendingCalls();

  // no place with a phone: the lot is unclaimed straight away and HQ is told
  for (const p of core.snapshot().places) core.patchPlace(p.id, { phone: "" });
  core.createEvent({ name: "Dinner", venue: "Annex", items: [{ item: "Rice", ordered: 10 }], goodForMinutes: 60 });
  core.submitReport({ items: [{ item: "Rice", left: 4 }] });
  s = core.startPlaceOutreach({});
  assert.equal(s.lots[0].status, "unclaimed");
  assert.ok(s.feed.some((f) => f.text.startsWith("No place with a phone number can take 4 Rice")));
  assert.deepEqual(core.takePendingCalls(), []);
  assert.equal(status(() => core.deleteVolunteer("nope"))[0], 404);
  assert.equal(status(() => core.deletePlace("nope"))[0], 404);

  // ---- reset keeps user data; reset-all restores seeds -----------------------
  const keptVols = core.snapshot().volunteers.map((v) => v.id).sort();
  const keptPlaces = core.snapshot().places.map((p) => p.id).sort();
  const phonesBefore = core.internalState().volunteers.map((v) => [v.id, v.phone]);
  s = core.reset();
  assert.equal(s.event, null);
  assert.equal(s.report, null);
  assert.equal(s.offers.length, 0);
  assert.equal(s.feed.length, 0);
  assert.equal(s.incident, null);
  assert.deepEqual(s.volunteers.map((v) => v.id).sort(), keptVols);
  assert.deepEqual(s.places.map((p) => p.id).sort(), keptPlaces);
  assert.ok(s.volunteers.every((v) => v.status === "ready"));
  for (const [id, phone] of phonesBefore) assert.equal(core.volunteerPhone(id), phone, "reset keeps real phones");

  // deleting a seed volunteer and every place survives a reload (no silent re-seeding)
  for (const p of core.snapshot().places) core.deletePlace(p.id);
  const seedId = ["v1", "v2", "v3"].find((id) => core.snapshot().volunteers.some((v) => v.id === id));
  core.deleteVolunteer(seedId);
  assert.equal(saved().places.length, 0);
  assert.ok(!saved().volunteers.some((v) => v.id === seedId));

  s = core.resetAll();
  assert.deepEqual(s.volunteers.map((v) => v.id), ["v1", "v2", "v3"]);
  assert.deepEqual(s.places.map((p) => p.id), ["p1", "p2", "p3"]);
  assert.ok(saved().volunteers.every((v) => v.phone === ""));
  assert.equal(core.volunteerPhone("v1"), "");

  // ---- loading old saved state: placeholder phones are dropped, user lists are not re-seeded ----
  const dir2 = mkdtempSync(path.join(tmpdir(), "food-rescue-core-load-"));
  try {
    writeFileSync(path.join(dir2, "state.json"), JSON.stringify({
      event: null, report: null, offers: [], incident: null, feed: [], places: [],
      volunteers: [
        { id: "v2", name: "Jordan Lee", phone: "+12025550102", optedIn: true, status: "ready" },
        { id: "v-x", name: "Real Person", phone: "+14155552671", optedIn: true, status: "ready" },
      ],
    }));
    const out = execFileSync(process.execPath, ["--input-type=module", "-e",
      `const c = await import(${JSON.stringify(new URL("./core.js", import.meta.url).href)});
       const s = c.internalState();
       console.log(JSON.stringify({ places: s.places.length, ids: s.volunteers.map((v) => v.id), phones: s.volunteers.map((v) => v.phone) }));`,
    ], { env: { ...process.env, DATA_DIR: dir2 }, encoding: "utf8" });
    const loaded = JSON.parse(out.trim().split("\n").at(-1));
    assert.equal(loaded.places, 0, "empty place list stays empty");
    assert.deepEqual(loaded.ids, ["v2", "v-x"], "deleted seed volunteers are not re-added");
    assert.deepEqual(loaded.phones, ["", "+14155552671"], "placeholder phone removed, real phone kept");
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }

  console.log("core selftest: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
