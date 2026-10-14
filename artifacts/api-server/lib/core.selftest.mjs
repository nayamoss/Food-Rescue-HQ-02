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
  assert.equal(status(() => core.addVolunteer({ name: "Ann", phone: "4155552671" }))[0], 400);
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

  // ---- delete rules ----------------------------------------------------------
  core.createEvent({ name: "Gala", venue: "Hall", items: [{ item: "Tacos", ordered: 100 }], goodForMinutes: 60 });
  s = core.submitReport({ items: [{ item: "Tacos", left: 40 }] });
  const proposedAtBank = s.offers.find((o) => o.placeId === bank.id);
  assert.ok(proposedAtBank, "nearest place gets the proposed offer");
  // proposed-only offers do not block removing a place; they are dropped with it
  const z = s.places.find((p) => p.name === "Z");
  s = core.deletePlace(z.id);
  assert.ok(!s.places.some((p) => p.id === z.id));
  assert.ok(!s.offers.some((o) => o.placeId === z.id));

  s = core.sendOffers({});
  const sent = s.offers.find((o) => o.placeId === bank.id);
  assert.equal(sent.status, "offered");
  assert.ok(sent.volunteerId);
  assert.equal(status(() => core.deletePlace(bank.id))[0], 409, "place with sent offers cannot be removed");
  assert.equal(status(() => core.deleteVolunteer(sent.volunteerId))[0], 409, "offered volunteer cannot be removed");
  core.respondToOffer(sent.id, "accept");
  assert.equal(status(() => core.deleteVolunteer(sent.volunteerId))[0], 409, "accepted volunteer cannot be removed");
  core.pickupOffer(sent.id);
  assert.equal(status(() => core.deleteVolunteer(sent.volunteerId))[0], 409, "picked-up volunteer cannot be removed");
  core.dropoffOffer(sent.id);
  assert.equal(core.snapshot().offers.length, 1, "Z took 1, the food bank took 39; Z offer dropped with Z");
  s = core.deleteVolunteer(sent.volunteerId);
  assert.ok(!s.volunteers.some((v) => v.id === sent.volunteerId), "volunteer removable once delivered");
  assert.equal(s.summary.rescued, 39, "summary still counts the delivered offer (1 portion left with removed place Z)");
  assert.equal(status(() => core.deleteVolunteer("nope"))[0], 404);
  assert.equal(status(() => core.deletePlace("nope"))[0], 404);

  // ---- reset keeps user data; reset-all restores seeds -----------------------
  const keptVols = core.snapshot().volunteers.map((v) => v.id).sort();
  const keptPlaces = core.snapshot().places.map((p) => p.id).sort();
  s = core.reset();
  assert.equal(s.event, null);
  assert.equal(s.report, null);
  assert.equal(s.offers.length, 0);
  assert.equal(s.feed.length, 0);
  assert.equal(s.incident, null);
  assert.deepEqual(s.volunteers.map((v) => v.id).sort(), keptVols);
  assert.deepEqual(s.places.map((p) => p.id).sort(), keptPlaces);
  assert.ok(s.volunteers.every((v) => v.status === "ready"));
  assert.equal(core.volunteerPhone(quinn.id), "+15035550199", "reset keeps real phones");

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
