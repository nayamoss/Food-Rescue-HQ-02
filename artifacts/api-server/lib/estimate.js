import express from "express";

const NOT_CONFIGURED = { notConfigured: true, message: "Photo estimate is not set up. Enter amounts by hand." };
const FAILED = { failed: true, message: "We could not read that photo. Retake it or enter amounts by hand." };
const TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_COUNT = 100000;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/;

function decodedBytes(b64) {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validateRequest(body) {
  const images = body?.images;
  if (!Array.isArray(images) || images.length < 1 || images.length > 4) {
    return { error: "Send between 1 and 4 photos." };
  }
  for (const image of images) {
    const match = typeof image === "string" ? DATA_URL.exec(image) : null;
    if (!match) return { error: "Photos must be JPEG, PNG or WebP." };
    if (decodedBytes(match[2]) > MAX_IMAGE_BYTES) return { error: "Each photo must be 5 MB or smaller." };
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  const ordered = items
    .filter((row) => row && typeof row.item === "string" && row.item.trim())
    .slice(0, 50)
    .map((row) => ({ item: row.item.trim().slice(0, 100), ordered: Number.isFinite(Number(row.ordered)) ? Number(row.ordered) : null }));
  return { images, ordered };
}

export function buildInstruction(ordered) {
  const list = ordered.length
    ? ordered.map((row) => (row.ordered === null ? row.item : `${row.item} (ordered ${row.ordered})`)).join(", ")
    : "none given";
  return [
    "You are helping an event organizer count leftover food in the photos.",
    "Return JSON only, no prose and no code fences, with exactly this shape:",
    '{"items":[{"item":string,"count":number,"unit":string,"confidence":"low"|"medium"|"high","note":string}],"unreadable":boolean,"overall_note":string}',
    "Rules:",
    "- Count only what is visible. Do not guess hidden or off-screen food.",
    "- Reuse the ordered item names when they clearly match what you see; otherwise use a plain descriptive name.",
    "- The photos may overlap or show the same food from different angles. Do not double count.",
    "- Use a simple unit such as trays, boxes, portions, pizzas, bottles.",
    "- Do not judge whether the food is safe to eat.",
    "- Do not describe any people.",
    "- If no food is visible, set unreadable to true and return an empty items array.",
    `Ordered items: ${list}.`,
  ].join("\n");
}

export function extractText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  const parts = [];
  for (const out of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(out?.content) ? out.content : []) {
      if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n");
}

function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function parseEstimate(text) {
  const raw = typeof text === "string" ? firstJsonObject(text) : null;
  if (!raw || typeof raw !== "object") return null;
  const items = [];
  for (const row of Array.isArray(raw.items) ? raw.items : []) {
    const name = cleanText(row?.item, 100);
    const count = typeof row?.count === "number" ? row.count : typeof row?.count === "string" && row.count.trim() ? Number(row.count) : NaN;
    if (!name || !Number.isFinite(count)) continue;
    items.push({
      item: name,
      count: Math.min(MAX_COUNT, Math.max(0, Math.round(count))),
      unit: cleanText(row.unit, 40) || "portions",
      confidence: ["low", "medium", "high"].includes(row.confidence) ? row.confidence : "low",
      note: cleanText(row.note, 300),
    });
  }
  const unreadable = raw.unreadable === true || (items.length === 0 && raw.unreadable !== false);
  return { items, unreadable, overallNote: cleanText(raw.overall_note, 500) };
}

async function callOpenAI(images, instruction, apiKey, model) {
  const content = [{ type: "input_text", text: instruction }];
  for (const image of images) content.push({ type: "input_image", image_url: image, detail: "high" });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenAI responded ${response.status}`);
  return parseEstimate(extractText(await response.json()));
}

// Must be called before the global express.json() so this route's larger body limit applies.
export function registerEstimate(app) {
  const parser = express.json({ limit: "25mb" });
  app.post("/api/estimate", (req, res, next) => parser(req, res, (err) => {
    if (err) return res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? "Photos are too large." : "Invalid request." });
    next();
  }), async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_VISION_MODEL;
    if (!apiKey || !model) return res.json(NOT_CONFIGURED);
    const checked = validateRequest(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error });
    try {
      const result = await callOpenAI(checked.images, buildInstruction(checked.ordered), apiKey, model);
      return res.json(result ?? FAILED);
    } catch {
      return res.json(FAILED);
    }
  });
}
