// Speech to text for the mic button, so it works on phones without the browser speech API.
// POST /api/transcribe takes multipart/form-data with an "audio" field and answers { text }.
const NOT_CONFIGURED = { notConfigured: true, message: "Voice is not set up. Type it instead." };
const FAILED = { failed: true, message: "I could not hear that. Try again or type it." };
const TIMEOUT_MS = 30000;
const MODELS_TIMEOUT_MS = 10000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 256 * 1024; // room for the multipart wrapping
const MAX_SECONDS = 65; // "about a minute"
const PREFERRED = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"];
const FALLBACK_MODEL = "whisper-1"; // only used when the model list cannot be read; never cached
// Browsers label the same recording in different ways (iPhone: audio/mp4, Chrome: audio/webm;codecs=opus).
const TYPES = {
  "audio/webm": "webm", "video/webm": "webm",
  "audio/mp4": "mp4", "video/mp4": "mp4", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a",
  "audio/ogg": "ogg", "application/ogg": "ogg", "audio/opus": "ogg",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav",
};
const EXTENSIONS = new Set(["webm", "mp4", "m4a", "ogg", "oga", "wav"]);

const reject = (status, message) => ({ status, body: { error: message, message } });

export function audioExtension(file) {
  const type = String(file?.type || "").split(";")[0].trim().toLowerCase();
  if (TYPES[type]) return TYPES[type];
  const ext = String(file?.name || "").split(".").pop().toLowerCase();
  if (EXTENSIONS.has(ext)) return ext === "oga" ? "ogg" : ext;
  return null;
}

// Seconds of audio in a plain PCM WAV file, or null if it cannot be told from the header.
export function wavSeconds(bytes) {
  if (bytes.length < 44) return null;
  const text = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (text(0) !== "RIFF" || text(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12, byteRate = 0;
  while (at + 8 <= bytes.length) {
    const id = text(at), size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 16 <= bytes.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") return byteRate ? Math.min(size, bytes.length - at - 8) / byteRate : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) return resolve({ tooLarge: true });
    const chunks = [];
    let total = 0, done = false;
    const finish = (out) => { if (!done) { done = true; resolve(out); } };
    req.on("data", (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > limit) { chunks.length = 0; req.resume(); return finish({ tooLarge: true }); }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ buffer: Buffer.concat(chunks) }));
    req.on("error", () => finish({ error: true }));
    req.on("aborted", () => finish({ error: true }));
  });
}

// Reads the upload with the Web-standard multipart parser. No extra dependency.
export async function readAudio(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (!/^multipart\/form-data\s*;.*boundary=/i.test(contentType)) return reject(400, "Send the recording as a form upload.");
  const body = await readBody(req, MAX_BODY_BYTES);
  if (body.tooLarge) return reject(413, "That recording is too long. Keep it under a minute.");
  if (body.error) return reject(400, "The recording did not arrive. Try again.");
  let form;
  try {
    form = await new Request("http://local/upload", { method: "POST", headers: { "content-type": contentType }, body: body.buffer }).formData();
  } catch {
    return reject(400, "The recording did not arrive. Try again.");
  }
  const file = form.get("audio");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") return reject(400, "No recording was sent.");
  if (!file.size) return reject(400, "The recording was empty. Try again.");
  if (file.size > MAX_AUDIO_BYTES) return reject(413, "That recording is too long. Keep it under a minute.");
  const ext = audioExtension(file);
  if (!ext) return reject(415, "That recording type is not supported.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Length check: the browser may send its own count; WAV files carry it in the header.
  const claimed = Number(form.get("duration"));
  const seconds = ext === "wav" ? wavSeconds(bytes) : Number.isFinite(claimed) && claimed > 0 ? claimed : null;
  if (seconds !== null && seconds > MAX_SECONDS) return reject(413, "That recording is too long. Keep it under a minute.");
  return { bytes, ext };
}

let cachedModel = null;
export function resetModelCache() { cachedModel = null; }

export function chooseModel(ids) {
  const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string");
  return PREFERRED.find((id) => list.includes(id)) || list.find((id) => id.includes("transcribe")) || null;
}

// Env first. Otherwise ask OpenAI once which models this key can use and remember the answer.
export async function pickModel(apiKey) {
  const fromEnv = process.env.OPENAI_TRANSCRIBE_MODEL?.trim();
  if (fromEnv) return fromEnv;
  if (cachedModel) return cachedModel;
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (response.ok) {
      const payload = await response.json();
      const chosen = chooseModel((Array.isArray(payload?.data) ? payload.data : []).map((m) => m?.id));
      if (chosen) { cachedModel = chosen; return chosen; }
    }
  } catch { /* fall through */ }
  return FALLBACK_MODEL; // not cached, so the list is tried again next time
}

async function callOpenAI(bytes, ext, apiKey, model) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: ext === "wav" ? "audio/wav" : `audio/${ext}` }), `audio.${ext}`);
  form.append("model", model);
  form.append("language", "en");
  form.append("response_format", "json");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenAI responded ${response.status}`);
  const payload = await response.json();
  return typeof payload?.text === "string" ? payload.text.trim() : "";
}

// Must be called before the global express.json() so the raw upload is still unread.
export function registerTranscribe(app) {
  app.post("/api/transcribe", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) { req.resume(); return res.json(NOT_CONFIGURED); }
      const audio = await readAudio(req);
      if (audio.status) return res.status(audio.status).json(audio.body);
      const text = await callOpenAI(audio.bytes, audio.ext, apiKey, await pickModel(apiKey));
      return res.json(text ? { text } : FAILED);
    } catch {
      if (!res.headersSent) return res.json(FAILED);
    }
  });
}
