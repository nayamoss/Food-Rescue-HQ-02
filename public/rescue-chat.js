// Food Rescue HQ (Pocket HQ). Four tabs: Rescue (camera and voice first thread), Events, Partners, Volunteers.
// Everything talks to the real server. When the server says no, or an endpoint is missing, we say so in plain words.

const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;
const MAX_PHOTOS = 4;
const MAX_SIDE = 1600;
const PLACE_TYPES = [['shelter', 'Shelter'], ['kitchen', 'Kitchen'], ['food bank', 'Food bank']];
const ACCEPTS = [['prepared', 'Prepared food'], ['packaged', 'Packaged food'], ['drinks', 'Drinks']];
const GOOD_FOR = [30, 45, 60, 90, 120];
const RAW_LOG = /(^|\s)[\w.-]+=\S|\b[a-z]+_[a-z]+\b|[{}[\]]|\b(undefined|null|NaN)\b|\b[0-9a-f]{8}-[0-9a-f]{4}\b|^(POST|GET|PATCH|PUT)\b|https?:\/\/|\+?\d[\d\s().-]{8,}\d/i;
const TEXTING = /^texted\b|\btext message|\bsms\b|reply yes/i;
// Feed lines the thread already shows in its own words.
const NOISE = /^(Added event|Updated the event|Confirmed what is left|Confirmed that nothing|Matched |Added volunteer|Added place|Removed volunteer|Removed place|Saved a phone|Updated volunteer|Updated place|Incident opened)/i;
const MISSING = 'Endpoint not found.';
// Per lot: Calling partners, a partner said yes, Calling a volunteer, On the way, Delivered.
const LOT_STAGES = ['calling_places', 'place_accepted', 'calling_volunteer', 'on_the_way', 'delivered', 'unclaimed'];

const svg = (body, w = 2.2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const icon = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  logo: svg('<path d="m5 12 5 5 9-10"/>', 3),
  up: svg('<path d="m6 15 6-6 6 6"/>', 2.4),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  send: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.4),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.2"/>'),
  bolt: svg('<path d="M13 2 4 14h8l-1 8 9-12h-8z"/>', 2),
  cal: svg('<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>', 2),
  building: svg('<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M9.5 21.5v-4h5v4M8.5 7h.01M12 7h.01M15.5 7h.01M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 15h.01M15.5 15h.01"/>', 2),
  people: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>', 2),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 2),
  panelL: svg('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/>', 2),
  panelR: svg('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M15 3v18"/>', 2),
  minus: svg('<path d="M5 12h14"/>', 2.6),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.6),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 2.4),
  back: svg('<path d="m15 18-6-6 6-6"/>', 2.4),
  stop: '<svg class="rc-stopico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
};
const NAV = [['rescue', 'Rescue', icon.bolt], ['events', 'Events', icon.cal], ['places', 'Partners', icon.building], ['team', 'Volunteers', icon.people]];

const TEMPLATE = `
<div class="rc" data-urg="idle" data-tab="rescue" aria-busy="true">
  <nav class="rc-nav" aria-label="Main">
    <div class="rc-nav-head"><span class="rc-brand"><span class="rc-logo">${icon.logo}</span><span class="rc-nav-label">Food Rescue HQ</span></span>
      <button type="button" class="rc-icon rc-nav-toggle" data-act="toggleNav" aria-label="Collapse sidebar">${icon.panelL}</button></div>
    ${NAV.map(([id, label, ic]) => `<button type="button" class="rc-tabbtn" data-act="tab" data-v="${id}">${ic}<span class="rc-nav-label">${label}</span>${id === 'rescue' ? '<i class="rc-livedot" data-slot="livedot" hidden></i>' : ''}</button>`).join('')}
  </nav>
  <main class="rc-main">
    <header class="rc-top">
      <span class="rc-logo rc-logo-m">${icon.logo}</span>
      <h1 data-slot="title">Rescue</h1>
      <span class="rc-live" role="status"><i></i><span data-slot="live">Connecting to HQ</span></span>
      <button type="button" class="rc-btn rc-soft rc-sm rc-showstatus" data-act="toggleStatus" data-slot="showstatus" hidden>Show status</button>
      <button type="button" class="rc-icon rc-account" data-act="account" aria-label="Account and demo tools" aria-expanded="false">${icon.user}</button>
    </header>
    <div class="rc-error" role="alert" hidden><span data-slot="error"></span><button type="button" class="rc-btn" data-act="retry">Retry</button></div>
    <section class="rc-pane" data-pane="rescue">
      <button type="button" class="rc-pin" data-act="pin" aria-expanded="false" aria-controls="rc-sheet" hidden>
        ${ring(22, 30)}
        <span class="rc-pin-txt"><b data-t="timer">--:--</b><span data-slot="pin-sub"></span></span>
        <span class="rc-sample" data-slot="sample" hidden>Sample data</span>
        <span class="rc-chip" data-slot="chip"></span>
        <span class="rc-pin-open">${icon.up}<span class="rc-sr">Show rescue status</span></span>
      </button>
      <div class="rc-thread" data-slot="thread" role="log" aria-label="Rescue thread" tabindex="0"></div>
      <div class="rc-quick" data-slot="quick" aria-label="Quick replies"></div>
      <p class="rc-warn rc-recnote" data-slot="recnote" role="status" hidden></p>
      <form class="rc-composer" data-slot="composer" data-rec="idle">
        <div class="rc-recbar" aria-live="polite"><i class="rc-recdot" aria-hidden="true"></i><b data-slot="rec-time">0:00</b><span data-slot="rec-text">Listening…</span></div>
        <label class="rc-sr" for="rc-text">Message</label>
        <input id="rc-text" name="text" maxlength="280" autocomplete="off" placeholder="Say or type what’s left">
        <button type="submit" class="rc-send" aria-label="Send">${icon.send}</button>
        <button type="button" class="rc-micbtn" data-act="mic" data-target="composer" aria-pressed="false" aria-label="Record a voice message">${icon.mic}${icon.stop}</button>
      </form>
    </section>
    <section class="rc-pane rc-page" data-pane="page" data-slot="page" hidden></section>
  </main>
  <aside class="rc-status" aria-label="Rescue status">
    <div class="rc-status-head"><h2>Rescue status</h2><button type="button" class="rc-icon" data-act="toggleStatus" aria-label="Hide rescue status">${icon.panelR}</button></div>
    <div data-slot="status-desk"></div>
  </aside>
  <div class="rc-scrim" data-act="close" hidden></div>
  <section class="rc-sheet" id="rc-sheet" role="dialog" aria-modal="true" aria-labelledby="rc-sheet-title" hidden>
    <div class="rc-sheet-grip" aria-hidden="true"></div>
    <div class="rc-sheet-head"><h2 id="rc-sheet-title" data-slot="sheet-title">Rescue status</h2><button type="button" class="rc-icon" data-act="close" aria-label="Close">${icon.close}</button></div>
    <div class="rc-sheet-body" data-slot="sheet"></div>
  </section>
  <input type="file" accept="image/*" capture="environment" data-slot="cam" class="rc-sr" tabindex="-1" aria-hidden="true">
  <input type="file" accept="image/*" multiple data-slot="gallery" class="rc-sr" tabindex="-1" aria-hidden="true">
</div>`;

function ring(size, stroke) {
  return `<span class="rc-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 200 200" aria-hidden="true">` +
    `<circle class="rc-ring-track" cx="100" cy="100" r="${RING_R}" fill="none" stroke-width="${stroke}"/>` +
    `<circle class="rc-ring-fill" data-t="ring" cx="100" cy="100" r="${RING_R}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/></svg></span>`;
}
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (value) => Math.max(0, Math.round(Number(value) || 0));
const fmt = (value) => num(value).toLocaleString();
const sum = (list, fn) => list.reduce((t, x) => t + num(fn(x)), 0);
const initials = (name) => String(name || 'V').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const firstName = (name) => String(name || 'them').trim().split(/\s+/)[0];
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDay(new Date());
function niceDate(value) {
  if (!value) return '';
  if (value === todayIso()) return 'Today';
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
const lower = (s) => String(s || '').toLowerCase();
const NO_PHONE = 'No partner has a phone number yet. Add one in Partners to start.';
const foodLine = (items) => (items || []).filter((i) => num(i.left) > 0).map((i) => `${fmt(i.left)} ${lower(i.item)}`).join(', ');
const listWords = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);
const stepSize = (n) => (n >= 100 ? 10 : n >= 20 ? 5 : 1);
// Phones are never shown in full: only whether one is set and its last 4 digits.
const phoneSet = (x) => (typeof x?.phoneSet === 'boolean' ? x.phoneSet : /^\+?\d{8,}$/.test(String(x?.phone || '')));
const phoneLast4 = (x) => String(x?.phoneLast4 || String(x?.phone || '').replace(/\D/g, '').slice(-4) || '');
const phoneText = (x) => (phoneSet(x) ? `Phone added, ends in ${phoneLast4(x)}` : 'No phone yet');
const phoneOk = (raw) => String(raw || '').replace(/\D/g, '').length >= 10;
const PHONE_HELP = 'Enter the full 10-digit number, for example 762 235 7374. No need to type +1.';
const dot = (tone, text) => `<span class="rc-dot ${tone}">${esc(text)}</span>`;

const Speech = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const canRecord = () => typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined';
// webm on Chrome and Android, mp4 on iOS Safari.
function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus']) {
    try { if (window.MediaRecorder.isTypeSupported?.(t)) return t; } catch { /* keep looking */ }
  }
  return '';
}
const SAMPLE_EVENT = () => ({
  name: 'Conference lunch', venue: 'Main hall', date: todayIso(), goodForMinutes: 45,
  items: [{ item: 'Tacos', ordered: 400 }, { item: 'Sandwiches', ordered: 20 }, { item: 'Chips', ordered: 10 }],
});

// Turns "about a hundred tacos and 10 sandwiches at the main hall, good for half an hour" into items.
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
const toNumber = (w) => (/^\d+$/.test(w) ? Number(w) : WORD_NUM[lower(w)] ?? null);
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
function parseSpoken(text) {
  const t = ` ${lower(text)
    .replace(/\b(um+|uh+|like|so|okay|ok|basically|just|maybe|about|around|roughly|approximately)\b/g, ' ')
    .replace(/\bit'?s\b/g, ' ')
    .replace(/\b(half an hour|half hour|half-hour)\b/g, '30 minutes')
    .replace(/\b(an|one) hour\b/g, '60 minutes')
    .replace(/\b(\d+) hundred\b/g, (_, n) => String(Number(n) * 100))
    .replace(/\b(a|one) hundred\b/g, '100').replace(/\bhundred\b/g, '100')
    .replace(/\b(a )?dozen\b/g, '12')
    .replace(/\s+/g, ' ').trim()} `;
  const out = { items: [], venue: '', goodForMinutes: null, eventName: '' };
  const mins = t.match(/(\d+|an?|one|two)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (mins) { const n = toNumber(mins[1]) ?? 1; out.goodForMinutes = Math.round(/^h/i.test(mins[2]) ? n * 60 : n); }
  const venue = t.match(/\b(?:at|in)\s+(?:the\s+)?([a-z0-9' ]{2,40}?)(?=,|\.|;| good| for | until| by |$| and )/i);
  if (venue && !/^\d/.test(venue[1])) out.venue = titleCase(venue[1].trim());
  const name = t.match(/\b(?:from|after)\s+(?:the\s+)?([a-z0-9' ]{3,40}?)(?=,|\.| at | in |$)/i);
  if (name) out.eventName = titleCase(name[1].trim());
  const UNITS = /^(bags?|boxes?|trays?|cases?|pans?|plates?|pieces?|portions?|bottles?|cans?|cups?)\s+of\s+/i;
  const STOP = /\b(left|leftover|remaining|at|in|for|good|by|from|we have|there (are|is))\b/gi;
  for (const chunk of t.split(/,|;|\band\b|\.|\bplus\b/i)) {
    const m = chunk.trim().match(/^(?:we have|there are|there is|got)?\s*(\d+|[a-z]+)\s+(.+)$/i);
    if (!m) continue;
    const n = toNumber(m[1]);
    if (!n || n > 100000) continue;
    let rest = m[2];
    const unit = rest.match(UNITS);
    rest = rest.replace(UNITS, '').split(STOP)[0].replace(/[^a-z' -]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!rest || /^(minutes?|mins?|hours?|hrs?)$/i.test(rest)) continue;
    out.items.push({ item: titleCase(rest), left: n, unit: unit ? `${lower(unit[1]).replace(/s$/, '')}s` : 'portions' });
  }
  return out;
}

const freshUi = () => ({ eventId: null, count: null, editing: false, estMessage: '', talk: [], sample: false, agent: { msgs: [], chips: [], done: false, error: '' } });
const blankDraft = () => ({ name: '', venue: '', date: todayIso(), goodForMinutes: 45, items: [{ item: '', ordered: 0 }] });
const blankPlace = () => ({ name: '', type: 'shelter', distanceMiles: '', capacity: '', accepts: ['prepared', 'packaged', 'drinks'], address: '', phone: '' });
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* optional */ } } };

export function mountRescueChat(root, { apiBase = '' } = {}) {
  const lifecycle = new AbortController();
  const timers = [];
  let disposed = false;
  let state = null;
  let busy = false;
  let streamConnected = false;
  let lastSuccess = 0;
  let readPending = false;
  let revision = 0;
  let lastUrg = null;
  let photos = []; // data URLs, never saved
  let estimating = false;
  let alerting = false;
  let deferred = false;
  let tab = 'rescue'; // always open on Rescue
  let navOpen = store.get('rc-nav', '1') === '1';
  let statusOpen = store.get('rc-status', '1') === '1';
  let sheetView = null; // null | 'status' | 'account'
  // Voice notes: MediaRecorder -> POST /api/transcribe. SpeechRecognition is only a live preview on laptops.
  let rec = { state: 'idle', target: 'composer', mr: null, stream: null, chunks: [], started: 0, preview: null, previewText: '', timer: null, note: '' };
  let carryTalk = false;
  let lastStage = null;
  let doneUntil = 0;
  let agentBusy = false;
  let evView = { mode: 'list', draft: null, editing: false, error: '' };
  let pform = null; // partner add/edit form
  let vform = null; // volunteer add/edit form
  let confirmRm = null; // 'p:id' | 'v:id' | 'all' | 'lot:id' | 'rescue'
  let pageMsg = null; // { text, ok }
  let ui = freshUi();
  try { const saved = JSON.parse(sessionStorage.getItem('rc-ui2') || 'null'); if (saved) ui = { ...freshUi(), ...saved }; } catch { /* start fresh */ }
  const saveUi = () => { try { sessionStorage.setItem('rc-ui2', JSON.stringify(ui)); } catch { /* optional */ } };

  root.innerHTML = TEMPLATE;
  const app = root.querySelector('.rc');
  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
  const pin = root.querySelector('.rc-pin');
  const sheet = root.querySelector('.rc-sheet');
  const scrim = root.querySelector('.rc-scrim');
  const input = root.querySelector('#rc-text');
  const composer = slot('composer');
  const wide = () => window.matchMedia('(min-width: 1024px)').matches;

  // ---- derived data -------------------------------------------------------
  const event = () => state?.event || null;
  const events = () => (Array.isArray(state?.events) && state.events.length ? state.events : event() ? [event()] : []);
  const report = () => state?.report || null;
  const offers = () => state?.offers || [];
  const volunteers = () => state?.volunteers || [];
  const places = () => state?.places || [];
  const incident = () => state?.incident || null;
  const placeById = (id) => places().find((p) => p.id === id);
  const volOf = (id) => volunteers().find((v) => v.id === id);
  const isActiveInc = () => Boolean(incident() && ['open', 'in_progress'].includes(incident().status) && Date.now() < Date.parse(incident().deadline));
  const secondsLeft = () => { const d = Date.parse(incident()?.deadline); return Number.isFinite(d) ? Math.max(0, Math.ceil((d - Date.now()) / 1000)) : 0; };
  const windowSeconds = () => Math.max(num(incident()?.windowSeconds) || 2700, secondsLeft(), 1);

  // Lots: one per offer. Uses the server's stage info when it sends it, otherwise works it out from the offer.
  function offerStage(o) {
    if (LOT_STAGES.includes(o.stage)) return o.stage;
    if (LOT_STAGES.includes(o.status)) return o.status;
    if (o.status === 'offered') return o.volunteerId ? 'calling_volunteer' : 'place_accepted';
    if (o.status === 'accepted' || o.status === 'picked_up') return 'on_the_way';
    if (o.status === 'dropped_off') return 'delivered';
    if (o.status === 'declined') return 'unclaimed';
    return 'calling_places';
  }
  // Server lot status -> our stage names. "proposed" lots are not sent yet, so they are not outreach lots.
  const LOT_STATUS = { calling_places: 'calling_places', waiting_volunteer: 'place_accepted', calling_volunteer: 'calling_volunteer', on_the_way: 'on_the_way', delivered: 'delivered', unclaimed: 'unclaimed', cancelled: 'unclaimed' };
  function lots() {
    const raw = Array.isArray(state?.lots) && state.lots.length ? state.lots : null;
    if (raw) {
      return raw.filter((l) => LOT_STATUS[l.status]).map((l, i) => {
        const ps = Array.isArray(l.places) ? l.places : [];
        return { id: l.id || `lot-${i}`, offerId: l.offerId || null, item: l.item || 'Food', portions: num(l.portions), stage: LOT_STATUS[l.status], status: l.status,
          placeId: l.placeId || null, placeName: l.placeName || '', volunteerId: l.volunteerId || null, volunteerName: l.volunteerName || '',
          label: l.label || '', steps: Array.isArray(l.steps) ? l.steps : null, placeDeadline: l.placeDeadline || null, places: ps,
          calling: ps.filter((p) => p.status === 'calling').map((p) => p.placeId), saidNo: ps.filter((p) => p.status === 'declined').map((p) => p.placeId) };
      });
    }
    return offers().filter((o) => o.stage || o.status !== 'proposed').map((o) => ({ id: o.id, offerId: o.id, item: o.item, portions: num(o.portions), stage: offerStage(o),
      placeId: o.placeId || null, volunteerId: o.volunteerId || null, calling: null, saidNo: [] }));
  }
  function remaining() {
    const all = lots();
    const rows = (report()?.items || []).map((it) => {
      const mine = all.filter((l) => lower(l.item) === lower(it.item));
      const left = num(it.left);
      const rescued = sum(mine.filter((l) => l.stage === 'delivered'), (l) => l.portions);
      const onWay = sum(mine.filter((l) => l.stage === 'on_the_way'), (l) => l.portions);
      return { item: it.item, left, rescued, onWay, need: Math.max(0, left - rescued - onWay) };
    });
    return { rows, left: sum(rows, (r) => r.left), rescued: sum(rows, (r) => r.rescued), onWay: sum(rows, (r) => r.onWay), need: sum(rows, (r) => r.need) };
  }
  // none: no event; count: waiting for what is left; ready: counted, partners not alerted; outreach; done.
  function rescueStage() {
    if (!event()) return 'none';
    if (!report()) return 'count';
    const all = lots();
    const r = remaining();
    if (r.left === 0 || (incident() && !isActiveInc())) return 'done';
    if (all.length && all.every((l) => ['delivered', 'unclaimed'].includes(l.stage))) return 'done';
    if (!all.length) return state.journeyStep === 'done' && !offers().length && !(state.lots || []).length ? 'done' : 'ready';
    return 'outreach';
  }
  const live = () => ['ready', 'outreach'].includes(rescueStage()) && isActiveInc();
  function urgency() {
    const inc = incident();
    const st = rescueStage();
    if (!inc || !report()) return 'idle';
    if (st === 'done') { const r = remaining(); return inc.status === 'resolved' || r.left === 0 || r.rescued >= r.left || isActiveInc() ? 'done' : timeUp() ? 'ended' : 'closed'; }
    if (!isActiveInc()) return 'ended';
    const s = secondsLeft();
    return s <= 300 ? 'crit' : s <= 900 ? 'warn' : 'calm';
  }
  // Why a rescue ended. "Time up" only when the safety deadline really passed.
  const timeUp = () => { const d = Date.parse(incident()?.deadline); return Number.isFinite(d) && Date.now() >= d; };
  function endReason() {
    if (timeUp()) return 'The time ran out.';
    const raw = (state?.lots || []).find((l) => l.status === 'unclaimed' && l.label);
    return raw ? `${raw.label}.` : 'Nobody took the rest.';
  }
  const CHIP = { idle: '', calm: 'Open', warn: 'Open', crit: 'Hurry', done: 'Done', ended: 'Time up', closed: 'Ended' };
  function timerText() {
    const urg = urgency();
    if (urg === 'done') return 'Done';
    if (urg === 'ended') return '00:00';
    if (urg === 'closed') return 'Ended';
    if (urg === 'idle') return '--:--';
    const s = secondsLeft();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  // Partners the server would call for this food (nearest first).
  const kindOf = (item) => (/water|juice|soda|drink|coffee|tea|milk|bottle|can\b/i.test(item) ? 'drinks' : /chip|bar|snack|packaged|cookie|candy|cracker/i.test(item) ? 'packaged' : 'prepared');
  const nearbyFor = (item) => places().filter((p) => !Array.isArray(p.accepts) || !p.accepts.length || p.accepts.includes(kindOf(item))).sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
  function lotActivity(all) {
    const by = (s) => all.filter((l) => l.stage === s).length;
    if (by('calling_places')) { const n = new Set(all.filter((l) => l.stage === 'calling_places').flatMap((l) => (l.calling && l.calling.length ? l.calling : l.places?.length ? [] : nearbyFor(l.item).map((p) => p.id)))).size; return `calling ${n || ''} partner${n === 1 ? '' : 's'}`.replace('  ', ' '); }
    if (by('place_accepted') || by('calling_volunteer')) return 'calling a volunteer';
    if (by('on_the_way')) return 'on the way';
    return `${fmt(remaining().rescued)} delivered`;
  }

  function shortActivity() {
    const all = lots();
    const has = (x) => all.some((l) => l.stage === x);
    return has('calling_places') ? 'Calling partners' : has('calling_volunteer') || has('place_accepted') ? 'Calling a volunteer' : has('on_the_way') ? 'On the way' : has('unclaimed') ? endReason().replace(/\.$/, '') : 'Wrapping up';
  }

  // ---- shared bits -------------------------------------------------------
  const avatar = (name) => `<span class="rc-av" aria-hidden="true">${esc(initials(name))}</span>`;
  const hqAv = '<span class="rc-av hq" aria-hidden="true">HQ</span>';
  const hqRow = (inner, time) => `<div class="rc-row">${hqAv}<div class="rc-col"><div class="rc-who">HQ${time ? `<time>${esc(time)}</time>` : ''}</div>${inner}</div></div>`;
  const bubble = (html) => `<div class="rc-bub">${html}</div>`;
  const meRow = (text, time) => `<div class="rc-row rc-me"><div class="rc-col"><div class="rc-who">You${time ? `<time>${esc(time)}</time>` : ''}</div><div class="rc-bub me">${esc(text)}</div></div></div>`;
  const dis = () => (busy || !state ? ' disabled' : '');
  const say = (who, text) => { ui.talk = [...ui.talk, { who, text, at: Date.now() }].slice(-30); saveUi(); };
  const stepper = (scope, i, k, value, label) => `<div class="rc-step" role="group" aria-label="${esc(label)}">
      <button type="button" class="rc-icon" data-act="step" data-dir="-1" data-scope="${scope}" data-i="${i}" data-k="${k}" aria-label="Less ${esc(label)}">${icon.minus}</button>
      <input inputmode="numeric" data-f="${scope}" data-i="${i}" data-k="${k}" value="${esc(value)}" aria-label="${esc(label)}">
      <button type="button" class="rc-icon" data-act="step" data-dir="1" data-scope="${scope}" data-i="${i}" data-k="${k}" aria-label="More ${esc(label)}">${icon.plus}</button></div>`;
  const seg = (scope, k, options, current) => `<div class="rc-seg" role="radiogroup">${options.map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(current) === String(v)}" data-act="pick" data-scope="${scope}" data-k="${k}" data-v="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;

  function volStatus(v) {
    const mine = lots().filter((l) => l.volunteerId === v.id);
    const cur = mine.find((l) => ['calling_volunteer', 'on_the_way'].includes(l.stage)) || mine.find((l) => l.stage === 'delivered');
    if (cur?.stage === 'calling_volunteer') return ['purple', 'Being called'];
    if (cur?.stage === 'on_the_way') return ['purple', 'On the way'];
    if (cur?.stage === 'delivered') return ['green', 'Delivered'];
    if (offers().some((o) => (o.declinedBy || []).includes(v.id))) return ['grey', 'Said no'];
    if (v.optedIn === false) return ['grey', 'Not taking asks'];
    return ['grey', 'Ready'];
  }
  const PLACE_WORD = { calling: ['purple', 'Being called'], accepted: ['green', 'Said yes'], declined: ['grey', 'Said no'], taken: ['grey', 'Someone else took it'], unclaimed: ['orange', 'No answer'], skipped: ['orange', 'No phone, not called'], proposed: ['grey', 'Not called yet'] };
  function placeStatus(p) {
    const all = lots();
    const rows = all.flatMap((l) => (l.places || []).filter((x) => x.placeId === p.id));
    if (rows.length) {
      for (const s of ['accepted', 'calling', 'declined', 'unclaimed', 'skipped', 'taken', 'proposed']) if (rows.some((x) => x.status === s)) return PLACE_WORD[s];
    }
    if (all.some((l) => l.placeId === p.id && l.stage !== 'calling_places' && l.stage !== 'unclaimed')) return ['green', 'Said yes'];
    if (all.some((l) => (l.saidNo || []).includes(p.id))) return ['grey', 'Said no'];
    if (all.some((l) => l.stage === 'calling_places' && (l.calling ? l.calling.includes(p.id) : nearbyFor(l.item).some((x) => x.id === p.id)))) return ['purple', 'Being called'];
    return ['grey', 'Ready'];
  }

  // ---- rescue thread -------------------------------------------------------
  function photoBlock(secondary) {
    const thumbs = photos.map((src, i) => `<img src="${esc(src)}" alt="Photo ${i + 1} of what is left">`).join('');
    const firstCam = store.get('rc-cam-used', '') ? '' : '<p class="rc-hint">Your phone will ask to use the camera the first time.</p>';
    const cam = `<button type="button" class="rc-btn ${secondary ? '' : 'rc-primary rc-big'} rc-cam" data-act="takePhoto"${estimating || busy ? ' disabled' : ''}>${icon.camera}<span>${secondary ? 'Take another photo' : 'Take a photo of what’s left'}</span></button>`;
    return `<div class="rc-cardm rc-photo">${cam}
      ${secondary ? '' : firstCam}
      ${thumbs ? `<div class="rc-thumbs">${thumbs}</div>` : ''}
      ${estimating ? '<p class="rc-line rc-typing">Counting what is in the photo</p>' : ''}
      ${ui.estMessage ? `<p class="rc-warn" role="status">${esc(ui.estMessage)}</p>` : ''}
      <div class="rc-actions rc-links"><button type="button" class="rc-link" data-act="pickPhoto">Choose from gallery</button>
      ${ui.estMessage || !secondary ? '<button type="button" class="rc-link" data-act="countByHand">Count by hand</button>' : ''}</div></div>`;
  }
  // One sentence with one primary action, or steppers while editing.
  function countCard(fromReport) {
    const items = fromReport ? report().items : ui.count.items;
    const sentence = foodLine(items) ? `About ${foodLine(items)}` : 'Nothing counted yet';
    const where = !event() && ui.count && (ui.count.venue || ui.count.goodForMinutes) ? `<p class="rc-line">${ui.count.venue ? `At ${esc(ui.count.venue)}` : ''}${ui.count.venue && ui.count.goodForMinutes ? ', ' : ''}${ui.count.goodForMinutes ? `good for ${fmt(ui.count.goodForMinutes)} minutes` : ''}</p>` : '';
    if (!fromReport && ui.editing) {
      const rows = ui.count.items.map((it, i) => `<div class="rc-countrow"><span class="rc-grow">${esc(it.item)}</span>${stepper('count', i, 'left', num(it.left), it.item)}</div>`).join('');
      return hqRow(`<div class="rc-cardm"><h3>Edit amounts</h3>${rows}
        <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="doneEdit">Done</button></div></div>`);
    }
    const noPhone = !places().some(phoneSet);
    const can = foodLine(items) && !alerting && !noPhone;
    const e = event();
    const c = ui.count || {};
    const evName = c.eventName ?? (e?.name || '');
    const evVenue = c.venue ?? (e?.venue || '');
    const fields = fromReport
      ? `<p class="rc-line">Event: ${esc(e?.name || '')}${e?.venue ? ` · ${esc(e.venue)}` : ''}</p>`
      : `<label class="rc-fld"><span>Event</span><input data-f="cf" data-k="eventName" value="${esc(evName || `Leftovers at ${evVenue || 'the venue'}`)}" placeholder="Conference lunch" autocomplete="off"></label>
         <label class="rc-fld"><span>Where</span><input data-f="cf" data-k="venue" value="${esc(evVenue)}" placeholder="Main hall" autocomplete="off"></label>`;
    const withPhone = places().filter(phoneSet).length;
    const near = `<p class="rc-line">Partners nearby: ${fmt(places().length)} partners, ${fmt(withPhone)} with a phone${withPhone ? '' : '. <button type="button" class="rc-link" data-act="tab" data-v="places">Add a phone</button>'}</p>`;
    return hqRow(`<div class="rc-cardm rc-confirm">${fields}<p class="rc-line">Available</p><p class="rc-sentence">${esc(sentence)}</p>${where}${near}
      ${ui.count?.confidenceNote ? `<p class="rc-hint">${esc(ui.count.confidenceNote)}</p>` : ''}
      <button type="button" class="rc-btn rc-primary rc-big" data-act="alert"${can && !busy ? '' : ' disabled'}>${alerting ? 'Alerting partners' : 'Yes, alert partners'}</button>
      ${noPhone ? `<p class="rc-warn" role="status">${esc(NO_PHONE)} <button type="button" class="rc-link" data-act="tab" data-v="places">Add a phone</button></p>` : ''}
      ${fromReport ? '' : '<button type="button" class="rc-btn rc-big rc-soft" data-act="editAmounts">Edit amounts</button>'}</div>`);
  }
  const LOT_TONE = { calling_places: 'purple', place_accepted: 'purple', calling_volunteer: 'purple', on_the_way: 'purple', delivered: 'green', unclaimed: 'orange' };
  const STEP_TONE = { done: 'green', active: 'purple', waiting: 'orange', failed: 'orange', todo: 'grey' };
  function serverLotTrack(l) {
    const li = l.steps.map((s) => {
      const text = s.key === 'delivered' && s.state !== 'done' ? `${s.label} (the volunteer confirms)` : s.state === 'waiting' && s.key === 'volunteer' ? 'Waiting for a free volunteer' : s.label;
      const sub = s.key === 'places' && s.state === 'active' && l.places.length
        ? `<ul class="rc-subplaces">${l.places.map((p) => `<li><span>${esc(p.name)}</span>${dot(...(PLACE_WORD[p.status] || ['grey', p.status]))}</li>`).join('')}</ul>
           ${l.placeDeadline ? `<p class="rc-hint">Partners have until ${esc(clock(l.placeDeadline))} to answer. First yes gets it.</p>` : ''}` : '';
      return `<li class="${s.state === 'active' ? 'now' : s.state === 'todo' ? 'todo' : ''}">${dot(STEP_TONE[s.state] || 'grey', text)}${sub}</li>`;
    }).join('');
    return `<div class="rc-lot"><div class="rc-lothead"><b>${fmt(l.portions)} ${esc(lower(l.item))}</b>${lotCancel(l)}</div>
      <p class="rc-lotlabel">${dot(LOT_TONE[l.stage] || 'purple', l.label)}</p><ol class="rc-track">${li}</ol>${lotCancelConfirm(l)}</div>`;
  }
  // A lot can be cancelled by HQ while it is still open (not delivered, unclaimed or cancelled).
  const lotOpen = (l) => l.stage !== 'delivered' && l.stage !== 'unclaimed';
  const lotCancel = (l) => (lotOpen(l) && confirmRm !== `lot:${l.id}` ? `<button type="button" class="rc-link rc-sm" data-act="lotCancel" data-id="${esc(l.id)}">Cancel</button>` : '');
  const lotCancelConfirm = (l) => (confirmRm === `lot:${l.id}`
    ? `<p class="rc-line">Cancel ${fmt(l.portions)} ${esc(lower(l.item))}? Its calls stop and the volunteer is freed.</p><div class="rc-actions"><button type="button" class="rc-btn rc-danger rc-sm" data-act="lotCancelYes" data-id="${esc(l.id)}"${dis()}>Yes, cancel it</button><button type="button" class="rc-btn rc-soft rc-sm" data-act="rmNo">Keep it</button></div>`
    : '');
  function lotTrack(l) {
    if (l.steps && l.steps.length) return serverLotTrack(l);
    const place = placeById(l.placeId);
    const vol = volOf(l.volunteerId);
    const calling = l.calling ? l.calling.length : nearbyFor(l.item).length;
    const idx = { calling_places: 0, place_accepted: 2, calling_volunteer: 2, on_the_way: 3, delivered: 5 }[l.stage];
    const failAt = l.stage === 'unclaimed' ? (l.volunteerId ? 2 : l.placeId ? 2 : 0) : -1;
    const steps = [
      ['Calling partners', `Calling ${calling || ''} partner${calling === 1 ? '' : 's'} nearby`.replace('  ', ' '), 'Called partners'],
      ['Waiting for a yes', 'Waiting for a yes', `${place?.name || 'A partner'} said yes`],
      ['Calling a volunteer', vol ? `Calling ${firstName(vol.name)}` : 'Finding a volunteer', vol ? `${firstName(vol.name)} said yes` : 'A volunteer said yes'],
      ['On the way', vol ? `${firstName(vol.name)} is on the way` : 'On the way', 'Picked up'],
      ['Delivered', 'Delivered', `Delivered to ${place?.name || 'the partner'}`],
    ];
    const li = steps.map(([todo, now, done], i) => {
      if (failAt >= 0) {
        if (i < failAt) return `<li>${dot('green', done)}</li>`;
        if (i === failAt) return `<li>${dot('orange', i === 0 ? 'No partner said yes in time' : 'No volunteer could take it')}</li>`;
        return '';
      }
      if (i < idx) return `<li>${dot('green', done)}</li>`;
      if (i === idx) return `<li class="now">${dot('purple', now)}</li>`;
      return `<li class="todo">${dot('grey', i === 4 ? 'Delivered (the volunteer confirms)' : todo)}</li>`;
    }).join('');
    const label = l.stage === 'delivered' ? ['green', 'Delivered'] : l.stage === 'unclaimed' ? ['orange', 'Unclaimed'] : ['purple', { calling_places: 'Calling partners', place_accepted: 'Partner said yes', calling_volunteer: 'Calling a volunteer', on_the_way: 'On the way' }[l.stage]];
    return `<div class="rc-lot"><div class="rc-lothead"><b>${fmt(l.portions)} ${esc(lower(l.item))}</b>${dot(...label)}${lotCancel(l)}</div><ol class="rc-track">${li}</ol>${lotCancelConfirm(l)}</div>`;
  }
  function outreachCard() {
    const all = lots();
    if (!all.length) return '';
    return hqRow(bubble('I am calling partners nearby. The first one to say yes gets it, then I call a volunteer to take it there.') +
      `<div class="rc-cardm">${all.map(lotTrack).join('')}</div>`);
  }
  function summaryCard() {
    const s = state.summary || {};
    const r = remaining();
    const left = s.left ?? r.left;
    const rescued = Math.max(num(s.rescued), r.rescued);
    const by = places().map((p) => ({ name: p.name, n: sum(lots().filter((l) => l.placeId === p.id && l.stage === 'delivered'), (l) => l.portions) })).filter((p) => p.n > 0);
    const line = left === 0 ? 'Nothing was left over.' : rescued >= left ? 'Everything that was left found a home.' : 'The rescue is over. Here is how it went.';
    return hqRow(bubble(line) + `<div class="rc-cardm"><h3>Rescue summary</h3>
      ${[['Left over', left], ['Delivered', rescued], ['Not rescued', Math.max(0, left - rescued)]].map(([k, v]) => `<p class="rc-kv"><span>${k}</span><b>${fmt(v)}</b></p>`).join('')}
      ${by.length ? `<p class="rc-sub">Where it went</p>${by.map((p) => `<p class="rc-kv"><span>${esc(p.name)}</span><b>${fmt(p.n)}</b></p>`).join('')}` : ''}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="tab" data-v="events">Start a new rescue</button></div></div>`);
  }
  function answer(kind) {
    if (kind === 'free') {
      const free = volunteers().filter((v) => volStatus(v)[1] === 'Ready');
      return `<b>${free.length} free right now</b>` + volunteers().map((v) => `<div class="rc-li">${avatar(v.name)}<span>${esc(v.name)}</span>${dot(...volStatus(v))}</div>`).join('');
    }
    if (!report()) return 'Nothing counted yet. Take a photo of what is left first.';
    const r = remaining();
    if (r.need === 0 && r.onWay === 0) return r.left === 0 ? 'Nothing is left.' : 'Everything is delivered.';
    const need = r.rows.filter((x) => x.need > 0).map((x) => `${fmt(x.need)} ${esc(lower(x.item))}`).join(', ');
    return `${need || 'Nothing'} still need a home. ${fmt(r.onWay)} on the way, ${fmt(r.rescued)} delivered.`;
  }
  function feedRow(entry) {
    const text = String(entry.text || '').trim();
    if (!text || RAW_LOG.test(text) || TEXTING.test(text) || NOISE.test(text)) return '';
    if (entry.kind === 'update') return meRow(text, clock(entry.at));
    const v = volOf(entry.volunteerId) || volunteers().find((x) => x.name && text.startsWith(x.name));
    if (v) return `<div class="rc-row">${avatar(v.name)}<div class="rc-col"><div class="rc-who">${esc(v.name)}<time>${esc(clock(entry.at))}</time></div>${bubble(esc(text))}</div></div>`;
    return hqRow(bubble(esc(text)), clock(entry.at));
  }
  function buildThread() {
    const e = event();
    const st = rescueStage();
    const parts = [];
    if (!e) {
      parts.push(hqRow(bubble('Which event is this? Tap the mic or type it, like “Tech conference lunch at the main hall”.') +
        `<div class="rc-cardm"><p class="rc-line">No event yet.</p><div class="rc-actions">${events().length ? '<button type="button" class="rc-btn rc-soft" data-act="tab" data-v="events">Pick an existing event</button>' : ''}<button type="button" class="rc-btn rc-soft" data-act="newEvent">Add an event</button></div></div>`));
    } else {
      parts.push(`<div class="rc-sys">${esc(e.name)}${e.venue ? ` · ${esc(e.venue)}` : ''}${e.date ? ` · ${esc(niceDate(e.date))}` : ''}</div>`);
      if (st === 'count') parts.push(hqRow(bubble(`What’s left from ${esc(e.name)}?`) + photoBlock(Boolean(ui.count))));
      if (report()) {
        const inc = incident();
        parts.push(`<div class="rc-sys rc-sys-ink">Rescue started · ${esc(foodLine(report().items) || 'nothing left')}${inc?.deadline ? ` · safe until ${esc(clock(inc.deadline))}` : ''}</div>`);
      }
    }
    // The conversation: what you said, HQ's replies and the live feed, oldest first.
    const timeline = [];
    for (const t of ui.talk) timeline.push({ at: t.at, html: t.who === 'me' ? meRow(t.text, clock(t.at)) : t.ask ? meRow(t.ask === 'free' ? 'Who’s free?' : 'What’s left?', clock(t.at)) + hqRow(`<div class="rc-bub rc-rich">${answer(t.ask)}</div>`) : hqRow(bubble(esc(t.text))) });
    if (report()) for (const f of [...(state.feed || [])].reverse()) { const html = feedRow(f); if (html) timeline.push({ at: Date.parse(f.at) || 0, html }); }
    timeline.sort((a, b) => a.at - b.at).forEach((x) => parts.push(x.html));
    if ((st === 'count' || st === 'none') && ui.count) parts.push(countCard(false));
    if (st === 'ready') parts.push(countCard(true));
    if (st === 'outreach' || st === 'done') parts.push(outreachCard());
    if (st === 'done') parts.push(summaryCard());
    return parts.join('');
  }

  const typing = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  let threadHtml = '';
  function renderThread() {
    const thread = slot('thread');
    const html = buildThread();
    if (html === threadHtml) return;
    const el = document.activeElement;
    if (thread.contains(el) && typing(el)) { deferred = true; return; }
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 200;
    const keep = thread.scrollTop;
    threadHtml = html;
    thread.innerHTML = html;
    thread.scrollTop = nearBottom || !lastSuccess ? thread.scrollHeight : keep;
  }
  const lastHtml = new Map();
  function setHtml(el, html) {
    if (lastHtml.get(el) === html) return;
    if (el.contains(document.activeElement) && typing(document.activeElement)) { deferred = true; return; }
    lastHtml.set(el, html);
    el.innerHTML = html;
  }
  function renderComposer() {
    const st = state ? rescueStage() : 'none';
    const chips = ['outreach', 'done', 'ready'].includes(st) ? '<button type="button" class="rc-chipbtn" data-ask="left">What’s left?</button><button type="button" class="rc-chipbtn" data-ask="free">Who’s free?</button>' : '';
    setHtml(slot('quick'), chips);
    slot('quick').hidden = !chips;
    const mine = rec.target === 'composer';
    composer.dataset.rec = mine ? rec.state : 'idle';
    composer.dataset.text = input.value.trim() ? '1' : '';
    const micBtn = composer.querySelector('.rc-micbtn');
    micBtn.hidden = !canRecord();
    micBtn.disabled = rec.state === 'proc' || (rec.state === 'rec' && !mine);
    micBtn.setAttribute('aria-pressed', String(mine && rec.state === 'rec'));
    micBtn.setAttribute('aria-label', mine && rec.state === 'rec' ? 'Stop recording and send' : 'Record a voice message');
    if (mine && rec.state === 'proc') { slot('rec-time').textContent = ''; slot('rec-text').textContent = 'Turning your voice into text…'; }
    const note = mine ? rec.note : '';
    slot('recnote').textContent = note;
    slot('recnote').hidden = !note;
    input.placeholder = st === 'outreach' || st === 'done' ? 'Post an update to the team' : st === 'ready' || ui.count ? 'Say or type “yes” to alert partners' : !event() ? 'Say or type which event this is' : 'Say or type what’s left';
    composer.querySelector('.rc-send').disabled = busy || !state;
  }
  const recTime = () => { const s = Math.floor((Date.now() - rec.started) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function updateRecBar() {
    if (rec.state !== 'rec') return;
    root.querySelectorAll('[data-slot="rec-time"]').forEach((el) => { el.textContent = recTime(); });
    root.querySelectorAll('[data-slot="rec-text"]').forEach((el) => { el.textContent = rec.previewText || 'Listening…'; });
  }
  const micButton = (target) => (canRecord() ? `<button type="button" class="rc-micbtn" data-act="mic" data-target="${target}" aria-pressed="${rec.target === target && rec.state === 'rec'}" aria-label="${rec.target === target && rec.state === 'rec' ? 'Stop recording and send' : 'Record a voice answer'}"${rec.state === 'proc' ? ' disabled' : ''}>${icon.mic}${icon.stop}</button>` : '');

  // ---- events tab -----------------------------------------------------------
  function eventState(e) {
    if (e.id !== event()?.id) return ['grey', 'Not started'];
    const st = rescueStage();
    return st === 'count' ? ['purple', 'Waiting for the count'] : st === 'ready' ? ['purple', 'Counted'] : st === 'outreach' ? ['orange', 'Rescue live'] : st === 'done' ? ['green', 'Rescue done'] : ['grey', 'Not started'];
  }
  function eventsList() {
    const list = events();
    const head = `<div class="rc-pagehead rc-pagehead-end"><button type="button" class="rc-btn rc-primary" data-act="newEvent">Add event</button></div>`;
    if (!list.length) return `${head}<div class="rc-empty"><p>No events yet. Add the one you are at today.</p></div>`;
    return head + `<div class="rc-list">${list.map((e) => `<button type="button" class="rc-rowcard" data-act="openEvent" data-id="${esc(e.id)}">
      <span class="rc-grow"><b>${esc(e.name)}</b><small>${esc(e.venue || 'No venue yet')}${e.date ? ` · ${esc(niceDate(e.date))}` : ''}</small></span>${dot(...eventState(e))}</button>`).join('')}</div>`;
  }
  function agentBlock() {
    const a = ui.agent;
    const rows = a.msgs.map((m) => (m.role === 'user' ? meRow(m.text) : hqRow(bubble(esc(m.text))))).join('');
    const start = !a.msgs.length && !agentBusy && !a.error;
    const chips = a.chips.length && !agentBusy ? `<div class="rc-quick">${a.chips.map((c) => `<button type="button" class="rc-chipbtn" data-act="agentChip" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
    return `<div class="rc-section"><h3>Questions from HQ</h3>
      ${start ? '<p class="rc-line">HQ asks a few short questions to fill in the details, like how long the food stays good.</p><div class="rc-actions"><button type="button" class="rc-btn rc-soft" data-act="agentStart">Answer HQ’s questions</button></div>' : ''}
      ${rows ? `<div class="rc-agentlog">${rows}</div>` : ''}
      ${agentBusy ? hqRow(bubble('<span class="rc-typing">HQ is thinking</span>')) : ''}
      ${a.error ? `<p class="rc-warn" role="alert">${esc(a.error)}</p><div class="rc-actions"><button type="button" class="rc-btn rc-soft" data-act="agentStart">Try again</button></div>` : ''}
      ${a.done ? '<p class="rc-ok">HQ has everything it needs.</p>' : ''}
      ${chips}
      ${rec.target === 'agent' && rec.note ? `<p class="rc-warn" role="status">${esc(rec.note)}</p>` : ''}
      ${a.msgs.length && !a.done ? `<form class="rc-composer rc-agentbar" data-form="agent" data-rec="${rec.target === 'agent' ? rec.state : 'idle'}">
        <div class="rc-recbar" aria-live="polite"><i class="rc-recdot" aria-hidden="true"></i><b data-slot="rec-time">${rec.target === 'agent' && rec.state === 'rec' ? recTime() : ''}</b><span data-slot="rec-text">${rec.target === 'agent' && rec.state === 'proc' ? 'Turning your voice into text…' : 'Listening…'}</span></div>
        <label class="rc-sr" for="rc-agent">Answer HQ</label><input id="rc-agent" data-f="agent" autocomplete="off" placeholder="Say or type your answer">
        <button type="submit" class="rc-send" aria-label="Send"${agentBusy ? ' disabled' : ''}>${icon.send}</button>${micButton('agent')}</form>` : ''}</div>`;
  }
  function eventDetail() {
    const e = events().find((x) => x.id === evView.id) || event();
    if (!e) { evView = { mode: 'list' }; return eventsList(); }
    const active = e.id === event()?.id;
    const st = active ? rescueStage() : 'none';
    const primary = !active || st === 'done' ? ['restartEvent', st === 'done' ? 'Start a new rescue' : 'Start rescue'] : ['tab', st === 'count' ? 'Start rescue' : 'Open the rescue'];
    const kv = [['Venue', e.venue || 'Not set'], ['Date', niceDate(e.date) || 'Not set'], ['Food ordered', (e.items || []).map((i) => `${fmt(i.ordered)} ${lower(i.item)}`).join(', ') || 'Not set'],
      ['Good for', Number.isFinite(e.goodForMinutes) ? `${fmt(e.goodForMinutes)} minutes` : 'Not set'], ['Contact', e.contact || 'Not set'], ['Notes', e.notes || 'None']];
    return `<button type="button" class="rc-back" data-act="evList">${icon.back}All events</button>
      <div class="rc-pagehead"><h2>${esc(e.name)}</h2>${dot(...eventState(e))}</div>
      <div class="rc-cardm">${kv.map(([k, v]) => `<p class="rc-kv"><span>${k}</span><b>${esc(v)}</b></p>`).join('')}</div>
      ${active && st === 'outreach' ? '<p class="rc-hint">A rescue is live. Starting over is in Demo tools.</p>' : ''}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary rc-big" data-act="${primary[0]}" data-v="rescue" data-id="${esc(e.id)}"${dis()}>${primary[1]}</button>
      ${active ? `<button type="button" class="rc-btn rc-soft rc-big" data-act="editEvent"${dis()}>Edit details</button>` : ''}</div>
      ${active && st !== 'done' ? agentBlock() : ''}`;
  }
  function dateOptions(current) {
    const out = [];
    for (let k = 0; k < 7; k++) {
      const d = new Date(); d.setDate(d.getDate() + k);
      out.push([isoDay(d), k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })]);
    }
    if (current && !out.some(([v]) => v === current)) out.unshift([current, niceDate(current)]);
    return out;
  }
  function eventForm() {
    const d = evView.draft;
    const rows = d.items.map((row, i) => `<div class="rc-itemrow">
        <label class="rc-fld rc-grow"><span>Food</span><input data-f="draft-item" data-i="${i}" data-k="item" value="${esc(row.item)}" placeholder="Tacos" autocomplete="off"></label>
        <div class="rc-fld"><span>How many</span>${stepper('draft-item', i, 'ordered', num(row.ordered), `${row.item || 'Food'} ordered`)}</div>
        ${d.items.length > 1 ? `<button type="button" class="rc-icon rc-rm" data-act="delrow" data-i="${i}" aria-label="Remove ${esc(row.item || 'this food')}">${icon.close}</button>` : ''}</div>`).join('');
    const live = event() && evView.editing === false && rescueStage() === 'outreach';
    return `<button type="button" class="rc-back" data-act="evList">${icon.back}All events</button>
      <div class="rc-pagehead"><h2>${evView.editing ? 'Edit event' : 'Add an event'}</h2></div>
      <div class="rc-cardm rc-form">
        <label class="rc-fld"><span>Event name</span><input data-f="draft" data-k="name" value="${esc(d.name)}" placeholder="Conference lunch" autocomplete="off"></label>
        <label class="rc-fld"><span>Venue</span><input data-f="draft" data-k="venue" value="${esc(d.venue)}" placeholder="Main hall" autocomplete="off"></label>
        <div class="rc-fld"><span>Date</span>${seg('draft', 'date', dateOptions(d.date), d.date)}</div>
        <p class="rc-sub">Food ordered</p>${rows}
        <div class="rc-actions"><button type="button" class="rc-link" data-act="addrow">Add a food item</button></div>
        <div class="rc-fld"><span>Food stays good for</span>${seg('draft', 'goodForMinutes', GOOD_FOR.map((m) => [m, `${m} min`]), d.goodForMinutes)}</div>
        ${live ? '<p class="rc-hint">Saving a new event ends the rescue that is live now.</p>' : ''}
        ${evView.error ? `<p class="rc-warn" role="alert">${esc(evView.error)}</p>` : ''}
        <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="saveEvent"${dis()}>${evView.editing ? 'Save changes' : 'Save event'}</button>
        <button type="button" class="rc-btn rc-soft" data-act="evList">Cancel</button></div></div>`;
  }

  // Call: rings the coordinator's own phone and connects them to the volunteer (POST /api/volunteers/:id/connect).
  const callMsgs = new Map();
  const callBtn = (v) => `<button type="button" class="rc-btn rc-soft rc-sm" data-act="volCall" data-id="${esc(v.id)}"${dis()}>${icon.phone}<span>Call</span></button>`;
  const callNote = (v) => { const m = callMsgs.get(v.id); if (!m) return ''; return `<p class="${m.ok ? 'rc-ok' : 'rc-warn'}" role="status">${esc(m.text)}${m.needPhone ? ' <button type="button" class="rc-link" data-act="account">Add your phone number</button>' : ''}</p>`; };
  // ---- partners and volunteers tabs -------------------------------------
  const msgHtml = () => (pageMsg ? `<p class="${pageMsg.ok ? 'rc-ok' : 'rc-warn'}" role="status">${esc(pageMsg.text)}</p>` : '');
  const acceptsText = (p) => (p.accepts || []).map((a) => lower(ACCEPTS.find(([k]) => k === a)?.[1] || a)).join(', ') || 'nothing set';
  function placeForm() {
    const f = pform;
    const p = f.id ? placeById(f.id) : null;
    const phoneHint = p && phoneSet(p) ? `Ends in ${phoneLast4(p)}. Type a new number to change it.` : 'HQ calls this number. No need to type +1.';
    return `<div class="rc-cardm rc-form"><h3>${p ? `Edit ${esc(p.name)}` : 'Add a partner'}</h3>
      <label class="rc-fld"><span>Name</span><input data-f="pf" data-k="name" value="${esc(f.name)}" placeholder="Partner shelter C" autocomplete="off"></label>
      <div class="rc-fld"><span>Type</span>${seg('pf', 'type', PLACE_TYPES, f.type)}</div>
      <label class="rc-fld"><span>Phone</span><input type="tel" inputmode="tel" data-f="pf" data-k="phone" value="${esc(f.phone)}" placeholder="762 235 7374" autocomplete="off"></label><p class="rc-hint">${esc(phoneHint)}</p>
      ${p && phoneSet(p) ? '<div class="rc-actions"><button type="button" class="rc-link" data-act="placeRmPhone">Remove the number</button></div>' : ''}
      <div class="rc-two"><label class="rc-fld"><span>Distance (miles)</span><input inputmode="decimal" data-f="pf" data-k="distanceMiles" value="${esc(f.distanceMiles)}" placeholder="3"></label>
      <label class="rc-fld"><span>Can take (portions)</span><input inputmode="numeric" data-f="pf" data-k="capacity" value="${esc(f.capacity)}" placeholder="120"></label></div>
      <div class="rc-fld"><span>Accepts</span><div class="rc-toggles">${ACCEPTS.map(([k, label]) => `<button type="button" aria-pressed="${f.accepts.includes(k)}" data-act="toggleAccept" data-v="${k}">${label}</button>`).join('')}</div></div>
      <label class="rc-fld"><span>Address (optional)</span><input data-f="pf" data-k="address" value="${esc(f.address)}" placeholder="12 Main St" autocomplete="off"></label>
      ${msgHtml()}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="placeSave"${dis()}>${p ? 'Save' : 'Add partner'}</button><button type="button" class="rc-btn rc-soft" data-act="formCancel">Cancel</button></div></div>`;
  }
  function placesPage() {
    const head = `<div class="rc-pagehead rc-pagehead-end">${pform ? '' : '<button type="button" class="rc-btn rc-primary" data-act="placeNew">Add partner</button>'}</div>`;
    const rows = places().map((p) => {
      if (pform?.id === p.id) return placeForm();
      const confirming = confirmRm === `p:${p.id}`;
      const actions = confirming
        ? `<p class="rc-line">Remove ${esc(p.name)} and cancel their open jobs?</p><div class="rc-actions"><button type="button" class="rc-btn rc-danger" data-act="placeRmYes" data-id="${esc(p.id)}"${dis()}>Remove and cancel their open jobs</button><button type="button" class="rc-btn rc-soft" data-act="rmNo">Keep</button></div>`
        : `<div class="rc-actions"><button type="button" class="rc-btn rc-soft rc-sm" data-act="placeCall" data-id="${esc(p.id)}"${dis()}>${icon.phone}<span>Call</span></button><button type="button" class="rc-btn rc-soft rc-sm" data-act="placeEdit" data-id="${esc(p.id)}">Edit</button><button type="button" class="rc-btn rc-soft rc-sm" data-act="placeRm" data-id="${esc(p.id)}">Remove</button></div>`;
      const type = PLACE_TYPES.find(([k]) => k === p.type)?.[1] || p.type || '';
      return `<div class="rc-cardm rc-entity"><div class="rc-entityhead"><b>${esc(p.name)}</b>${dot(...placeStatus(p))}</div>${callNote(p)}
        <p class="rc-line">${esc(type)} · ${esc(p.distanceMiles ?? '?')} mi away · takes up to ${fmt(p.capacity)}</p>
        <p class="rc-line">Accepts ${esc(acceptsText(p))}</p>
        <p class="rc-line">${esc(phoneText(p))}</p>${p.address ? `<p class="rc-line">${esc(p.address)}</p>` : ''}${actions}</div>`;
    }).join('');
    const empty = !places().length && !pform ? '<div class="rc-empty"><p>No partners yet. Add the first place that can take food.</p></div>' : '';
    return head + (pform && !pform.id ? placeForm() : msgHtml()) + empty + `<div class="rc-list">${rows}</div>`;
  }
  function volForm() {
    const f = vform;
    const v = f.id ? volOf(f.id) : null;
    const hint = v && phoneSet(v) ? `Ends in ${phoneLast4(v)}. Type a new number to change it.` : 'HQ calls this number. No need to type +1.';
    return `<div class="rc-cardm rc-form"><h3>${v ? `Edit ${esc(v.name)}` : 'Add a volunteer'}</h3>
      <label class="rc-fld"><span>Name</span><input data-f="vf" data-k="name" value="${esc(f.name)}" placeholder="First and last name" autocomplete="off"></label>
      <label class="rc-fld"><span>Phone</span><input type="tel" inputmode="tel" data-f="vf" data-k="phone" value="${esc(f.phone)}" placeholder="762 235 7374" autocomplete="off"></label><p class="rc-hint">${esc(hint)}</p>
      ${v ? `<div class="rc-fld"><span>Can be asked to pick up food</span>${seg('vf', 'optedIn', [['true', 'Yes'], ['false', 'Not now']], String(f.optedIn))}</div>` : ''}
      ${msgHtml()}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="volSave"${dis()}>${v ? 'Save' : 'Add volunteer'}</button><button type="button" class="rc-btn rc-soft" data-act="formCancel">Cancel</button></div></div>`;
  }
  function teamPage() {
    const head = `<div class="rc-pagehead rc-pagehead-end">${vform ? '' : '<button type="button" class="rc-btn rc-primary" data-act="volNew">Add volunteer</button>'}</div>`;
    const rows = volunteers().map((v) => {
      if (vform?.id === v.id) return volForm();
      const confirming = confirmRm === `v:${v.id}`;
      const actions = confirming
        ? `<p class="rc-line">Remove ${esc(v.name)} and cancel their open jobs?</p><div class="rc-actions"><button type="button" class="rc-btn rc-danger" data-act="volRmYes" data-id="${esc(v.id)}"${dis()}>Remove and cancel their open jobs</button><button type="button" class="rc-btn rc-soft" data-act="rmNo">Keep</button></div>`
        : `<div class="rc-actions">${callBtn(v)}<button type="button" class="rc-btn rc-soft rc-sm" data-act="volEdit" data-id="${esc(v.id)}">Edit</button><button type="button" class="rc-btn rc-soft rc-sm" data-act="volRm" data-id="${esc(v.id)}">Remove</button></div>`;
      return `<div class="rc-cardm rc-entity"><div class="rc-entityhead">${avatar(v.name)}<b class="rc-grow">${esc(v.name)}</b>${dot(...volStatus(v))}</div>
        <p class="rc-line">${esc(phoneText(v))}</p>${actions}${callNote(v)}</div>`;
    }).join('');
    const empty = !volunteers().length && !vform ? '<div class="rc-empty"><p>No volunteers yet. Add the first person HQ can call.</p></div>' : '';
    return head + (vform && !vform.id ? volForm() : msgHtml()) + empty + `<div class="rc-list">${rows}</div>`;
  }
  function pageHtml() {
    if (!state) return '<p class="rc-line">Getting the latest from HQ.</p>';
    if (tab === 'events') return evView.mode === 'form' ? eventForm() : evView.mode === 'detail' ? eventDetail() : eventsList();
    if (tab === 'places') return placesPage();
    if (tab === 'team') return teamPage();
    return '';
  }

  // ---- status and account -----------------------------------------------------
  function statusHtml() {
    const r = remaining();
    const urg = urgency();
    const st = state ? rescueStage() : 'none';
    let title; let lead;
    if (!event()) { title = 'Ready when you are'; lead = 'Pick an event, then take a photo of what is left.'; }
    else if (!report()) { title = event().name; lead = 'Waiting to hear what is left.'; }
    else if (st === 'ready') { title = `About ${foodLine(report().items)}`; lead = 'Partners have not been alerted yet.'; }
    else if (r.need === 0 && r.onWay === 0) { title = r.left === 0 ? 'Nothing was left over' : 'Everything is delivered'; lead = `${fmt(r.rescued)} portions found a home.`; }
    else if (urg === 'ended' || urg === 'closed') { title = `${fmt(r.need)} portions did not get a home`; lead = endReason(); }
    else { title = `${fmt(r.need + r.onWay)} portions on the move`; lead = `Now ${lotActivity(lots())}. ${fmt(r.onWay)} on the way, ${fmt(r.rescued)} delivered.`; }
    const segc = (n, color) => `<i style="flex:${n};background:${color}"></i>`;
    const bar = report() ? `<div class="rc-segs" role="img" aria-label="${fmt(r.rescued)} rescued, ${fmt(r.onWay)} on the way, ${fmt(r.need)} unclaimed">${segc(r.rescued, 'var(--green)')}${segc(r.onWay, 'var(--purple)')}${segc(r.need, 'var(--orange)')}</div>` : `<div class="rc-segs" aria-hidden="true">${segc(1, 'var(--track)')}</div>`;
    const inc = incident();
    const sub = urg === 'done' ? 'all rescued' : urg === 'ended' ? 'time ran out' : urg === 'closed' ? 'rescue ended' : urg === 'idle' ? 'no rescue yet' : `left · safe till ${clock(inc?.deadline)}`;
    const legendDot = (c) => `<i style="background:${c}"></i>`;
    const list = (items, fn) => (items.length ? `<ul class="rc-people">${items.map(fn).join('')}</ul>` : '<p class="rc-line">None yet.</p>');
    return `<div class="rc-card"><div class="rc-ringbox">${ring(150, 16)}<span class="rc-ring-mid"><b data-t="timer">${timerText()}</b><small>${esc(sub)}</small></span></div>
      <h3>${esc(title)}</h3><p class="rc-lead">${esc(lead)}</p>${bar}
      <div class="rc-legend"><span>${legendDot('var(--green)')}${fmt(r.rescued)} rescued</span><span>${legendDot('var(--purple)')}${fmt(r.onWay)} on the way</span><span>${legendDot('var(--orange)')}${fmt(r.need)} unclaimed</span></div></div>
      <p class="rc-label">Partners</p>${list(places(), (p) => `<li><span class="rc-grow">${esc(p.name)}</span>${dot(...placeStatus(p))}</li>`)}
      <p class="rc-label">Volunteers</p>${list(volunteers(), (v) => `<li>${avatar(v.name)}<span class="rc-grow">${esc(v.name)}</span>${dot(...volStatus(v))}${callBtn(v)}</li>${callNote(v) ? `<li>${callNote(v)}</li>` : ''}`)}
      ${cancelRescueHtml()}`;
  }
  // The rescue can be cancelled once something has been counted and it is not over yet.
  function cancelRescueHtml() {
    if (!report() || rescueStage() === 'done') return '';
    if (confirmRm === 'rescue') {
      return `<div class="rc-actions rc-cancelrescue"><p class="rc-line">Cancel this rescue? Every open job stops and the event is kept.</p><button type="button" class="rc-btn rc-danger" data-act="rescueCancelYes"${dis()}>Yes, cancel the rescue</button><button type="button" class="rc-btn rc-soft" data-act="rmNo">Keep going</button></div>`;
    }
    return `<div class="rc-actions rc-cancelrescue"><button type="button" class="rc-link" data-act="rescueCancel">Cancel this rescue</button></div>`;
  }
  function simulateRows() {
    const b = (act, label, offerId) => `<button type="button" class="rc-btn rc-soft rc-sm" data-act="${act}" data-id="${esc(offerId)}"${dis()}>${label}</button>`;
    // Stage 1: a partner answering its call.
    const placeRows = lots().filter((l) => l.stage === 'calling_places').flatMap((l) => (l.places || []).filter((p) => p.status === 'calling' && p.offerId).map((p) =>
      `<div class="rc-simrow"><p><b>${esc(p.name)}</b> · ${fmt(l.portions)} ${esc(lower(l.item))}</p><div class="rc-actions">${b('simAccept', 'Says yes', p.offerId)}${b('simDecline', 'Says no', p.offerId)}</div></div>`));
    // Demo path (POST /api/demo/simulate): works even when nobody has a phone. Never places a call.
    const demoNext = { proposed: ['place_yes', 'Partner says yes'], calling_places: ['place_yes', 'Partner says yes'], waiting_volunteer: ['volunteer_accept', 'A volunteer takes it'], calling_volunteer: ['volunteer_accept', 'Volunteer accepts'], on_the_way: ['delivered', 'Delivered'] };
    const demoRows = (state?.lots || []).filter((l) => demoNext[l.status]).map((l) => `<div class="rc-simrow"><p><b>Demo</b> · ${fmt(l.portions)} ${esc(lower(l.item))} · ${esc(l.label || l.status)}</p><div class="rc-actions"><button type="button" class="rc-btn rc-soft rc-sm" data-act="simDemo" data-id="${esc(l.id)}" data-v="${demoNext[l.status][0]}"${dis()}>${demoNext[l.status][1]} (demo, no call)</button></div></div>`);
    placeRows.push(...demoRows);
    const open = lots().filter((l) => l.offerId && ['calling_volunteer', 'on_the_way'].includes(l.stage));
    if (!open.length && !placeRows.length) return '<p class="rc-line">Nothing to simulate yet. Start a rescue and alert partners first.</p>';
    return placeRows.join('') + open.map((l) => {
      const o = offers().find((x) => x.id === l.offerId) || {};
      const v = volOf(l.volunteerId);
      const b = (act, label) => `<button type="button" class="rc-btn rc-soft rc-sm" data-act="${act}" data-id="${esc(l.offerId)}"${dis()}>${label}</button>`;
      const btns = o.status === 'offered' ? b('simAccept', 'Accept') + b('simDecline', 'Decline')
        : o.status === 'accepted' ? b('simPickup', 'Picked up') + b('simDelivered', 'Delivered')
          : o.status === 'picked_up' ? b('simDelivered', 'Delivered') : '';
      return `<div class="rc-simrow"><p><b>${esc(v ? v.name : 'Volunteer')}</b> · ${fmt(l.portions)} ${esc(lower(l.item))} to ${esc(placeById(l.placeId)?.name || 'a partner')}</p><div class="rc-actions">${btns || '<span class="rc-hint">Nothing to reply to.</span>'}</div></div>`;
    }).join('');
  }
  function accountHtml() {
    const keys = [['Ctrl or Cmd + 1 to 4', 'Switch tabs'], ['Ctrl or Cmd + /', 'Show or hide the sidebar'], ['Ctrl or Cmd + \\', 'Show or hide rescue status'], ['M', 'Start or stop the mic'], ['P', 'Take a photo'], ['Esc', 'Close this panel'], ['?', 'Open shortcuts']];
    const st0 = state?.settings || {};
    const mine = `<div class="rc-section"><h3>Your phone number</h3><p class="rc-hint">${st0.coordinatorPhoneSet ? `Saved, ends in ${esc(st0.coordinatorPhoneLast4 || '')}. Type a new number to change it.` : 'HQ rings this number when you tap Call, then connects you to the volunteer.'}</p>
      <label class="rc-fld"><span>Phone</span><input type="tel" inputmode="tel" data-f="myphone" placeholder="762 235 7374" autocomplete="off"></label>
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary rc-sm" data-act="saveMyPhone"${dis()}>Save</button></div></div>`;
    return mine + `<div class="rc-section"><h3>Demo tools</h3><p class="rc-demo-note">Demo only. These change sample data so you can try the app without real calls.</p>
      ${msgHtml()}
      <div class="rc-demo-grid">
        <button type="button" class="rc-btn rc-soft" data-act="sample"${dis()}>Load a sample event</button>
        <button type="button" class="rc-btn rc-soft" data-act="ff"${busy || !isActiveInc() ? ' disabled' : ''}>Fast-forward 1 minute</button>
        <button type="button" class="rc-btn rc-soft" data-act="reset"${dis()}>Reset this rescue</button>
        ${confirmRm === 'all' ? `<button type="button" class="rc-btn rc-danger" data-act="resetAllYes"${dis()}>Yes, reset everything</button>` : '<button type="button" class="rc-btn rc-soft" data-act="resetAll">Reset everything</button>'}
      </div>
      ${confirmRm === 'all' ? '<p class="rc-hint">This puts back the sample partners and volunteers and removes yours.</p>' : ''}
      <h4>Simulate reply</h4><p class="rc-hint">Stand in for a partner or volunteer answering their call.</p>${simulateRows()}
      ${volunteers().length ? `<h4>Volunteer pages</h4><div class="rc-actions">${volunteers().map((v) => `<a class="rc-link" href="/v/${encodeURIComponent(v.id)}" target="_blank" rel="noopener">${esc(firstName(v.name))}</a>`).join('')}</div>` : ''}</div>
      <div class="rc-section rc-keys"><h3>Keyboard shortcuts</h3>${keys.map(([k, d]) => `<p class="rc-kv"><span>${esc(d)}</span><b><kbd>${esc(k)}</kbd></b></p>`).join('')}</div>`;
  }

  // ---- render -----------------------------------------------------------------
  function syncEvent() {
    const e = event();
    if (!state || (e?.id || null) === ui.eventId) return;
    const carry = alerting || carryTalk ? { count: ui.count, talk: ui.talk } : {};
    const sample = ui.pendingSample;
    ui = { ...freshUi(), eventId: e?.id || null, ...carry, sample: Boolean(sample) };
    if (!alerting) photos = [];
    saveUi();
  }
  const started = () => Boolean(state && report() && ['ready', 'outreach', 'done'].includes(rescueStage()));
  const showStatusCol = () => statusOpen && started() && (tab === 'rescue' || live());
  function render() {
    if (disposed) return;
    syncEvent();
    app.setAttribute('aria-busy', state ? 'false' : 'true');
    app.dataset.tab = tab;
    app.dataset.nav = navOpen ? 'full' : 'mini';
    app.dataset.status = showStatusCol() ? 'on' : 'off';
    slot('showstatus').hidden = !(wide() && started() && !statusOpen && (tab === 'rescue' || live()));
    root.querySelectorAll('.rc-tabbtn').forEach((b) => { if (b.dataset.v === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    root.querySelector('.rc-nav-toggle').setAttribute('aria-label', navOpen ? 'Collapse sidebar' : 'Expand sidebar');
    slot('livedot').hidden = !live();
    slot('title').textContent = NAV.find(([id]) => id === tab)[1];
    root.querySelector('[data-pane="rescue"]').hidden = tab !== 'rescue';
    slot('page').hidden = tab === 'rescue';
    const st = state ? rescueStage() : 'none';
    const e = event();
    // Slim bar only once a rescue has started. When it ends: "Done · 100 rescued" for a moment, then the summary card alone.
    if (st === 'done' && lastStage && lastStage !== 'done') { doneUntil = Date.now() + 6000; setTimeout(() => render(), 6100); }
    lastStage = st;
    const showPin = st === 'ready' || st === 'outreach' || (st === 'done' && Date.now() < doneUntil);
    pin.hidden = !showPin;
    slot('pin-sub').textContent = st === 'ready' ? 'Ready to alert partners' : st === 'outreach' ? shortActivity() : `${fmt(remaining().rescued)} rescued`;
    slot('sample').hidden = !(ui.sample && e);
    if (tab === 'rescue') { renderThread(); renderComposer(); } else setHtml(slot('page'), pageHtml());
    setHtml(slot('status-desk'), statusHtml());
    if (sheetView === 'status' && wide()) { sheetView = null; }
    sheet.hidden = !sheetView;
    scrim.hidden = !sheetView;
    sheet.dataset.kind = sheetView || '';
    if (sheetView) { slot('sheet-title').textContent = sheetView === 'status' ? 'Rescue status' : 'Account'; setHtml(slot('sheet'), sheetView === 'status' ? statusHtml() : accountHtml()); }
    pin.setAttribute('aria-expanded', String(sheetView === 'status' || (wide() && showStatusCol())));
    root.querySelector('.rc-account').setAttribute('aria-expanded', String(sheetView === 'account'));
    tick();
  }

  function tick() {
    if (disposed) return;
    const urg = urgency();
    app.dataset.urg = urg;
    slot('chip').textContent = CHIP[urg];
    if (lastUrg !== null && lastUrg !== urg && state) { lastUrg = urg; render(); return; }
    lastUrg = urg;
    const text = timerText();
    const fraction = urg === 'done' ? 1 : urg === 'ended' || urg === 'closed' || urg === 'idle' ? 0 : secondsLeft() / windowSeconds();
    root.querySelectorAll('[data-t="timer"]').forEach((el) => { el.textContent = text; });
    root.querySelectorAll('[data-t="ring"]').forEach((el) => el.setAttribute('stroke-dashoffset', (RING_C * (1 - Math.min(1, fraction))).toFixed(2)));
    const recent = lastSuccess && Date.now() - lastSuccess < 10000;
    slot('live').textContent = streamConnected ? 'Live' : recent ? 'Connected' : lastSuccess ? 'Reconnecting' : 'Connecting to HQ';
    root.querySelector('.rc-live').classList.toggle('on', Boolean(streamConnected || recent));
  }
  function showError(message) {
    slot('error').textContent = message;
    root.querySelector('.rc-error').hidden = !message;
  }
  function applyState(next) {
    if (disposed) return;
    if (!next || !Array.isArray(next.volunteers) || !Array.isArray(next.feed)) throw new Error('HQ returned an unexpected response. Please retry.');
    state = { ...next, offers: next.offers || [], places: next.places || [], summary: next.summary || {} };
    revision++;
    lastSuccess = Date.now();
    render();
  }

  // ---- network -----------------------------------------------------------------
  async function call(method, path, body) {
    const slow = path === '/api/estimate' ? 45000 : path.startsWith('/api/agent/') || path.startsWith('/api/outreach') ? 30000 : 12000;
    const res = await fetch(apiBase + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: AbortSignal.any([AbortSignal.timeout(slow), lifecycle.signal]),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, data, missing: res.status === 404 && (!data || data.error === MISSING) };
  }
  const netMessage = (error) => (error.name === 'TimeoutError' || error instanceof TypeError ? 'Could not reach HQ. Check your connection and try again.' : error.message);
  const failMessage = (res, missingText) => (res.missing ? missingText : typeof res.data?.error === 'string' ? res.data.error : `That did not work (${res.status}). Please try again.`);
  async function readState() {
    if (readPending || busy || disposed) return;
    readPending = true;
    const start = revision;
    try {
      const res = await call('GET', '/api/state');
      if (!res.ok) throw new Error(`Could not load HQ updates (${res.status}).`);
      if (start === revision && !busy) applyState(res.data);
      lastSuccess = Date.now();
      showError('');
    } catch (error) {
      if (!disposed && !streamConnected) showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Unable to reach HQ. Check your connection and retry.' : error.message);
    } finally { readPending = false; }
  }
  // Runs an action against the API. Returns {ok, data, message, missing}.
  async function act(method, path, body, { quiet, missing = 'HQ cannot do that on this server yet.' } = {}) {
    if (busy || disposed) return { ok: false, message: 'HQ is still working on the last step. Try again in a moment.' };
    busy = true;
    revision++;
    render();
    if (!quiet) showError('');
    try {
      const res = await call(method, path, body);
      if (!res.ok) {
        const msg = failMessage(res, missing);
        if (!quiet) showError(msg);
        return { ok: false, data: res.data, message: msg, missing: res.missing };
      }
      busy = false;
      if (res.data && Array.isArray(res.data.volunteers)) applyState(res.data);
      else if (res.data?.snapshot && Array.isArray(res.data.snapshot.volunteers)) applyState(res.data.snapshot);
      else setTimeout(readState, 0);
      return { ok: true, data: res.data };
    } catch (error) {
      const msg = netMessage(error);
      if (!quiet) showError(msg);
      return { ok: false, message: msg };
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }
  const scrollThread = () => { const t = slot('thread'); t.scrollTop = t.scrollHeight; };

  // ---- rescue actions ----------------------------------------------------------
  async function alertPartners() {
    if (alerting || busy) return;
    const st = rescueStage();
    alerting = true;
    render();
    try {
      if (st === 'none' || st === 'count') {
        const c = ui.count;
        if (!c || !foodLine(c.items)) { say('hq', 'Tell me how much is left first, or take a photo.'); return; }
        if (!event()) {
          const venue = c.venue || 'Event venue';
          const r = await act('POST', '/api/event', { name: c.eventName || `Leftovers at ${venue}`, venue, date: todayIso(), goodForMinutes: c.goodForMinutes || 45,
            items: c.items.filter((i) => num(i.ordered ?? i.left) > 0).map((i) => ({ item: i.item, ordered: num(i.ordered ?? i.left) })) });
          if (!r.ok) return;
        } else if ((c.eventName && c.eventName !== event().name) || (c.venue && c.venue !== event().venue)) {
          const r = await act('PATCH', '/api/event', { name: c.eventName || event().name, venue: c.venue || event().venue }, { quiet: true });
          if (!r.ok && !r.missing) return;
        }
        const rows = c.items.map((i) => ({ item: i.item, left: num(i.left), unit: i.unit || 'portions', source: c.source === 'voice' ? 'manual' : c.source || 'manual', ...(i.confidence ? { confidence: i.confidence } : {}) }));
        for (const it of event()?.items || []) if (!rows.some((x) => lower(x.item) === lower(it.item))) rows.push({ item: it.item, left: 0, unit: 'portions', source: rows[0]?.source || 'manual' });
        const r = await act('POST', '/api/report', { items: rows });
        if (!r.ok) return;
        ui.count = null; ui.editing = false; photos = [];
      }
      const r = await act('POST', '/api/outreach/places', {}, { quiet: true });
      if (!r.ok && r.missing) {
        say('hq', 'Calling partners is not on this server yet, so I sent the offers straight to volunteers.');
        const s = await act('POST', '/api/offers/send', {});
        if (!s.ok) say('hq', s.message || 'The offers did not go out. Try again.');
      } else if (!r.ok) {
        say('hq', r.message || 'I could not start calling partners. Try again.');
      }
    } finally {
      alerting = false;
      saveUi();
      render();
      scrollThread();
    }
  }
  async function estimate() {
    if (!event()) return;
    estimating = true;
    ui.estMessage = '';
    render();
    let res;
    try { res = await call('POST', '/api/estimate', { images: photos, items: event().items }); } catch { res = { ok: false, data: null }; }
    estimating = false;
    const d = res.data || {};
    if (!res.ok || d.unreadable || !Array.isArray(d.items) || !d.items.length) {
      ui.estMessage = res.missing ? 'Photo counts are not available on this server. Count by hand instead.'
        : (typeof d.error === 'string' && d.error) || d.message || 'I could not read the photo. Try another one, or count by hand.';
    } else {
      const items = d.items.map((i) => ({ item: i.item, left: num(i.count), unit: i.unit || 'portions', confidence: String(i.confidence || '') }));
      for (const it of event().items || []) if (!items.some((x) => lower(x.item) === lower(it.item))) items.push({ item: it.item, left: 0, unit: 'portions' });
      const low = items.filter((i) => /low/i.test(i.confidence)).map((i) => lower(i.item));
      ui.count = { source: 'photo', items, confidenceNote: low.length ? `Not sure about ${listWords(low)}. Check with Edit amounts.` : '' };
      ui.editing = false;
    }
    saveUi();
    render();
    scrollThread();
  }
  async function addPhotos(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS);
    if (!list.length) return;
    store.set('rc-cam-used', '1');
    photos = [];
    for (const file of list) { try { photos.push(await shrink(file)); } catch { ui.estMessage = 'That photo could not be opened. Try another one.'; } }
    if (photos.length) await estimate(); else render();
  }
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  function ask(kind) { ui.talk = [...ui.talk, { ask: kind, at: Date.now() }].slice(-30); saveUi(); render(); scrollThread(); }

  // Before a rescue starts: one sentence starts it (POST /api/quick: event, count, then partners are called).
  async function quickStart(text) {
    say('me', text);
    render(); scrollThread();
    carryTalk = true;
    // Preview only: nothing is created until the user taps Yes, alert partners.
    const r = await act('POST', '/api/quick', { text, preview: true }, { quiet: true });
    carryTalk = false;
    if (r.ok && r.data?.quick?.preview) {
      const u = r.data.quick.understood || {};
      const items = (Array.isArray(u.items) ? u.items : []).map((i) => ({ item: lower(i.item), left: num(i.left), unit: i.unit || 'portions', ...(Number.isFinite(Number(i.ordered)) && num(i.ordered) > 0 ? { ordered: num(i.ordered) } : {}) }));
      for (const it of event()?.items || []) if (!items.some((x) => lower(x.item) === lower(it.item))) items.push({ item: it.item, left: 0, unit: 'portions' });
      ui.count = { source: 'voice', items, venue: event() ? event().venue || '' : u.venue || '', goodForMinutes: event() ? null : r.data.quick.goodForMinutes || null, eventName: event() ? event().name || '' : u.eventName || '' };
      ui.editing = false; photos = [];
      say('hq', `Got it: about ${foodLine(items) || 'your leftovers'}${u.venue && !event() ? ` at ${u.venue}` : ''}. Tap Yes, alert partners to start calling.`);
    } else if (r.ok) {
      ui.count = null; ui.editing = false; photos = [];
    } else if (r.missing) {
      // Older server: understand it here and ask for a yes before anything is sent.
      const p = parseSpoken(text);
      if (p.items.length) { ui.count = { source: 'voice', items: p.items, venue: p.venue, goodForMinutes: p.goodForMinutes, eventName: p.eventName }; ui.editing = false; }
      else say('hq', 'I did not catch any food and amounts. Try “100 tacos and 10 sandwiches”, or take a photo.');
    } else say('hq', r.message || 'That did not work. Try again, or take a photo.');
    saveUi(); render(); scrollThread();
  }
  // Everything said or typed in the message bar comes here. What was heard shows as a "You" bubble first.
  async function handleSaid(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    const t = lower(text);
    const st = rescueStage();
    const pendingCount = (st === 'none' || st === 'count') && ui.count;
    if (/^(yes|yeah|yep|yup|sure|send it|alert|do it|go ahead|confirm|ok(ay)?)\b/.test(t) && (st === 'ready' || pendingCount)) { say('me', text); render(); return alertPartners(); }
    if (/who'?s free|who is free/.test(t)) return ask('free');
    if (/what'?s left|what is left/.test(t)) return ask('left');
    const fix = t.match(/\b(?:make it|change it to|change to|set it to|actually)\s+(\d+)\s+([a-z][a-z ]*)/);
    if (fix && pendingCount) {
      say('me', text);
      const word = fix[2].trim().replace(/s$/, '');
      const hit = ui.count.items.find((i) => lower(i.item).replace(/s$/, '').startsWith(word) || word.startsWith(lower(i.item).replace(/s$/, '')));
      if (hit) { hit.left = Number(fix[1]); say('hq', `Changed to ${fmt(hit.left)} ${lower(hit.item)}.`); } else say('hq', `I could not find ${fix[2]} in the list. Use Edit amounts.`);
      render(); scrollThread(); return;
    }
    if (!event() && !pendingCount) {
      // The event comes first. Amounts said before an event still create the event from what we can parse.
      const p = parseSpoken(text);
      const at = text.match(/^(.*?)\s+at\s+(.+)$/i);
      const name = p.eventName || (p.items.length ? '' : at ? at[1].trim() : text) || `Leftovers at ${p.venue || (at ? at[2].trim() : 'the venue')}`;
      const venue = p.venue || (at ? at[2].trim() : '') || '';
      say('me', text); render(); scrollThread();
      const r = await act('POST', '/api/event', { name, venue, date: todayIso(), items: [] }, { quiet: true });
      if (!r.ok) { say('hq', r.message || 'I could not save the event. Try again.'); render(); return; }
      if (p.items.length) { ui.count = { source: 'voice', items: p.items, venue, goodForMinutes: p.goodForMinutes, eventName: name }; ui.editing = false; saveUi(); render(); scrollThread(); return; }
      say('hq', `Got it: ${name}${venue ? ` at ${venue}` : ''}. Now what’s left? Take a photo or say the amounts.`); render(); scrollThread(); return;
    }
    if (st === 'none' || st === 'count') return quickStart(text);
    if (st === 'ready') { say('me', text); say('hq', 'Say “yes” or tap Yes, alert partners to start calling.'); render(); scrollThread(); return; }
    const r = await act('POST', '/api/updates', { text });
    if (!r.ok) { say('me', text); say('hq', r.message || 'That update did not go out. Try again.'); render(); }
    scrollThread();
  }
  // Tap once to record, tap again to stop. The audio goes to /api/transcribe and the text is sent like a typed message.
  function recNote(target, text) { rec.target = target; rec.note = text; render(); }
  async function toggleRecord(target) {
    if (rec.state === 'rec') { stopRecord(); return; }
    if (rec.state === 'proc') return;
    if (!canRecord()) { recNote(target, 'Voice notes do not work in this browser. Type your message instead.'); return; }
    rec.target = target; rec.note = '';
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
      recNote(target, e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'The microphone is blocked. Allow it in your browser settings, or type instead.'
        : e?.name === 'NotFoundError' ? 'No microphone was found. Type your message instead.' : 'The microphone could not start. Type your message instead.');
      return;
    }
    const mime = pickMime();
    let mr;
    try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch {
      stream.getTracks().forEach((t) => t.stop());
      recNote(target, 'Recording could not start on this phone. Type your message instead.');
      return;
    }
    rec = { state: 'rec', target, mr, stream, chunks: [], started: Date.now(), preview: null, previewText: '', timer: setInterval(updateRecBar, 250), note: '' };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    mr.onstop = () => { finishRecord(); };
    mr.start(250);
    // Live words on screen where the browser can do it without fighting over the mic (not on phones).
    if (Speech && !window.matchMedia('(pointer: coarse)').matches) {
      try {
        const sr = new Speech(); sr.lang = 'en-US'; sr.interimResults = true; sr.continuous = true;
        sr.onresult = (e) => { rec.previewText = Array.from(e.results).map((x) => x[0].transcript).join('').trim(); updateRecBar(); };
        sr.onerror = () => {};
        sr.start(); rec.preview = sr;
      } catch { /* preview is optional */ }
    }
    render();
    updateRecBar();
  }
  function stopRecord() { try { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); else finishRecord(); } catch { finishRecord(); } }
  async function finishRecord() {
    if (rec.state !== 'rec') return;
    clearInterval(rec.timer);
    rec.stream?.getTracks().forEach((t) => t.stop());
    try { rec.preview?.stop(); } catch { /* ok */ }
    const type = rec.mr?.mimeType || rec.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(rec.chunks, { type });
    const { target, previewText } = rec;
    const ms = Date.now() - rec.started;
    rec = { ...rec, state: 'proc', mr: null, stream: null, preview: null, timer: null };
    render();
    let text = '';
    let note = '';
    if (ms < 600 || blob.size < 200) note = 'That was too short. Tap the mic, talk, then tap it again to send.';
    else {
      try {
        const fd = new FormData();
        const ext = /mp4|aac|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
        fd.append('audio', blob, `voice.${ext}`);
        const res = await fetch(`${apiBase}/api/transcribe`, { method: 'POST', body: fd, signal: AbortSignal.any([AbortSignal.timeout(45000), lifecycle.signal]) });
        let data = null;
        try { data = await res.json(); } catch { /* not JSON */ }
        if (res.ok && typeof data?.text === 'string' && data.text.trim()) text = data.text.trim();
        else if (res.ok) { text = previewText; if (!text) note = (typeof data?.message === 'string' && data.message) || 'I could not hear that. Try again, or type it.'; }
        else if (res.status === 404 && (!data || data.error === MISSING)) { text = previewText; if (!text) note = 'Voice notes are not on this server yet. Type your message instead.'; }
        else note = (typeof data?.error === 'string' && data.error) || (typeof data?.message === 'string' && data.message) || 'I could not turn that into text. Try again, or type it.';
      } catch { text = previewText; if (!text) note = 'Could not reach HQ with your voice note. Try again, or type it.'; }
      if (!text && !note) note = 'I did not catch any words. Try again a little closer to the phone.';
    }
    rec = { ...rec, state: 'idle', note };
    render();
    if (!text) return;
    if (target === 'agent') { await agentSend(text); return; }
    await handleSaid(text); // shows as a "You" bubble, then goes where a typed message would
  }

  // ---- events / agent actions -------------------------------------------------
  async function saveEvent() {
    const d = evView.draft;
    const items = d.items.filter((i) => String(i.item).trim()).map((i) => ({ item: String(i.item).trim(), ordered: num(i.ordered) }));
    if (!String(d.name).trim()) { evView.error = 'Give the event a name.'; return render(); }
    if (!String(d.venue).trim()) { evView.error = 'Add the venue.'; return render(); }
    if (!items.length || items.some((i) => i.ordered < 1)) { evView.error = 'Add at least one food item with how many were ordered.'; return render(); }
    evView.error = '';
    const body = { name: String(d.name).trim(), venue: String(d.venue).trim(), date: d.date, items, goodForMinutes: Number(d.goodForMinutes) || 45 };
    const r = await act(evView.editing ? 'PATCH' : 'POST', '/api/event', body, { quiet: true });
    if (!r.ok) { evView.error = r.message; return render(); }
    evView = { mode: 'detail', id: event()?.id };
    render();
  }
  async function agentSend(message) {
    if (agentBusy || !event()) return;
    const a = ui.agent;
    const text = String(message || '').trim();
    const history = a.msgs.map((m) => ({ role: m.role, text: m.text }));
    if (text) a.msgs.push({ role: 'user', text });
    agentBusy = true; a.error = ''; a.chips = [];
    render();
    try {
      const res = await call('POST', '/api/agent/message', { message: text, history });
      if (!res.ok) throw new Error(failMessage(res, 'HQ’s questions are not available on this server yet. Use Edit details instead.'));
      const d = res.data || {};
      if (d.reply) a.msgs.push({ role: 'assistant', text: String(d.reply) });
      a.chips = Array.isArray(d.chips) ? d.chips.map(String).filter(Boolean).slice(0, 3) : [];
      if (d.snapshot && Array.isArray(d.snapshot.volunteers)) { state = { ...state, ...d.snapshot }; revision++; }
      if (d.done === true) { a.done = true; a.chips = []; }
    } catch (error) {
      if (text && a.msgs[a.msgs.length - 1]?.text === text) a.msgs.pop();
      a.error = error.message && !(error instanceof TypeError) && error.name !== 'TimeoutError' ? error.message : 'Could not reach HQ. Check your connection and try again.';
    } finally { agentBusy = false; saveUi(); render(); }
  }

  // ---- partner / volunteer actions ---------------------------------------
  const note = (text, ok) => { pageMsg = { text, ok }; };
  async function pageAct(method, path, body, missing, done) {
    const r = await act(method, path, body, { quiet: true, missing });
    note(r.ok ? done : r.message || 'That did not work. Please try again.', r.ok);
    render();
    return r.ok;
  }
  // Read the form fields straight from the page, so a value typed just before Save is never lost.
  const syncForm = (scope, target) => { if (target) root.querySelectorAll(`input[data-f="${scope}"]`).forEach((el) => { target[el.dataset.k] = el.value; }); };
  async function savePlace() {
    syncForm('pf', pform);
    const f = pform;
    const name = String(f.name || '').trim();
    const distanceMiles = Number(f.distanceMiles);
    const capacity = Number(f.capacity);
    const err = !name ? 'Add a name.' : String(f.distanceMiles).trim() === '' || !Number.isFinite(distanceMiles) || distanceMiles < 0 ? 'Enter the distance in miles, for example 3.'
      : !Number.isInteger(capacity) || capacity < 1 ? 'Enter how many portions they can take, for example 120.' : !f.accepts.length ? 'Pick at least one kind of food they accept.'
        : String(f.phone || '').trim() && !phoneOk(f.phone) ? PHONE_HELP : '';
    if (err) { note(err, false); return render(); }
    const body = { name, type: f.type, distanceMiles, capacity, accepts: [...f.accepts] };
    if (String(f.address || '').trim() || f.id) body.address = String(f.address || '').trim();
    if (String(f.phone || '').trim()) body.phone = String(f.phone).trim();
    const ok = f.id
      ? await pageAct('PATCH', `/api/places/${encodeURIComponent(f.id)}`, body, 'This server cannot edit partners yet.', `Saved ${name}.`)
      : await pageAct('POST', '/api/places', body, 'This server cannot add partners yet.', `Added ${name}.`);
    if (ok) { pform = null; render(); }
  }
  async function saveVolunteer() {
    syncForm('vf', vform);
    const f = vform;
    const name = String(f.name || '').trim();
    if (!name) { note('Add a name.', false); return render(); }
    const body = { name };
    if (String(f.phone || '').trim()) { if (!phoneOk(f.phone)) { note(PHONE_HELP, false); return render(); } body.phone = String(f.phone).trim(); }
    if (f.id) body.optedIn = String(f.optedIn) !== 'false';
    const ok = f.id
      ? await pageAct('PATCH', `/api/volunteers/${encodeURIComponent(f.id)}`, body, 'This server cannot edit volunteers yet.', `Saved ${name}.`)
      : await pageAct('POST', '/api/volunteers', body, 'This server cannot add volunteers yet.', `Added ${name}.`);
    if (ok) { vform = null; render(); }
  }

  function setTab(next) {
    if (!NAV.some(([id]) => id === next)) return;
    tab = next;
    store.set('rc-tab', tab);
    pform = null; vform = null; confirmRm = null; pageMsg = null;
    if (next === 'events' && evView.mode === 'form' && !evView.draft) evView = { mode: 'list' };
    if (sheetView === 'status') sheetView = null;
    render();
    if (tab === 'rescue') scrollThread();
  }
  function closeSheet() { sheetView = null; confirmRm = confirmRm === 'all' ? null : confirmRm; render(); }

  // ---- event wiring ------------------------------------------------------------
  const onField = (ev) => {
    const t = ev.target;
    const f = t.dataset?.f;
    if (t === input) { composer.dataset.text = input.value.trim() ? '1' : ''; return; }
    if (f === 'agent') { if (t.form) t.form.dataset.text = t.value.trim() ? '1' : ''; return; }
    if (!f) return;
    const i = Number(t.dataset.i);
    if (f === 'draft' && evView.draft) evView.draft[t.dataset.k] = t.value;
    else if (f === 'draft-item' && evView.draft) evView.draft.items[i][t.dataset.k] = t.dataset.k === 'ordered' ? num(t.value) : t.value;
    else if (f === 'count' && ui.count) { ui.count.items[i].left = num(t.value); saveUi(); }
    else if (f === 'cf' && ui.count) { ui.count[t.dataset.k] = t.value; saveUi(); }
    else if (f === 'pf' && pform) pform[t.dataset.k] = t.value;
    else if (f === 'vf' && vform) vform[t.dataset.k] = t.value;
  };
  root.addEventListener('input', onField, { signal: lifecycle.signal });
  root.addEventListener('focusout', (ev) => { if (ev.relatedTarget?.closest?.('[data-act]')) return; if (deferred) setTimeout(() => { if (!disposed && !typing(document.activeElement)) { deferred = false; render(); } }, 50); }, { signal: lifecycle.signal });

  root.addEventListener('click', async (ev) => {
    const button = ev.target.closest('[data-act], [data-ask]');
    if (!button || button.disabled) return;
    if (button.tagName === 'A') return;
    const a = button.dataset.act;
    const id = button.dataset.id;
    const i = Number(button.dataset.i);
    if (button.dataset.ask) { if (sheetView) sheetView = null; return ask(button.dataset.ask); }
    switch (a) {
      case 'tab': setTab(button.dataset.v); break;
      case 'toggleNav': navOpen = !navOpen; store.set('rc-nav', navOpen ? '1' : '0'); render(); break;
      case 'toggleStatus': statusOpen = !statusOpen; store.set('rc-status', statusOpen ? '1' : '0'); render(); break;
      case 'pin': if (wide()) { statusOpen = !statusOpen; store.set('rc-status', statusOpen ? '1' : '0'); } else sheetView = sheetView === 'status' ? null : 'status'; render(); break;
      case 'account': sheetView = sheetView === 'account' ? null : 'account'; pageMsg = null; render(); break;
      case 'close': closeSheet(); break;
      case 'retry': showError(''); readState(); break;
      // rescue
      case 'mic': await toggleRecord(button.dataset.target || 'composer'); break;
      case 'takePhoto': slot('cam').click(); break;
      case 'pickPhoto': slot('gallery').click(); break;
      case 'countByHand': ui.count = { source: 'manual', items: (event()?.items || []).map((it) => ({ item: it.item, left: 0, unit: 'portions' })) }; ui.editing = true; ui.estMessage = ''; saveUi(); render(); scrollThread(); break;
      case 'editAmounts': ui.editing = true; render(); scrollThread(); break;
      case 'doneEdit': ui.editing = false; if (ui.count?.source === 'photo') ui.count.source = 'photo_edited'; saveUi(); render(); scrollThread(); break;
      case 'alert': await alertPartners(); break;
      case 'step': {
        const scope = button.dataset.scope; const k = button.dataset.k; const dir = Number(button.dataset.dir);
        const target = scope === 'count' ? ui.count?.items[i] : scope === 'draft-item' ? evView.draft?.items[i] : null;
        if (!target) break;
        const cur = num(target[k]);
        target[k] = Math.max(0, cur + dir * stepSize(dir < 0 ? Math.max(0, cur - 1) : cur));
        saveUi(); render(); break;
      }
      // events
      case 'newEvent': tab = 'events'; store.set('rc-tab', tab); evView = { mode: 'form', editing: false, draft: blankDraft(), error: '' }; render(); break;
      case 'openEvent': evView = { mode: 'detail', id }; render(); break;
      case 'evList': evView = { mode: 'list' }; render(); break;
      case 'editEvent': { const e = event(); if (e) evView = { mode: 'form', editing: true, error: '', draft: { name: e.name || '', venue: e.venue || '', date: e.date || todayIso(), goodForMinutes: e.goodForMinutes || 45, items: (e.items || []).map((x) => ({ item: x.item, ordered: num(x.ordered) })) } }; render(); break; }
      case 'addrow': evView.draft.items.push({ item: '', ordered: 0 }); render(); break;
      case 'delrow': evView.draft.items.splice(i, 1); render(); break;
      case 'saveEvent': await saveEvent(); break;
      case 'restartEvent': {
        const e = events().find((x) => x.id === id) || event();
        if (!e) break;
        const r = await act('POST', '/api/event', { name: e.name, venue: e.venue, date: todayIso(), items: e.items, ...(Number.isFinite(e.goodForMinutes) ? { goodForMinutes: e.goodForMinutes } : {}) });
        if (r.ok) setTab('rescue');
        break;
      }
      case 'agentStart': ui.agent.error = ''; await agentSend(''); break;
      case 'agentChip': await agentSend(button.dataset.v || ''); break;
      case 'pick': {
        const { scope, k, v } = button.dataset;
        if (scope === 'draft' && evView.draft) evView.draft[k] = k === 'goodForMinutes' ? Number(v) : v;
        else if (scope === 'pf' && pform) pform[k] = v;
        else if (scope === 'vf' && vform) vform[k] = v;
        render(); break;
      }
      // partners
      case 'placeNew': pform = blankPlace(); confirmRm = null; pageMsg = null; render(); break;
      case 'placeEdit': { const p = placeById(id); if (p) pform = { id, name: p.name || '', type: p.type || 'shelter', distanceMiles: p.distanceMiles ?? '', capacity: p.capacity ?? '', accepts: [...(p.accepts || [])], address: p.address || '', phone: '' }; confirmRm = null; pageMsg = null; render(); break; }
      case 'toggleAccept': if (pform) { const v = button.dataset.v; pform.accepts = pform.accepts.includes(v) ? pform.accepts.filter((x) => x !== v) : [...pform.accepts, v]; render(); } break;
      case 'placeSave': await savePlace(); break;
      case 'placeRmPhone': if (pform?.id) { const ok = await pageAct('PATCH', `/api/places/${encodeURIComponent(pform.id)}`, { phone: '' }, 'This server cannot change partner phones yet.', 'Removed the number.'); if (ok) pform.phone = ''; render(); } break;
      case 'placeRm': confirmRm = `p:${id}`; pageMsg = null; render(); break;
      case 'placeRmYes': { const name = placeById(id)?.name || 'The partner'; if (await pageAct('DELETE', `/api/places/${encodeURIComponent(id)}`, {}, 'This server cannot remove partners yet.', `${name} was removed.`)) confirmRm = null; render(); break; }
      // volunteers
      case 'volNew': vform = { name: '', phone: '' }; confirmRm = null; pageMsg = null; render(); break;
      case 'volEdit': { const v = volOf(id); if (v) vform = { id, name: v.name, phone: '', optedIn: String(v.optedIn !== false) }; confirmRm = null; pageMsg = null; render(); break; }
      case 'volSave': await saveVolunteer(); break;
      case 'volRm': confirmRm = `v:${id}`; pageMsg = null; render(); break;
      case 'volRmYes': { const name = volOf(id)?.name || 'The volunteer'; if (await pageAct('DELETE', `/api/volunteers/${encodeURIComponent(id)}`, {}, 'This server cannot remove volunteers yet.', `${name} was removed from the team.`)) confirmRm = null; render(); break; }
      case 'formCancel': pform = null; vform = null; pageMsg = null; render(); break;
      case 'rmNo': confirmRm = null; render(); break;
      // cancel a job / the rescue
      case 'lotCancel': confirmRm = `lot:${id}`; render(); break;
      case 'lotCancelYes': { const r = await act('POST', `/api/lots/${encodeURIComponent(id)}/cancel`, {}, { quiet: true }); if (r.ok) { confirmRm = null; note('Cancelled that job.', true); } else note(r.message || 'This server cannot cancel a job yet.', false); render(); break; }
      case 'rescueCancel': confirmRm = 'rescue'; render(); break;
      case 'rescueCancelYes': { const r = await act('POST', '/api/rescue/cancel', {}, { quiet: true }); if (r.ok) { confirmRm = null; ui = freshUi(); photos = []; saveUi(); sheetView = null; setTab('rescue'); note('Rescue cancelled. The event is kept.', true); } else note(r.message || 'This server cannot cancel a rescue yet.', false); render(); break; }
      // demo tools
      case 'sample': {
        ui.pendingSample = true;
        const r = await act('POST', '/api/event', SAMPLE_EVENT(), { quiet: true });
        ui.pendingSample = false;
        if (r.ok) { ui.sample = true; saveUi(); sheetView = null; setTab('rescue'); } else { note(r.message, false); render(); }
        break;
      }
      case 'ff': { const r = await act('POST', '/api/demo/fast-forward', { minutes: 1 }, { quiet: true }); note(r.ok ? 'Moved the clock 1 minute ahead.' : r.message, r.ok); render(); break; }
      case 'reset': { const r = await act('POST', '/api/demo/reset', {}, { quiet: true }); if (r.ok) { ui = freshUi(); photos = []; saveUi(); note('Reset the rescue. Your partners and volunteers are kept.', true); } else note(r.message, false); render(); break; }
      case 'resetAll': confirmRm = 'all'; render(); break;
      case 'resetAllYes': { const r = await act('POST', '/api/demo/reset-all', {}, { quiet: true }); confirmRm = null; if (r.ok) { ui = freshUi(); photos = []; saveUi(); note('Everything is back to the sample data.', true); } else note(r.message, false); render(); break; }
      case 'placeCall': {
        let r;
        try { r = await call('POST', `/api/places/${encodeURIComponent(id)}/connect`, {}); } catch (e) { r = { ok: false, data: { error: netMessage(e) } }; }
        const text = r.ok ? r.data?.message || 'Calling you now. Answer to be connected.' : failMessage(r, 'Calling a partner is not on this server yet.');
        callMsgs.set(id, { ok: r.ok, text, needPhone: !r.ok && /coordinator|your (phone|number)/i.test(text) });
        render(); break;
      }
      case 'volCall': {
        let r;
        try { r = await call('POST', `/api/volunteers/${encodeURIComponent(id)}/connect`, {}); } catch (e) { r = { ok: false, data: { error: netMessage(e) } }; }
        const text = r.ok ? r.data?.message || 'Calling you now. Answer to be connected.' : failMessage(r, 'Calling a volunteer is not on this server yet.');
        callMsgs.set(id, { ok: r.ok, text, needPhone: !r.ok && /coordinator|your (phone|number)/i.test(text) });
        render(); break;
      }
      case 'saveMyPhone': {
        const el = root.querySelector('input[data-f="myphone"]');
        const r = await act('POST', '/api/settings', { coordinatorPhone: String(el?.value || '').trim() }, { quiet: true, missing: 'Saving your number is not on this server yet.' });
        note(r.ok ? 'Saved your phone number.' : r.message, r.ok); render(); break;
      }
      case 'simDemo': await act('POST', '/api/demo/simulate', { lotId: id, action: button.dataset.v }); break;
      case 'simAccept': await act('POST', `/api/offers/${encodeURIComponent(id)}/respond`, { action: 'accept' }); break;
      case 'simDecline': await act('POST', `/api/offers/${encodeURIComponent(id)}/respond`, { action: 'decline' }); break;
      case 'simPickup': await act('POST', `/api/offers/${encodeURIComponent(id)}/pickup`, {}); break;
      case 'simDelivered': {
        const r = await act('POST', `/api/offers/${encodeURIComponent(id)}/delivered`, {}, { quiet: true });
        if (!r.ok && r.missing) await act('POST', `/api/offers/${encodeURIComponent(id)}/dropoff`, {});
        else if (!r.ok) showError(r.message);
        break;
      }
      default: break;
    }
  }, { signal: lifecycle.signal });

  root.addEventListener('submit', async (ev) => {
    const form = ev.target;
    ev.preventDefault();
    if (form === composer) {
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      input.value = '';
      composer.dataset.text = '';
      await handleSaid(text);
      input.focus();
    } else if (form.dataset.form === 'agent') {
      const box = form.querySelector('input');
      const text = box.value.trim();
      if (!text) return;
      box.value = '';
      await agentSend(text);
      root.querySelector('#rc-agent')?.focus();
    }
  }, { signal: lifecycle.signal });

  document.addEventListener('keydown', (ev) => {
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Escape') { if (sheetView) { closeSheet(); ev.preventDefault(); } else if (rec.state === 'rec') stopRecord(); return; }
    if (mod && /^[1-4]$/.test(ev.key)) { ev.preventDefault(); setTab(NAV[Number(ev.key) - 1][0]); return; }
    if (mod && ev.key === '/') { ev.preventDefault(); navOpen = !navOpen; store.set('rc-nav', navOpen ? '1' : '0'); render(); return; }
    if (mod && ev.key === '\\') { ev.preventDefault(); statusOpen = !statusOpen; store.set('rc-status', statusOpen ? '1' : '0'); render(); return; }
    if (mod || ev.altKey || typing(document.activeElement)) return;
    if (ev.key === '?') { sheetView = 'account'; render(); }
    else if (tab === 'rescue' && lower(ev.key) === 'm' && canRecord()) toggleRecord('composer');
    else if (tab === 'rescue' && lower(ev.key) === 'p' && rescueStage() === 'count') slot('cam').click();
  }, { signal: lifecycle.signal });

  // Swipe the sheet down to close it.
  let touchY = null;
  sheet.addEventListener('touchstart', (ev) => { touchY = sheet.scrollTop <= 0 ? ev.touches[0].clientY : null; }, { passive: true, signal: lifecycle.signal });
  sheet.addEventListener('touchend', (ev) => { if (touchY !== null && ev.changedTouches[0].clientY - touchY > 80) closeSheet(); touchY = null; }, { signal: lifecycle.signal });

  slot('cam').addEventListener('change', (ev) => { addPhotos(ev.target.files); ev.target.value = ''; }, { signal: lifecycle.signal });
  slot('gallery').addEventListener('change', (ev) => { addPhotos(ev.target.files); ev.target.value = ''; }, { signal: lifecycle.signal });
  window.addEventListener('resize', () => { if (sheetView === 'status' && wide()) render(); }, { signal: lifecycle.signal });

  render();
  readState();
  let stream = null;
  if (typeof EventSource !== 'undefined') {
    stream = new EventSource(`${apiBase}/api/stream`);
    stream.onopen = () => { streamConnected = true; tick(); };
    stream.onmessage = (ev) => { try { applyState(JSON.parse(ev.data)); showError(''); } catch { showError('A live update could not be read. Retrying.'); } };
    stream.onerror = () => { streamConnected = false; tick(); };
  }
  timers.push(setInterval(readState, 3000), setInterval(tick, 250));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) readState(); }, { signal: lifecycle.signal });
  window.addEventListener('online', readState, { signal: lifecycle.signal });

  return () => {
    disposed = true;
    lifecycle.abort();
    timers.forEach(clearInterval);
    stream?.close();
    clearInterval(rec.timer);
    rec.stream?.getTracks().forEach((t) => t.stop());
    root.innerHTML = '';
  };
}
