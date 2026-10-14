import assert from "node:assert/strict";
import express from "express";
import { registerTranscribe, resetModelCache, chooseModel, wavSeconds, audioExtension } from "./transcribe.js";

const realFetch = globalThis.fetch;
const calls = [];
let models = ["gpt-4.1", "whisper-1", "gpt-4o-mini-transcribe"];
let mode = "ok";

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.openai.com/")) return realFetch(url, opts);
  calls.push({ url: u, opts });
  if (u.endsWith("/v1/models")) {
    if (mode === "models-down") return new Response("{}", { status: 403 });
    return Response.json({ data: models.map((id) => ({ id })) });
  }
  if (mode === "error") return new Response("{}", { status: 500 });
  if (mode === "throw") throw new Error("network down");
  if (mode === "empty") return Response.json({ text: "  " });
  const form = opts.body;
  assert.ok(form instanceof FormData);
  const file = form.get("file");
  assert.equal(file.name, "audio.webm");
  assert.equal(file.size, fakeWebm.length);
  assert.equal(form.get("language"), "en");
  return Response.json({ text: ` heard ${form.get("model")} ` });
};

// Small fake webm: EBML magic plus filler. Parsing is all that matters here, not decoding.
const fakeWebm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array.from({ length: 300 }, (_, i) => i % 256)]);
function wav(seconds, full = false) {
  const rate = 8000, data = rate * 2 * seconds, b = new Uint8Array(44 + (full ? data : Math.min(data, 64)));
  const v = new DataView(b.buffer);
  const put = (at, s) => [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  put(0, "RIFF"); v.setUint32(4, 36 + data, true); put(8, "WAVE"); put(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); put(36, "data"); v.setUint32(40, data, true);
  return b;
}

// Pure helpers
assert.equal(chooseModel(["a", "whisper-1", "gpt-4o-transcribe"]), "gpt-4o-transcribe");
assert.equal(chooseModel(["a", "whisper-1"]), "whisper-1");
assert.equal(chooseModel(["a", "acme-transcribe-2"]), "acme-transcribe-2");
assert.equal(chooseModel(["a"]), null);
assert.equal(audioExtension({ type: "audio/webm;codecs=opus" }), "webm");
assert.equal(audioExtension({ type: "audio/mp4" }), "mp4");
assert.equal(audioExtension({ type: "application/octet-stream", name: "note.m4a" }), "m4a");
assert.equal(audioExtension({ type: "image/png", name: "x.png" }), null);
assert.equal(wavSeconds(wav(3)), 64 / 16000); // truncated file: counts only the bytes present
assert.equal(wavSeconds(new Uint8Array(10)), null);

const app = express();
registerTranscribe(app);
app.use(express.json({ limit: "8kb" }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/transcribe`;
const send = async (blob, name = "clip.webm", extra = {}) => {
  const form = new FormData();
  if (blob) form.append("audio", blob, name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const r = await realFetch(base, { method: "POST", body: form });
  return { status: r.status, json: await r.json() };
};
const webm = () => new Blob([fakeWebm], { type: "audio/webm;codecs=opus" });

try {
  // Not configured: no key, no network.
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_TRANSCRIBE_MODEL;
  let r = await send(webm());
  assert.deepEqual(r.json, { notConfigured: true, message: "Voice is not set up. Type it instead." });
  assert.equal(calls.length, 0);

  // Multipart parse + model auto-pick (gpt-4o-mini-transcribe beats whisper-1), cached after one lookup.
  process.env.OPENAI_API_KEY = "test-key";
  resetModelCache();
  r = await send(webm());
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { text: "heard gpt-4o-mini-transcribe" });
  r = await send(webm());
  assert.deepEqual(r.json, { text: "heard gpt-4o-mini-transcribe" });
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/models")).length, 1);
  const tx = calls.find((c) => c.url.endsWith("/v1/audio/transcriptions"));
  assert.equal(tx.opts.headers.Authorization, "Bearer test-key");
  assert.ok(tx.opts.signal);

  // Env model wins, no model lookup.
  calls.length = 0;
  process.env.OPENAI_TRANSCRIBE_MODEL = "my-model";
  r = await send(webm());
  assert.deepEqual(r.json, { text: "heard my-model" });
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/models")).length, 0);
  delete process.env.OPENAI_TRANSCRIBE_MODEL;

  // Model list unreadable: falls back without caching, then tries the list again.
  resetModelCache();
  calls.length = 0;
  mode = "models-down";
  r = await send(webm());
  assert.deepEqual(r.json, { text: "heard whisper-1" });
  mode = "ok";
  models = ["gpt-4o-transcribe"];
  r = await send(webm());
  assert.deepEqual(r.json, { text: "heard gpt-4o-transcribe" });
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/models")).length, 2);

  // Failures give the plain message, never a 500.
  const FAILED = { failed: true, message: "I could not hear that. Try again or type it." };
  for (const m of ["error", "throw", "empty"]) {
    mode = m;
    r = await send(webm());
    assert.equal(r.status, 200, m);
    assert.deepEqual(r.json, FAILED, m);
  }
  mode = "ok";

  // Bad uploads.
  r = await send(null, undefined, { note: "x" });
  assert.equal(r.status, 400);
  r = await send(new Blob([new Uint8Array(0)], { type: "audio/webm" }));
  assert.equal(r.status, 400);
  r = await send(new Blob([new Uint8Array(10)], { type: "image/png" }), "x.png");
  assert.equal(r.status, 415);
  r = await send(webm(), "clip.webm", { duration: "90" });
  assert.equal(r.status, 413);
  r = await send(new Blob([wav(120)], { type: "audio/wav" }), "long.wav");
  assert.equal(r.status, 200); // truncated test file: real length is what is present
  assert.equal(wavSeconds(wav(70, true)), 70);
  r = await send(new Blob([wav(70, true)], { type: "audio/wav" }), "long.wav");
  assert.equal(r.status, 413);
  r = await send(new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "audio/webm" }));
  assert.equal(r.status, 413);
  const plain = await realFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(plain.status, 400);
  assert.ok((await plain.json()).message);

  console.log("transcribe selftest passed");
} finally {
  server.close();
  globalThis.fetch = realFetch;
}
