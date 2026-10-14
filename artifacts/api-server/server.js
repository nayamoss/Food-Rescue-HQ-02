import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from "pino";

const log = pino();
const root = fileURLToPath(new URL("../../", import.meta.url));
const dataDir = path.join(root, "data");
const stateFile = path.join(dataDir, "state.json");
mkdirSync(dataDir, { recursive: true });
const initial = () => ({
  volunteers: [
    { id: "v1", name: "Alex Rivera", phone: "+12025550101", optedIn: true },
    { id: "v2", name: "Jordan Lee", phone: "+12025550102", optedIn: true },
    { id: "v3", name: "Sam Taylor", phone: "+12025550103", optedIn: true },
    { id: "v4", name: "Morgan Chen", phone: "+12025550104", optedIn: true },
    { id: "v5", name: "Casey Brooks", phone: "+12025550105", optedIn: false },
  ],
  incident: null,
  feed: [],
});
let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : initial();
if (!Array.isArray(state.volunteers) || !Array.isArray(state.feed) ||
    (state.incident !== null && (!Array.isArray(state.incident?.assignments) ||
      !Number.isFinite(Date.parse(state.incident.deadline))))) {
  throw new Error("Invalid saved state. Refusing to overwrite data/state.json.");
}
const clients = new Set();
const active = () => state.incident && ["open", "in_progress"].includes(state.incident.status);
function snapshot() {
  const incident = state.incident;
  const total = incident?.total ?? 0;
  const assigned = incident?.assignments.reduce((sum, a) => sum + a.claimed, 0) ?? 0;
  const rescued = incident?.assignments.reduce((sum, a) => sum + a.pickedUp, 0) ?? 0;
  return { ...state, totals: { total, unclaimed: Math.max(0, total - assigned), claimed: Math.max(0, assigned - rescued), rescued } };
}
function entry(text) {
  return { id: randomUUID(), at: new Date().toISOString(), text };
}
function commit(next) {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${stateFile}.tmp`, stateFile);
  state = next;
  const message = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(message);
}
function expire() {
  if (active() && Date.now() >= Date.parse(state.incident.deadline)) {
    const rescued = snapshot().totals.rescued;
    const status = rescued >= state.incident.total ? "resolved" : "expired";
    commit({ ...state, incident: { ...state.incident, status }, feed: [
      entry(status === "expired" ? "Safety window ended. Remaining food is no longer available for rescue." : "All food rescued. Incident resolved."),
      ...state.feed,
    ] });
  }
}
if (!existsSync(stateFile)) commit(state);
expire();
const app = express();
// The graduated app has a prefixed API route; the original dashboard keeps /api.
app.use((req, _res, next) => {
  if (req.url === "/food-rescue-hq/api" || req.url.startsWith("/food-rescue-hq/api/")) {
    req.url = req.url.slice("/food-rescue-hq".length);
  }
  next();
});
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/api/state", (_req, res) => { expire(); res.json(snapshot()); });
app.get("/api/stream", (req, res) => {
  expire();
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => { clearInterval(heartbeat); clients.delete(res); });
});
app.post("/api/incidents", (req, res) => {
  expire();
  if (active()) return res.status(409).json({ error: "An incident is already active. Reset it before creating another." });
  const { food, total, location, minutes } = req.body ?? {};
  if (typeof food !== "string" || !food.trim() || food.length > 100 ||
      typeof location !== "string" || !location.trim() || location.length > 200 ||
      !Number.isInteger(total) || total < 1 || total > 1000000 ||
      typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    return res.status(400).json({ error: "Provide food, location, a positive integer total, and minutes between 0 and 1440." });
  }
  const incident = { id: randomUUID(), food: food.trim(), total, location: location.trim(),
    deadline: new Date(Date.now() + minutes * 60000).toISOString(), status: "open", assignments: [] };
  commit({ ...state, incident, feed: [entry(`Incident opened: ${total} ${incident.food} at ${incident.location}. ${minutes}-minute safety window.`), ...state.feed] });
  return res.status(201).json(snapshot());
});
app.post("/api/demo/fast-forward", (_req, res) => {
  expire();
  if (!active()) return res.status(409).json({ error: "Create an active incident first." });
  commit({ ...state, incident: { ...state.incident, deadline: new Date(Date.now() + 60000).toISOString() },
    feed: [entry("Demo fast-forward: safety deadline set to 60 seconds from now."), ...state.feed] });
  res.json(snapshot());
});
app.post("/api/demo/reset", (_req, res) => { commit(initial()); res.json(snapshot()); });
app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use(express.static(path.join(root, "public"), { etag: false, maxAge: 0 }));
app.use((err, _req, res, _next) => {
  log.error(err);
  res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? "Invalid JSON request." : "Unable to save or load incident state. Please try again." });
});
const timer = setInterval(() => { try { expire(); } catch (error) { log.error(error, "Unable to expire incident"); } }, 1000);
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be set to a valid port.");
const server = app.listen(port, "0.0.0.0", () => log.info({ port }, "Food Rescue HQ is listening"));
process.on("SIGTERM", () => {
  clearInterval(timer);
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
});
