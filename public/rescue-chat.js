// Rescue chat: the whole rescue as one thread (event, questions, photo, places, outreach, summary).
// Everything here talks to the real server. When the server says no, we show its message in plain words.

const STAGES = ['event', 'details', 'photo', 'match', 'outreach', 'done'];
const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;
const AVATARS = [['#E3EDE8', '#40745C'], ['#F3E6DD', '#9A4F2B'], ['#E6E9F2', '#4A5678'], ['#F1ECD9', '#7A6420']];
const MAX_PHOTOS = 4;
const MAX_SIDE = 1600;
const STATUS_WORD = { offered: 'Asked', accepted: 'Accepted', declined: 'Declined', picked_up: 'On the way', dropped_off: 'Dropped off' };
const PLACE_TYPES = ['shelter', 'kitchen', 'food bank'];
const ACCEPTS = [['prepared', 'Prepared food'], ['packaged', 'Packaged food'], ['drinks', 'Drinks']];
const RAW_LOG = /(^|\s)[\w.-]+=\S|\b[a-z]+_[a-z]+\b|[{}[\]]|\b(undefined|null|NaN)\b|\b[0-9a-f]{8}-[0-9a-f]{4}\b|^(POST|GET|PATCH|PUT)\b|https?:\/\/|\+?\d[\d\s().-]{8,}\d/i;
const MISSING = 'Endpoint not found.';
// Outreach is by voice call only. Any texting notes from the server are kept out of the thread.
const TEXTING = /^texted\b|\btext message|\bsms\b|reply yes/i;

const icon = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const TEMPLATE = `
<div class="rc" data-urg="idle" aria-busy="true">
  <aside class="rc-side" aria-label="Rescue and team">
    <div class="rc-brand"><span class="rc-logo">${icon.logo}</span>Food Rescue HQ</div>
    <p class="rc-label">Event</p>
    <div class="rc-chan"><div><b data-slot="chan-title">No event yet</b><small data-slot="chan-sub"></small></div></div>
    <div class="rc-labelrow"><p class="rc-label">Team</p><button type="button" class="rc-btn rc-sm" data-act="view" data-v="team">Manage</button></div>
    <ul class="rc-team" data-slot="team-side"></ul>
    <div class="rc-labelrow"><p class="rc-label">Places</p><button type="button" class="rc-btn rc-sm" data-act="view" data-v="places">Manage</button></div>
    <ul class="rc-team" data-slot="places-side"></ul>
    <p class="rc-foot">Phone numbers stay private. Only the last 4 digits are shown.</p>
  </aside>
  <main class="rc-main">
    <header class="rc-top">
      <div class="rc-brand rc-brand-m"><span class="rc-logo">${icon.logo}</span>Food Rescue HQ</div>
      <span class="rc-live" role="status"><i></i><span data-slot="live">Connecting to HQ</span></span>
      <button type="button" class="rc-btn rc-team-btn" data-act="view" data-v="team">Team</button>
      <button type="button" class="rc-btn rc-demo-btn" data-act="demo" aria-expanded="false">Demo</button>
    </header>
    <div class="rc-demo" data-slot="demo" hidden>
      <button type="button" class="rc-btn" data-act="sample">Sample event</button>
      <button type="button" class="rc-btn" data-act="ff">Fast-forward 1 minute</button>
      <button type="button" class="rc-btn" data-act="reset">Reset</button>
    </div>
    <button type="button" class="rc-pin" data-act="view" data-v="status" aria-expanded="false" aria-controls="rc-sheet">
      ${ring(40, 26)}
      <span class="rc-pin-txt"><b data-t="timer">--:--</b><small data-slot="pin-sub">Getting the latest</small></span>
      <span class="rc-chip" data-slot="chip">Not started</span>
      <span class="rc-pin-open">${icon.up}<span class="rc-sr">Show rescue status</span></span>
    </button>
    <div class="rc-error" role="alert" hidden><span data-slot="error"></span><button type="button" class="rc-btn" data-act="retry">Retry</button></div>
    <div class="rc-thread" data-slot="thread" role="log" aria-label="Rescue thread" tabindex="0"></div>
    <div class="rc-quick" data-slot="quick" aria-label="Quick replies"></div>
    <form class="rc-composer" data-slot="composer">
      <label class="rc-sr" for="rc-text">Message</label>
      <input id="rc-text" name="text" maxlength="280" autocomplete="off" placeholder="Post an update to the team">
      <button type="submit" aria-label="Send">${icon.send}</button>
    </form>
    <input type="file" accept="image/*" capture="environment" data-slot="cam" class="rc-sr" tabindex="-1" aria-hidden="true">
    <input type="file" accept="image/*" multiple data-slot="gallery" class="rc-sr" tabindex="-1" aria-hidden="true">
  </main>
  <aside class="rc-status" aria-label="Rescue status" data-slot="status-desk"></aside>
  <div class="rc-scrim" data-act="close" hidden></div>
  <section class="rc-sheet" id="rc-sheet" role="dialog" aria-modal="true" aria-labelledby="rc-sheet-title" hidden>
    <div class="rc-sheet-head"><h2 id="rc-sheet-title" data-slot="sheet-title">Rescue status</h2><button type="button" class="rc-btn" data-act="close">Close</button></div>
    <div class="rc-sheet-body" data-slot="status-sheet"></div>
  </section>
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
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function niceDate(value) {
  if (!value) return '';
  if (value === todayIso()) return 'Today';
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
// Phone status without ever showing the number. Older servers send `phone`; we only read its last 4 digits.
const phoneSet = (v) => (typeof v?.phoneSet === 'boolean' ? v.phoneSet : /^\+\d{8,}$/.test(String(v?.phone || '')));
const phoneLast4 = (v) => String(v?.phoneLast4 || String(v?.phone || '').replace(/\D/g, '').slice(-4) || '');
const phoneText = (v) => (phoneSet(v) ? `Phone added, ends in ${phoneLast4(v)}` : 'No phone yet');
// US numbers typed any way. The server adds +1 and has the final say, so we send the text as typed.
const phoneOk = (raw) => String(raw || '').replace(/\D/g, '').length >= 10;
const PHONE_HELP = 'Enter the full phone number, for example 762 235 7374.';

const Speech = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const QUICK_EXAMPLE = '100 tacos and 10 sandwiches at the main hall, good for 45 minutes';
const listWords = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

const SAMPLE_EVENT = () => ({
  name: 'Conference lunch', venue: 'Main hall', date: todayIso(),
  items: [{ item: 'Tacos', ordered: 400 }, { item: 'Sandwiches', ordered: 20 }, { item: 'Chips', ordered: 10 }],
});
const freshUi = () => ({ draft: { name: '', venue: '', date: todayIso(), items: [{ item: '', ordered: '' }] }, chat: [], chips: [], agentDone: false, newEvent: false, stageAt: {}, mode: 'photo', manual: {}, est: null, estMessage: '', offerEdits: {}, callNote: {}, formError: '', eventId: null, quickText: '', quickError: '', quick: null, stepByStep: false });
const blankPlace = () => ({ name: '', type: 'shelter', distanceMiles: '', capacity: '', accepts: ['prepared', 'packaged', 'drinks'], address: '' });
const freshForms = () => ({ vol: { name: '', phone: '' }, volEdit: null, place: blankPlace(), placeEdit: null, confirm: null, msg: '', ok: false });

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
  let asks = [];
  let threadHtml = '';
  let lastUrg = null;
  let photos = []; // data URLs, never persisted
  let photoBusy = 0;
  let estimating = false;
  let demoOpen = false;
  let deferred = false;
  let view = null; // null | 'status' | 'team' | 'places'
  let forms = freshForms();
  let agentBusy = false;
  let agentError = '';
  let explain = { key: '', text: '', loading: false };
  let ui = freshUi();
  let listening = null; // active SpeechRecognition while the mic is on
  try { const saved = JSON.parse(sessionStorage.getItem('rc-ui') || 'null'); if (saved) ui = { ...freshUi(), ...saved, est: null }; } catch { /* start fresh */ }
  const saveUi = () => { try { sessionStorage.setItem('rc-ui', JSON.stringify({ ...ui, est: null })); } catch { /* storage is optional */ } };

  root.innerHTML = TEMPLATE;
  const app = root.querySelector('.rc');
  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
  const pin = root.querySelector('.rc-pin');
  const sheet = root.querySelector('.rc-sheet');
  const scrim = root.querySelector('.rc-scrim');
  const input = root.querySelector('#rc-text');

  // ---- derived data -------------------------------------------------------
  const event = () => state?.event || null;
  const report = () => state?.report || null;
  const offers = () => state?.offers || [];
  const volunteers = () => state?.volunteers || [];
  const places = () => state?.places || [];
  const incident = () => state?.incident || null;
  const placeOf = (offer) => places().find((p) => p.id === offer.placeId);
  const volOf = (id) => volunteers().find((v) => v.id === id);
  const isActiveInc = () => Boolean(incident() && ['open', 'in_progress'].includes(incident().status) && Date.now() < Date.parse(incident().deadline));
  const secondsLeft = () => {
    const deadline = Date.parse(incident()?.deadline);
    return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
  };
  const windowSeconds = () => Math.max(num(incident()?.windowSeconds) || 2700, secondsLeft(), 1);
  const latestOffer = (vid) => offers().filter((o) => o.volunteerId === vid && o.status !== 'proposed').pop();

  function remaining() {
    const rows = (report()?.items || []).map((it) => {
      const mine = offers().filter((o) => String(o.item).toLowerCase() === String(it.item).toLowerCase());
      const left = num(it.left);
      const rescued = sum(mine.filter((o) => o.status === 'dropped_off'), (o) => o.portions);
      const onWay = sum(mine.filter((o) => ['accepted', 'picked_up'].includes(o.status)), (o) => o.portions);
      return { item: it.item, left, rescued, onWay, need: Math.max(0, left - rescued - onWay) };
    });
    return { rows, left: sum(rows, (r) => r.left), rescued: sum(rows, (r) => r.rescued), onWay: sum(rows, (r) => r.onWay), need: sum(rows, (r) => r.need) };
  }
  const needList = (r) => r.rows.filter((x) => x.need > 0).map((x) => `${fmt(x.need)} ${esc(x.item)}`).join(', ');

  function stage() {
    if (!event() || ui.newEvent) return 'event';
    if (!report()) return ui.agentDone ? 'photo' : 'details';
    const r = remaining();
    if (state.journeyStep === 'done' || (incident() && !isActiveInc()) || (r.left > 0 && r.rescued >= r.left) || r.left === 0) return 'done';
    return offers().some((o) => o.status !== 'proposed') ? 'outreach' : 'match';
  }
  function urgency() {
    const inc = incident();
    if (ui.newEvent || !inc || !report()) return 'idle';
    const r = remaining();
    if (inc.status === 'resolved' || r.left === 0 || (r.left > 0 && r.rescued >= r.left)) return 'done';
    if (!isActiveInc()) return 'ended';
    const s = secondsLeft();
    return s <= 0 ? 'ended' : s <= 300 ? 'crit' : s <= 900 ? 'warn' : 'calm';
  }
  const CHIP = { idle: 'Not started', calm: 'Rescue open', warn: 'Rescue open', crit: 'Rescue open', done: 'Rescue complete', ended: 'Time ran out' };
  function timerText() {
    const urg = urgency();
    if (urg === 'done') return 'Done';
    if (urg === 'ended') return '00:00';
    if (urg === 'idle') return '--:--';
    const s = secondsLeft();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  const sender = (entry) => {
    if (entry.kind === 'update') return { name: 'You', me: true };
    const v = volOf(entry.volunteerId) || volunteers().find((x) => x.name && String(entry.text || '').startsWith(x.name));
    if (v) return { name: v.name, vol: v };
    if (entry.volunteerName || entry.actor) return { name: String(entry.volunteerName || entry.actor), vol: { name: String(entry.volunteerName || entry.actor), id: 'x' } };
    return { name: 'HQ', hq: true };
  };
  const avatarHtml = (who) => {
    if (who.hq) return '<span class="rc-av hq" aria-hidden="true">HQ</span>';
    const idx = Math.max(0, volunteers().findIndex((v) => v.id === who.vol?.id));
    const [bg, fg] = AVATARS[idx % AVATARS.length];
    return `<span class="rc-av" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initials(who.name))}</span>`;
  };
  const hqRow = (inner, time) => `<div class="rc-row"><span class="rc-av hq" aria-hidden="true">HQ</span><div class="rc-col"><div class="rc-who">HQ${time ? `<time>${esc(time)}</time>` : ''}</div>${inner}</div></div>`;
  const bubble = (html) => `<div class="rc-bub">${html}</div>`;
  const meRow = (text) => `<div class="rc-row rc-me"><div class="rc-col"><div class="rc-bub me">${esc(text)}</div></div></div>`;
  const dis = () => (busy || !state ? ' disabled' : '');
  const chipFor = (o, v) => (o ? (STATUS_WORD[o.status] || 'Asked') : (v?.optedIn === false ? 'Not taking asks' : 'Ready'));

  // ---- thread blocks ------------------------------------------------------
  function eventCard() {
    const d = ui.draft;
    const rows = d.items.map((row, i) => `<div class="rc-itemrow">
        <label class="rc-fld rc-grow"><span>Food item</span><input data-f="draft-item" data-i="${i}" data-k="item" value="${esc(row.item)}" placeholder="Tacos"></label>
        <label class="rc-fld rc-qty"><span>Quantity</span><input type="number" min="1" inputmode="numeric" data-f="draft-item" data-i="${i}" data-k="ordered" value="${esc(row.ordered)}" placeholder="0"></label>
        ${d.items.length > 1 ? `<button type="button" class="rc-btn rc-sm" data-act="delrow" data-i="${i}">Remove</button>` : ''}
      </div>`).join('');
    return `<div class="rc-cardm"><h3>Add your event</h3>
      <label class="rc-fld"><span>Event name</span><input data-f="draft" data-k="name" value="${esc(d.name)}" placeholder="Conference lunch"></label>
      <label class="rc-fld"><span>Venue</span><input data-f="draft" data-k="venue" value="${esc(d.venue)}" placeholder="Main hall"></label>
      <label class="rc-fld"><span>Date</span><input type="date" data-f="draft" data-k="date" value="${esc(d.date)}"></label>
      <p class="rc-sub">Food ordered</p>${rows}
      <div class="rc-actions"><button type="button" class="rc-btn" data-act="addrow">Add a food item</button></div>
      ${ui.formError ? `<p class="rc-warn" role="alert">${esc(ui.formError)}</p>` : ''}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="saveEvent"${dis()}>Save event</button>
      ${ui.newEvent ? '<button type="button" class="rc-btn" data-act="cancelNew">Back to the last rescue</button>' : ''}</div>
      <button type="button" class="rc-link" data-act="quickPath">Use the quick start instead</button></div>`;
  }
  // Fast path: say or type what is left, one tap starts everything.
  function quickCard() {
    const has = Boolean(ui.quickText.trim());
    const mic = Speech ? `<button type="button" class="rc-mic${listening ? ' on' : ''}" data-act="mic" aria-pressed="${Boolean(listening)}">${icon.mic}<span>${listening ? 'Listening. Tap to stop' : 'Tap and say what’s left'}</span></button>` : '';
    return `<div class="rc-cardm rc-quickstart">${mic}
      <label class="rc-fld"><span>${Speech ? 'or type it' : 'Type what is left'}</span><textarea rows="3" data-f="quick" placeholder="What food is left, where, and for how long">${esc(ui.quickText)}</textarea></label>
      <p class="rc-hint">For example: “${esc(QUICK_EXAMPLE)}”</p>
      ${ui.quickError ? `<p class="rc-warn" role="alert">${esc(ui.quickError)}</p>` : ''}
      <button type="button" class="rc-btn rc-primary rc-big" data-act="quickStart"${busy || !state || !has ? ' disabled' : ''}>${busy ? 'Starting the rescue' : 'Start rescue'}</button>
      <button type="button" class="rc-link" data-act="stepByStep">Set it up step by step</button></div>`;
  }
  function quickSummary(understood, snap) {
    const u = understood || {};
    const items = (Array.isArray(u.items) ? u.items : []).filter((i) => num(i.left) > 0).map((i) => `${fmt(i.left)} ${i.item}`);
    const venue = u.venue || snap?.event?.venue || '';
    const mins = Number.isFinite(Number(u.goodForMinutes)) && u.goodForMinutes ? Number(u.goodForMinutes) : snap?.event?.goodForMinutes;
    let text = `Got it: ${listWords(items) || 'your leftovers'}${venue ? ` at ${venue}` : ''}${mins ? `, good for ${mins} minutes` : ''}.`;
    const asked = (snap?.volunteers || []).filter((v) => (snap.offers || []).some((o) => o.volunteerId === v.id && o.status === 'offered'));
    const noPhone = asked.filter((v) => !phoneSet(v)).map((v) => firstName(v.name));
    if (asked.length) text += ' Calling volunteers now.';
    if (noPhone.length) text += ` ${listWords(noPhone)} ${noPhone.length > 1 ? 'have' : 'has'} no phone yet. Add one so HQ can call.`;
    return text;
  }

  const itemsLine = (list) => (list || []).map((i) => `${fmt(i.ordered)} ${esc(i.item)}`).join(', ');
  function eventSummary() {
    const e = event();
    return `<div class="rc-cardm"><h3>${esc(e.name)}</h3><p class="rc-line">${esc(e.venue)}${e.date ? ` · ${esc(niceDate(e.date))}` : ''}</p><p class="rc-line">Ordered: ${itemsLine(e.items)}</p></div>`;
  }

  function understood() {
    const e = event();
    const rows = [['Event', esc(e.name)], ['Venue', esc(e.venue)], ['Date', esc(niceDate(e.date))], ['Food', itemsLine(e.items)],
      ['Good for', Number.isFinite(e.goodForMinutes) ? `${fmt(e.goodForMinutes)} minutes` : 'Not set'],
      ['Contact', e.contact ? esc(e.contact) : 'Not set'], ['Notes', e.notes ? esc(e.notes) : 'None']];
    return `<div class="rc-cardm"><h3>What I understood</h3>${rows.map(([k, v]) => `<p class="rc-kv"><span>${k}</span><b>${v}</b></p>`).join('')}</div>`;
  }
  function detailsBlock(locked) {
    let html = ui.chat.map((m) => (m.role === 'user' ? meRow(m.text) : hqRow(bubble(esc(m.text))))).join('');
    if (agentBusy) html += hqRow(bubble('<span class="rc-typing">HQ is thinking</span>'));
    else if (agentError && !locked) html += hqRow(`<div class="rc-warn" role="alert">${esc(agentError)}</div><div class="rc-actions"><button type="button" class="rc-btn" data-act="agentRetry">Try again</button></div>`);
    if (locked || ui.agentDone) return html + hqRow(understood());
    if (Number.isFinite(event().goodForMinutes) && ui.chat.length) {
      html += '<div class="rc-skip"><button type="button" class="rc-btn rc-sm" data-act="skipQs">Skip to the photo</button></div>';
    }
    return html;
  }

  function photoCard() {
    const e = event();
    if (report()) {
      const r = remaining();
      return hqRow(bubble('Thanks. Here is what is left.') + `<div class="rc-cardm">${r.rows.map((x) => `<p class="rc-kv"><span>${esc(x.item)}</span><b>${fmt(x.left)}</b></p>`).join('')}</div>`);
    }
    const thumbs = photos.map((src, i) => `<span class="rc-thumb"><img src="${esc(src)}" alt="Photo ${i + 1}"><button type="button" class="rc-btn rc-sm" data-act="rmPhoto" data-i="${i}">Remove</button></span>`).join('');
    let body;
    if (ui.mode === 'manual') {
      body = `<h3>Count what is left</h3>${e.items.map((it) => `<label class="rc-fld"><span>${esc(it.item)} left (of ${fmt(it.ordered)})</span><input type="number" min="0" inputmode="numeric" data-f="manual" data-k="${esc(it.item)}" value="${esc(ui.manual[it.item] ?? '')}" placeholder="0"></label>`).join('')}
        ${ui.estMessage ? `<p class="rc-warn">${esc(ui.estMessage)}</p>` : ''}
        <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="useManual"${dis()}>Use this list</button><button type="button" class="rc-btn" data-act="photoMode">Use a photo instead</button></div>`;
    } else if (ui.est) {
      body = `<h3>Is this right?</h3><p class="rc-line">Fix any number before you use the list.</p>${ui.est.map((row, i) => `<div class="rc-itemrow">
          <label class="rc-fld rc-grow"><span>${esc(row.item)}</span><input type="number" min="0" inputmode="numeric" data-f="est" data-i="${i}" data-k="count" value="${esc(row.count)}"></label>
          <label class="rc-fld rc-unit"><span>Unit</span><input data-f="est" data-i="${i}" data-k="unit" value="${esc(row.unit)}"></label>
          <span class="rc-stt">${esc(row.confidence)}</span></div>`).join('')}
        ${ui.estMessage ? `<p class="rc-line">${esc(ui.estMessage)}</p>` : ''}
        <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="useEst"${dis()}>Use this list</button><button type="button" class="rc-btn" data-act="manualMode">Enter by hand</button></div>`;
    } else {
      body = `<h3>Take a photo of what is left</h3><p class="rc-line">Up to ${MAX_PHOTOS} photos. I will estimate the counts and you can fix them.</p>
        <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="takePhoto"${photos.length >= MAX_PHOTOS ? ' disabled' : ''}>Take a photo</button>
        <button type="button" class="rc-btn" data-act="pickPhoto"${photos.length >= MAX_PHOTOS ? ' disabled' : ''}>Choose from gallery</button></div>
        ${thumbs ? `<div class="rc-thumbs">${thumbs}</div>` : ''}
        ${ui.estMessage ? `<p class="rc-warn" role="status">${esc(ui.estMessage)}</p>` : ''}
        <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="estimate"${!photos.length || busy || estimating || photoBusy ? ' disabled' : ''}>${estimating ? 'Looking at the photos' : 'Estimate what is left'}</button>
        <button type="button" class="rc-btn" data-act="manualMode">Enter by hand</button></div>`;
    }
    return hqRow(bubble('Now take a photo of the food that is left, or count it by hand.') + `<div class="rc-cardm">${body}</div>`);
  }

  const proposed = () => offers().filter((o) => o.status === 'proposed');
  const explainKey = () => proposed().map((o) => `${o.id}:${o.portions}`).join('|');
  function placesCard() {
    const list = proposed();
    if (!list.length) return hqRow(bubble('I am matching the leftovers to places that can take them.'));
    const rows = list.map((o) => {
      const p = placeOf(o);
      const val = ui.offerEdits[o.id] ?? o.portions;
      return `<div class="rc-itemrow"><div class="rc-grow"><b>${esc(p?.name || 'Partner')}</b><p class="rc-line">${esc(p?.type || '')}${p?.distanceMiles != null ? ` · ${esc(p.distanceMiles)} mi away` : ''} · ${esc(o.item)}</p></div>
        <label class="rc-fld rc-qty"><span>Portions</span><input type="number" min="0" inputmode="numeric" data-f="offer" data-id="${esc(o.id)}" value="${esc(val)}"></label></div>`;
    }).join('');
    const why = explain.loading ? '<p class="rc-line">Working out why these places fit.</p>' : esc(explain.text || '');
    return hqRow(bubble('These places can take the food. Change the portions if you need to.') + `<div class="rc-cardm">${rows}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="sendOffers"${dis()}>Approve and reach out</button></div></div>
      ${why ? `<div class="rc-cardm rc-why"><p class="rc-sub">Why these places</p><p>${why}</p></div>` : ''}`);
  }

  function outreachCard() {
    const rows = volunteers().map((v) => {
      const o = latestOffer(v.id);
      const p = o && placeOf(o);
      const b = (act, label) => `<button type="button" class="rc-btn rc-sm" data-act="${act}" data-id="${esc(o.id)}"${dis()}>${label}</button>`;
      const update = !o ? '' : o.status === 'offered' ? b('accept', 'Accept') + b('decline', 'Decline')
        : o.status === 'accepted' ? b('pickup', 'Mark picked up') : o.status === 'picked_up' ? b('dropoff', 'Mark dropped off') : '';
      const open = o && ['offered', 'accepted'].includes(o.status);
      const hasPhone = phoneSet(v);
      const callRow = open ? `<div class="rc-actions rc-callrow"><button type="button" class="rc-btn rc-primary" data-act="call" data-id="${esc(o.id)}" data-vid="${esc(v.id)}"${busy || !hasPhone ? ' disabled' : ''}>Call ${esc(firstName(v.name))} now</button>
          ${hasPhone ? `<span class="rc-hint">${esc(phoneText(v))}</span>` : `<span class="rc-hint">No phone yet.</span><button type="button" class="rc-link" data-act="addPhone" data-id="${esc(v.id)}">Add phone</button>`}</div>` : '';
      const note = ui.callNote[v.id];
      return `<div class="rc-vol"><div class="rc-volhead">${avatarHtml({ name: v.name, vol: v })}<div class="rc-grow"><b>${esc(v.name)}</b>
          <p class="rc-line">${o ? `${fmt(o.portions)} ${esc(o.item)} to ${esc(p?.name || 'a partner')}` : 'No ask yet'}</p></div><span class="rc-stt ${o ? esc(o.status) : ''}">${chipFor(o, v)}</span></div>
        ${callRow}
        ${note ? `<p class="${note.ok ? 'rc-ok' : 'rc-warn'}" role="status">${esc(note.text)}</p>` : ''}
        ${update ? `<div class="rc-statusgrp"><p class="rc-sub">Update status</p><div class="rc-actions">${update}</div></div>` : ''}</div>`;
    }).join('');
    return hqRow(bubble('Reaching out to volunteers. Tap Call now: they hear the offer and press 1 to accept or 2 to decline.') + `<div class="rc-cardm">${rows}</div>`);
  }

  function summaryData() {
    const s = state.summary || {};
    const r = remaining();
    const ordered = s.ordered ?? sum(event()?.items || [], (i) => i.ordered);
    const left = s.left ?? r.left;
    const rescued = s.rescued ?? r.rescued;
    let by = Array.isArray(s.byPlace) ? s.byPlace.map((p) => ({ name: p.name || p.place || p.placeName || 'Partner', n: num(p.portions ?? p.rescued ?? p.count ?? p.total) })) : [];
    if (!by.length) by = places().map((p) => ({ name: p.name, n: sum(offers().filter((o) => o.placeId === p.id && o.status === 'dropped_off'), (o) => o.portions) })).filter((p) => p.n > 0);
    return { ordered, left, rescued, eaten: s.eaten ?? Math.max(0, ordered - left), notRescued: s.notRescued ?? Math.max(0, left - rescued), by };
  }
  function summaryCard() {
    const d = summaryData();
    const line = urgency() === 'done' ? 'Everything that was left found a home.' : 'The window closed. Here is how it went.';
    return hqRow(bubble(line) + `<div class="rc-cardm"><h3>Rescue summary</h3>
      ${[['Ordered', d.ordered], ['Eaten', d.eaten], ['Left over', d.left], ['Rescued', d.rescued], ['Not rescued', d.notRescued]].map(([k, v]) => `<p class="rc-kv"><span>${k}</span><b>${fmt(v)}</b></p>`).join('')}
      ${d.by.length ? `<p class="rc-sub">Where it went</p>${d.by.map((p) => `<p class="rc-kv"><span>${esc(p.name)}</span><b>${fmt(p.n)}</b></p>`).join('')}` : ''}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="newEvent"${dis()}>Start a new event</button></div></div>`);
  }

  function feedRow(entry) {
    const text = String(entry.text || '').trim();
    if (!text || RAW_LOG.test(text) || TEXTING.test(text) || /^Updated the event\b/.test(text)) return ''; // event edits already show in the chat
    const who = sender(entry);
    if (who.me) return `<div class="rc-row rc-me"><div class="rc-col"><div class="rc-who">You<time>${esc(clock(entry.at))}</time></div><div class="rc-bub me">${esc(text)}</div></div></div>`;
    return `<div class="rc-row">${avatarHtml(who)}<div class="rc-col"><div class="rc-who">${esc(who.name)}<time>${esc(clock(entry.at))}</time></div>${bubble(esc(text))}</div></div>`;
  }
  function answer(kind) {
    if (kind === 'free') {
      const busyIds = new Set(offers().filter((o) => ['offered', 'accepted', 'picked_up'].includes(o.status)).map((o) => o.volunteerId));
      const free = volunteers().filter((v) => v.optedIn !== false && !busyIds.has(v.id));
      return `<b>${free.length} free right now</b>` + volunteers().map((v) => {
        const o = latestOffer(v.id);
        return `<div class="rc-li">${avatarHtml({ name: v.name, vol: v })}<span>${esc(v.name)}</span><span class="rc-stt ${o ? esc(o.status) : ''}">${chipFor(o, v)}</span></div>`;
      }).join('');
    }
    if (!report()) return 'Nothing counted yet. Send me a photo of what is left first.';
    const r = remaining();
    if (r.need === 0 && r.onWay === 0) return r.left === 0 ? 'Nothing is left.' : 'Everything is rescued.';
    return `${needList(r) || '0'} still need a home. ${fmt(r.onWay)} on the way, ${fmt(r.rescued)} dropped off.`;
  }

  function buildThread() {
    const cur = stage();
    const visible = STAGES.slice(0, STAGES.indexOf(cur) + 1);
    for (const st of visible) if (!ui.stageAt[st]) ui.stageAt[st] = Date.now();
    const blocks = {};
    if (!event() || ui.newEvent) {
      if (!ui.stepByStep) return hqRow(bubble('Hi, I am HQ. Tell me what food is left and where. I will find places and call volunteers.') + quickCard());
      return hqRow(bubble('Add the event and what food was ordered, and I will help you rescue what is left.') + eventCard());
    }
    const quick = ui.quick && ui.quick.eventId === event().id;
    if (quick) {
      // Fast path: the server already did the event, count, match and offers. Skip those screens.
      blocks.event = (ui.quick.said ? meRow(ui.quick.said) : '') + hqRow(bubble(esc(ui.quick.summary)));
      if (visible.includes('photo') || visible.includes('match')) blocks.photo = '';
      if (cur === 'match') blocks.match = placesCard();
    } else {
      blocks.event = hqRow(bubble('Event saved.') + eventSummary());
      blocks.details = detailsBlock(STAGES.indexOf(cur) > 1);
      if (visible.includes('photo')) blocks.photo = photoCard();
      if (visible.includes('match')) blocks.match = placesCard();
    }
    if (visible.includes('outreach')) blocks.outreach = outreachCard();
    if (visible.includes('done')) blocks.done = summaryCard();
    if (report() && (blocks.photo || quick)) {
      const inc = incident();
      const qty = sum(report().items, (i) => i.left);
      const names = report().items.filter((i) => num(i.left) > 0).map((i) => `${fmt(i.left)} ${esc(i.item)}`).join(', ') || fmt(qty);
      blocks[quick ? 'event' : 'photo'] += `<div class="rc-sys">Rescue started · ${names} at ${esc(event().venue)}${inc?.deadline ? ` · safe until ${esc(clock(inc.deadline))}` : ''}</div>`;
    }
    const keys = visible.filter((k) => blocks[k]);
    const place = (at) => { let hit = keys[0]; for (const k of keys) if ((ui.stageAt[k] || 0) <= at + 300) hit = k; return hit; };
    const extras = {};
    const pushExtra = (at, html) => { if (html) (extras[place(at)] ||= []).push({ at, html }); };
    for (const entry of state?.feed || []) pushExtra(Date.parse(entry.at) || 0, feedRow(entry));
    for (const ask of asks) {
      pushExtra(ask.at, meRow(ask.kind === 'free' ? 'Who’s free?' : 'What’s left?') + hqRow(ask.kind === 'free' ? `<div class="rc-bub rc-rich">${answer('free')}</div>` : bubble(answer(ask.kind))));
    }
    // During the questions, HQ notes go above the chat so the current question stays at the bottom.
    const extraHtml = (k) => (extras[k] || []).sort((a, b) => a.at - b.at).map((x) => x.html).join('');
    return keys.map((k) => (k === 'details' ? extraHtml(k) + blocks[k] : blocks[k] + extraHtml(k))).join('');
  }

  const typing = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  function renderThread() {
    const thread = slot('thread');
    const html = buildThread();
    if (html === threadHtml) return;
    const el = document.activeElement;
    if (thread.contains(el) && typing(el)) { deferred = true; return; } // do not steal focus while typing
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
    const keep = thread.scrollTop;
    threadHtml = html;
    thread.innerHTML = html;
    thread.scrollTop = nearBottom || !lastSuccess ? thread.scrollHeight : keep;
  }
  // Replace a region only when it changed, and never while someone is typing in it.
  const lastHtml = new Map();
  function setHtml(el, html) {
    if (lastHtml.get(el) === html) return;
    if (el.contains(document.activeElement) && typing(document.activeElement)) { deferred = true; return; }
    lastHtml.set(el, html);
    el.innerHTML = html;
  }

  const inDetails = () => Boolean(state && event() && stage() === 'details' && !ui.agentDone);
  function renderQuick() {
    const cur = state ? stage() : 'event';
    let chips = '';
    if (inDetails()) {
      chips = (agentBusy ? [] : ui.chips).map((c) => `<button type="button" class="rc-btn" data-act="chip" data-v="${esc(c)}">${esc(c)}</button>`).join('');
    } else if (event() && cur !== 'event') {
      chips = '<button type="button" class="rc-btn" data-ask="left">What’s left?</button><button type="button" class="rc-btn" data-ask="free">Who’s free?</button>';
    }
    setHtml(slot('quick'), chips);
    slot('quick').hidden = !chips;
    input.placeholder = inDetails() ? 'Answer HQ' : event() ? 'Post an update to the team' : 'Add the event above to begin';
  }

  // ---- team and places ----------------------------------------------------
  const fld = (form, key, label, value, attrs = '') => `<label class="rc-fld"><span>${label}</span><input data-f="form" data-form="${form}" data-k="${key}" value="${esc(value)}" ${attrs}></label>`;
  function volForm(form, v) {
    const f = forms[form];
    const editing = form === 'volEdit';
    const phoneHint = editing && phoneSet(v) ? `<p class="rc-hint">Ends in ${esc(phoneLast4(v))}. Type a new number to change it.</p>` : editing ? '' : '<p class="rc-hint">Phone is optional. You can add it later.</p>';
    return `<div class="rc-vol rc-form">${editing ? `<b>Edit ${esc(v.name)}</b>` : '<b>Add a volunteer</b>'}
      ${fld(form, 'name', 'Name', f.name, 'autocomplete="off" placeholder="First and last name"')}
      ${fld(form, 'phone', 'Phone number', f.phone, 'type="tel" autocomplete="off" inputmode="tel" placeholder="762 235 7374"')}${phoneHint}
      ${editing ? `<label class="rc-check"><input type="checkbox" data-f="form" data-form="volEdit" data-k="optedIn"${f.optedIn ? ' checked' : ''}> Can be asked to pick up food</label>` : ''}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="${editing ? 'volSave' : 'volAdd'}"${dis()}>${editing ? 'Save' : 'Add volunteer'}</button>
      ${editing ? '<button type="button" class="rc-btn rc-sm" data-act="volCancel">Cancel</button>' : ''}</div></div>`;
  }
  function teamPanel() {
    const rows = volunteers().map((v) => {
      if (forms.volEdit?.id === v.id) return volForm('volEdit', v);
      const confirming = forms.confirm === `v:${v.id}`;
      const actions = confirming
        ? `<p class="rc-line">Remove ${esc(v.name)} from the team?</p><div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="volRmYes" data-id="${esc(v.id)}"${dis()}>Yes, remove</button><button type="button" class="rc-btn rc-sm" data-act="rmNo">Keep</button></div>`
        : `<div class="rc-actions"><button type="button" class="rc-btn rc-sm" data-act="volEdit" data-id="${esc(v.id)}">Edit</button><button type="button" class="rc-btn rc-sm" data-act="volRm" data-id="${esc(v.id)}">Remove</button></div>`;
      return `<div class="rc-vol"><div class="rc-volhead">${avatarHtml({ name: v.name, vol: v })}<div class="rc-grow"><b>${esc(v.name)}</b>
        <p class="rc-line">${esc(phoneText(v))}</p>${v.optedIn === false ? '<p class="rc-line">Not taking asks</p>' : ''}</div></div>${actions}</div>`;
    }).join('') || '<p class="rc-line">No volunteers yet. Add the first one below.</p>';
    return rows + volForm('vol');
  }
  function placeForm(form, p) {
    const f = forms[form];
    const editing = form === 'placeEdit';
    const types = PLACE_TYPES.map((t) => `<option value="${t}"${f.type === t ? ' selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('');
    const checks = ACCEPTS.map(([k, label]) => `<label class="rc-check"><input type="checkbox" data-f="form" data-form="${form}" data-k="accepts" data-v="${k}"${f.accepts.includes(k) ? ' checked' : ''}> ${label}</label>`).join('');
    return `<div class="rc-vol rc-form">${editing ? `<b>Edit ${esc(p.name)}</b>` : '<b>Add a place</b>'}
      ${fld(form, 'name', 'Name', f.name, 'autocomplete="off" placeholder="Partner shelter C"')}
      <label class="rc-fld"><span>Type</span><select data-f="form" data-form="${form}" data-k="type">${types}</select></label>
      <div class="rc-itemrow">${fld(form, 'distanceMiles', 'Distance (miles)', f.distanceMiles, 'type="number" min="0" step="0.1" inputmode="decimal" placeholder="3"')}
      ${fld(form, 'capacity', 'Capacity (portions)', f.capacity, 'type="number" min="1" step="1" inputmode="numeric" placeholder="120"')}</div>
      ${fld(form, 'address', 'Address (optional)', f.address, 'autocomplete="off" placeholder="12 Main St"')}
      <fieldset class="rc-checks"><legend>Accepts</legend>${checks}</fieldset>
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="${editing ? 'placeSave' : 'placeAdd'}"${dis()}>${editing ? 'Save' : 'Add place'}</button>
      ${editing ? '<button type="button" class="rc-btn rc-sm" data-act="placeCancel">Cancel</button>' : ''}</div></div>`;
  }
  const acceptsText = (p) => (p.accepts || []).map((a) => (ACCEPTS.find(([k]) => k === a)?.[1] || a).toLowerCase()).join(', ') || 'nothing set';
  function placesPanel() {
    const rows = places().map((p) => {
      if (forms.placeEdit?.id === p.id) return placeForm('placeEdit', p);
      const confirming = forms.confirm === `p:${p.id}`;
      const actions = confirming
        ? `<p class="rc-line">Remove ${esc(p.name)}?</p><div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="placeRmYes" data-id="${esc(p.id)}"${dis()}>Yes, remove</button><button type="button" class="rc-btn rc-sm" data-act="rmNo">Keep</button></div>`
        : `<div class="rc-actions"><button type="button" class="rc-btn rc-sm" data-act="placeEdit" data-id="${esc(p.id)}">Edit</button><button type="button" class="rc-btn rc-sm" data-act="placeRm" data-id="${esc(p.id)}">Remove</button></div>`;
      return `<div class="rc-vol"><b>${esc(p.name)}</b>
        <p class="rc-kv"><span>Type</span><b>${esc(p.type || '')}</b></p>
        <p class="rc-kv"><span>Distance</span><b>${esc(p.distanceMiles ?? '')} mi</b></p>
        <p class="rc-kv"><span>Capacity</span><b>${fmt(p.capacity)} portions</b></p>
        <p class="rc-kv"><span>Accepts</span><b>${esc(acceptsText(p))}</b></p>
        ${p.address ? `<p class="rc-kv"><span>Address</span><b>${esc(p.address)}</b></p>` : ''}${actions}</div>`;
    }).join('') || '<p class="rc-line">No places yet. Add the first one below.</p>';
    return rows + placeForm('place');
  }
  function panelHtml(withHead) {
    const tab = (v, label) => `<button type="button" class="rc-tab" role="tab" aria-selected="${view === v}" data-act="view" data-v="${v}">${label}</button>`;
    const head = withHead ? `<div class="rc-sheet-head"><h2>${view === 'team' ? 'Team' : 'Places'}</h2><button type="button" class="rc-btn" data-act="close">Close</button></div>` : '';
    const msg = forms.msg ? `<p class="${forms.ok ? 'rc-ok' : 'rc-warn'}" role="status">${esc(forms.msg)}</p>` : '';
    return `<div class="rc-panel">${head}<div class="rc-tabs" role="tablist">${tab('team', 'Team')}${tab('places', 'Places')}</div>${msg}${view === 'team' ? teamPanel() : placesPanel()}</div>`;
  }

  function statusHtml(withTeam) {
    const r = remaining();
    const urg = urgency();
    let title; let lead;
    if (!event()) { title = 'Ready when you are'; lead = 'Add an event to get started.'; }
    else if (!report()) { title = event().name; lead = `Waiting to hear what is left. ${itemsLine(event().items)} ordered.`; }
    else if (r.need === 0 && r.onWay === 0) { title = r.left === 0 ? 'Nothing was left over' : 'Everything is rescued'; lead = `${fmt(r.rescued)} portions found a home.`; }
    else if (r.need === 0) { title = 'Everything is claimed'; lead = 'Waiting on pickups and drop-offs.'; }
    else if (urg === 'ended') { title = `${needList(r)} did not get a home`; lead = 'The time ran out.'; }
    else { title = `${needList(r)} still need a home`; lead = `${fmt(r.onWay)} on the way, ${fmt(r.rescued)} dropped off.`; }
    const total = Math.max(1, r.left);
    const seg = (n, color) => `<i style="flex:${n};background:${color}"></i>`;
    const bar = report() ? `<div class="rc-segs" role="img" aria-label="${fmt(r.rescued)} dropped off, ${fmt(r.onWay)} on the way, ${fmt(r.need)} need a home">${seg(r.rescued, 'var(--green)')}${seg(r.onWay, 'var(--purple)')}${seg(r.need, 'var(--orange)')}</div>` : `<div class="rc-segs" aria-hidden="true">${seg(total, 'var(--track)')}</div>`;
    const team = withTeam ? `<div class="rc-labelrow"><p class="rc-label">Team</p><button type="button" class="rc-btn rc-sm" data-act="view" data-v="team">Manage team</button></div><ul class="rc-people">${volunteers().map((v) => {
      const o = latestOffer(v.id);
      return `<li>${avatarHtml({ name: v.name, vol: v })}<b>${esc(v.name)}</b><span class="rc-stt">${chipFor(o, v)}</span></li>`;
    }).join('')}</ul>` : '';
    const inc = incident();
    const sub = urg === 'done' ? 'all rescued' : urg === 'ended' ? 'time ran out' : urg === 'idle' ? 'no rescue yet' : `left · safe till ${clock(inc?.deadline)}`;
    const venue = event()?.venue ? `<p class="rc-lead">${esc(event().venue)}</p>` : '';
    const dot = (c) => `<i style="background:${c}"></i>`;
    return `<div class="rc-card"><div class="rc-ringbox">${ring(150, 16)}<span class="rc-ring-mid"><b data-t="timer">${timerText()}</b><small>${sub}</small></span></div>
      <h3>${title}</h3>${venue}<p class="rc-lead">${lead}</p>${bar}</div>
      <div class="rc-legend"><div><b>${fmt(r.rescued)}</b><span>${dot('var(--green)')}Rescued</span></div><div><b>${fmt(r.onWay)}</b><span>${dot('var(--purple)')}On the way</span></div><div><b>${fmt(r.need)}</b><span>${dot('var(--orange)')}Unclaimed</span></div></div>${team}`;
  }

  function render() {
    if (disposed) return;
    app.setAttribute('aria-busy', state ? 'false' : 'true');
    const e = event();
    if (state && (e?.id || null) !== ui.eventId) {
      const first = ui.eventId === null && e && !ui.chat.length && !ui.agentDone;
      ui.eventId = e?.id || null;
      if (!first || !e) { const keep = ui.draft; ui = { ...freshUi(), eventId: ui.eventId, draft: keep }; photos = []; asks = []; agentError = ''; explain = { key: '', text: '', loading: false }; }
      saveUi();
    }
    slot('chan-title').textContent = e ? e.name : 'No event yet';
    slot('chan-sub').textContent = e ? `${e.venue}${e.date ? ` · ${niceDate(e.date)}` : ''}` : 'Add one to begin';
    setHtml(slot('team-side'), volunteers().map((v) => `<li>${avatarHtml({ name: v.name, vol: v })}<span>${esc(v.name)}</span><span class="rc-stt">${chipFor(latestOffer(v.id), v)}</span></li>`).join(''));
    setHtml(slot('places-side'), places().map((p) => `<li><span>${esc(p.name)}</span><span class="rc-stt">${esc(p.distanceMiles ?? '')} mi</span></li>`).join(''));
    const r = remaining();
    slot('pin-sub').textContent = !e ? 'No event yet' : ui.newEvent ? 'Ready for the next rescue' : !report() ? e.name : `${fmt(r.need)} unclaimed · ${fmt(r.rescued)} rescued`;
    const panel = view === 'team' || view === 'places';
    setHtml(slot('status-desk'), panel ? panelHtml(true) : statusHtml(false));
    setHtml(slot('status-sheet'), panel ? panelHtml(false) : statusHtml(true));
    slot('sheet-title').textContent = view === 'team' ? 'Team' : view === 'places' ? 'Places' : 'Rescue status';
    sheet.hidden = !view;
    scrim.hidden = !view;
    pin.setAttribute('aria-expanded', String(view === 'status'));
    slot('demo').hidden = !demoOpen;
    root.querySelector('[data-act="demo"]').setAttribute('aria-expanded', String(demoOpen));
    root.querySelector('[data-act="ff"]').disabled = !isActiveInc() || busy;
    root.querySelector('.rc-composer button').disabled = busy || agentBusy || !state;
    slot('composer').hidden = Boolean(state) && stage() === 'event';
    renderThread();
    renderQuick();
    tick();
    if (state) setTimeout(followUps, 0);
  }

  // Work that starts on its own: the first agent question, and the match explanation.
  function followUps() {
    if (disposed || !state || busy) return;
    const cur = stage();
    if (cur === 'details' && !ui.chat.length && !agentBusy && !agentError) agentSend('');
    if (cur === 'match' && proposed().length && explain.key !== explainKey() && !explain.loading) loadExplain();
  }

  function tick() {
    if (disposed) return;
    const urg = urgency();
    app.dataset.urg = urg;
    slot('chip').textContent = CHIP[urg];
    if (lastUrg !== null && lastUrg !== urg && state) { lastUrg = urg; render(); return; }
    lastUrg = urg;
    const text = timerText();
    const fraction = urg === 'done' ? 1 : urg === 'ended' || urg === 'idle' ? 0 : secondsLeft() / windowSeconds();
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
    state = { ...next, offers: next.offers || [], places: next.places || [], summary: next.summary || {}, totals: next.totals || {} };
    revision++;
    lastSuccess = Date.now();
    render();
  }

  // ---- network ------------------------------------------------------------
  async function call(method, path, body) {
    const slow = path === '/api/estimate' ? 45000 : path.startsWith('/api/agent/') || path.endsWith('/call') ? 30000 : 12000;
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
      if (disposed) return;
      if (!streamConnected) showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Unable to reach HQ. Check your connection and retry.' : error.message);
    } finally {
      readPending = false;
    }
  }

  // Runs an action against the API. Returns {ok, data, message}. Errors become plain-language messages.
  async function act(method, path, body, { quiet, missing = 'HQ cannot do that yet. Please try again later.' } = {}) {
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
        return { ok: false, data: res.data, message: msg };
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

  // ---- agent --------------------------------------------------------------
  async function agentSend(message) {
    if (agentBusy || disposed || !event()) return;
    const text = String(message || '').trim();
    const history = ui.chat.map((m) => ({ role: m.role, text: m.text }));
    if (text) ui.chat.push({ role: 'user', text });
    agentBusy = true; agentError = ''; ui.chips = [];
    render();
    try {
      const res = await call('POST', '/api/agent/message', { message: text, history });
      if (!res.ok) throw new Error(failMessage(res, 'The HQ assistant is not available on this server yet. Count the food by hand or try again later.'));
      const d = res.data || {};
      if (d.reply) ui.chat.push({ role: 'assistant', text: String(d.reply) });
      ui.chips = Array.isArray(d.chips) ? d.chips.map(String).filter(Boolean).slice(0, 4) : [];
      if (d.snapshot && Array.isArray(d.snapshot.volunteers)) { state = { ...state, ...d.snapshot }; revision++; }
      if (d.done === true) { ui.agentDone = true; ui.chips = []; }
    } catch (error) {
      if (text && ui.chat[ui.chat.length - 1]?.text === text) { ui.chat.pop(); if (!input.value) input.value = text; }
      agentError = error.message && !(error instanceof TypeError) && error.name !== 'TimeoutError' ? error.message : 'Could not reach the HQ assistant. Check your connection and try again.';
    } finally {
      agentBusy = false;
      saveUi();
      render();
    }
  }

  async function loadExplain() {
    const key = explainKey();
    explain = { key, text: '', loading: true };
    render();
    let text;
    try {
      const res = await call('POST', '/api/agent/explain', {});
      text = res.ok && res.data?.reply ? String(res.data.reply) : res.missing ? 'An explanation is not available on this server yet.' : (res.data?.error || 'I could not explain these matches right now.');
    } catch { text = 'I could not explain these matches right now.'; }
    if (explain.key === key) explain = { key, text, loading: false };
    render();
  }

  // ---- actions ------------------------------------------------------------
  async function saveEvent(payload) {
    const items = payload.items.filter((i) => String(i.item).trim()).map((i) => ({ item: String(i.item).trim(), ordered: num(i.ordered) }));
    if (!String(payload.name).trim()) { ui.formError = 'Give the event a name.'; return render(); }
    if (!String(payload.venue).trim()) { ui.formError = 'Add the venue.'; return render(); }
    if (!items.length || items.some((i) => i.ordered < 1)) { ui.formError = 'Add at least one food item with a quantity.'; return render(); }
    ui.formError = '';
    const r = await act('POST', '/api/event', { name: String(payload.name).trim(), venue: String(payload.venue).trim(), date: payload.date, items });
    if (r.ok) { ui = { ...freshUi(), eventId: event()?.id || null }; photos = []; asks = []; agentError = ''; saveUi(); render(); }
  }
  async function useList(rows, source) {
    const r = await act('POST', '/api/report', { items: rows.map((x) => ({ item: x.item, left: x.left, unit: x.unit || 'portions', source, ...(x.confidence ? { confidence: x.confidence } : {}) })) });
    if (r.ok) { photos = []; ui.est = null; saveUi(); }
  }
  function useManual() {
    const rows = event().items.map((it) => ({ item: it.item, left: Math.min(num(it.ordered), num(ui.manual[it.item])), unit: 'portions' }));
    return useList(rows, 'manual');
  }
  function useEst() {
    const e = event();
    const rows = ui.est.map((row) => ({ item: row.item, left: num(row.count), unit: row.unit || 'portions', confidence: row.confidence, edited: row.edited }));
    for (const it of e.items) if (!rows.some((x) => x.item.toLowerCase() === it.item.toLowerCase())) rows.push({ item: it.item, left: 0, unit: 'portions', confidence: 'not seen' });
    return useList(rows, rows.some((x) => x.edited) ? 'photo_edited' : 'photo');
  }
  async function estimate() {
    estimating = true;
    ui.estMessage = '';
    render();
    let res;
    try { res = await call('POST', '/api/estimate', { images: photos, items: event().items }); }
    catch { res = { ok: false, data: null }; }
    estimating = false;
    const d = res.data || {};
    if (!res.ok || d.unreadable || !Array.isArray(d.items) || !d.items.length) {
      ui.estMessage = res.missing ? 'Photo estimates are not available on this server. Count what is left by hand.'
        : (typeof d.error === 'string' && d.error) || d.message || 'I could not read the photos. Count what is left by hand instead.';
      ui.mode = 'manual';
    } else {
      ui.est = d.items.map((i) => ({ item: i.item, count: num(i.count), unit: i.unit || 'portions', confidence: String(i.confidence || 'medium'), edited: false }));
      ui.estMessage = d.message || '';
    }
    saveUi();
    render();
  }

  async function addPhotos(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length);
    if (!list.length) return;
    photoBusy += list.length;
    render();
    for (const file of list) {
      try { photos.push(await shrink(file)); } catch { showError('That photo could not be opened. Try another one.'); }
      photoBusy--;
    }
    ui.estMessage = '';
    render();
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

  async function quickStart() {
    const text = ui.quickText.trim();
    if (!text) { ui.quickError = 'Say or type what is left first.'; return render(); }
    stopMic();
    ui.quickError = '';
    const r = await act('POST', '/api/quick', { text }, { quiet: true, missing: 'Quick start is not available on this server yet. Use “Set it up step by step” below.' });
    if (!r.ok) { ui.quickError = r.message || 'That did not work. Please try again.'; saveUi(); return render(); }
    const snap = r.data || state;
    ui.quick = { eventId: snap?.event?.id || event()?.id || null, said: text, summary: quickSummary(r.data?.quick?.understood, snap) };
    ui.agentDone = true; ui.newEvent = false; ui.stepByStep = false; ui.quickText = '';
    saveUi();
    render();
    const thread = slot('thread');
    thread.scrollTop = thread.scrollHeight;
  }

  function stopMic() { if (listening) { try { listening.stop(); } catch { /* already stopped */ } } }
  function toggleMic() {
    if (!Speech) return;
    if (listening) { stopMic(); return; }
    const rec = new Speech();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false; // stops on its own after a pause
    const before = ui.quickText.trim();
    rec.onresult = (e) => {
      let said = '';
      for (let k = 0; k < e.results.length; k++) said += e.results[k][0].transcript;
      ui.quickText = [before, said.trim()].filter(Boolean).join(' ');
      const box = root.querySelector('[data-f="quick"]');
      if (box) box.value = ui.quickText;
      const start = root.querySelector('[data-act="quickStart"]');
      if (start) start.disabled = busy || !ui.quickText.trim();
    };
    rec.onerror = (e) => {
      ui.quickError = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'The microphone is blocked. Allow it in your browser, or type what is left.'
        : e.error === 'no-speech' ? 'I did not hear anything. Tap the mic and try again, or type it.' : 'The mic stopped. Type what is left instead.';
    };
    rec.onend = () => { listening = null; saveUi(); render(); };
    try { rec.start(); listening = rec; ui.quickError = ''; } catch { listening = null; ui.quickError = 'The mic could not start. Type what is left instead.'; }
    render();
  }

  async function reset() {
    asks = [];
    const r = await act('POST', '/api/demo/reset', {});
    if (r.ok) { ui = freshUi(); photos = []; threadHtml = ''; agentError = ''; forms = freshForms(); try { sessionStorage.removeItem('rc-ui'); } catch { /* ok */ } render(); }
  }

  // Team and places: messages show inside the panel, never as fake success.
  const panelSay = (msg, ok) => {
    forms.msg = msg; forms.ok = ok;
    setTimeout(() => { // the panel can be long: bring the message into view
      const el = Array.from(root.querySelectorAll('.rc-panel > [role="status"]')).find((x) => x.offsetParent !== null);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 30);
  };
  async function panelAct(method, path, body, missing, done) {
    const r = await act(method, path, body, { quiet: true, missing });
    if (r.ok) { panelSay(done, true); } else panelSay(r.message || 'That did not work. Please try again.', false);
    render();
    return r.ok;
  }
  async function saveVolunteer(editing) {
    const f = editing ? forms.volEdit : forms.vol;
    const name = String(f.name || '').trim();
    if (!name) { panelSay('Add a name.', false); return render(); }
    const body = { name };
    if (String(f.phone || '').trim()) {
      if (!phoneOk(f.phone)) { panelSay(PHONE_HELP, false); return render(); }
      body.phone = String(f.phone).trim();
    }
    if (editing) {
      body.optedIn = Boolean(f.optedIn);
      const ok = await panelAct('PATCH', `/api/volunteers/${encodeURIComponent(f.id)}`, body, 'This server cannot edit volunteers yet.', `Saved ${name}.`);
      if (ok) {
        forms.volEdit = null;
        if (forms.backToCall) { forms.backToCall = false; forms.msg = ''; view = null; } // straight back to the Call button
        render();
      }
    } else {
      const ok = await panelAct('POST', '/api/volunteers', body, 'This server cannot add volunteers yet.', `Added ${name} to the team.`);
      if (ok) { forms.vol = { name: '', phone: '' }; render(); }
    }
  }
  function placeBody(f) {
    const name = String(f.name || '').trim();
    const distanceMiles = Number(f.distanceMiles);
    const capacity = Number(f.capacity);
    if (!name) return 'Add a name for the place.';
    if (!PLACE_TYPES.includes(f.type)) return 'Pick a type.';
    if (String(f.distanceMiles).trim() === '' || !Number.isFinite(distanceMiles) || distanceMiles < 0) return 'Enter the distance in miles, for example 3.';
    if (!Number.isInteger(capacity) || capacity < 1) return 'Enter how many portions the place can take, for example 120.';
    if (!f.accepts.length) return 'Pick at least one kind of food the place accepts.';
    const body = { name, type: f.type, distanceMiles, capacity, accepts: [...f.accepts] };
    if (String(f.address || '').trim()) body.address = String(f.address).trim();
    return body;
  }
  async function savePlace(editing) {
    const f = editing ? forms.placeEdit : forms.place;
    const body = placeBody(f);
    if (typeof body === 'string') { panelSay(body, false); return render(); }
    if (editing) {
      const ok = await panelAct('PATCH', `/api/places/${encodeURIComponent(f.id)}`, body, 'This server cannot edit places yet.', `Saved ${body.name}.`);
      if (ok) { forms.placeEdit = null; render(); }
    } else {
      const ok = await panelAct('POST', '/api/places', body, 'This server cannot add places yet.', `Added ${body.name}.`);
      if (ok) { forms.place = blankPlace(); render(); }
    }
  }
  function openView(next, editId) {
    view = next;
    forms.msg = '';
    forms.confirm = null;
    forms.backToCall = Boolean(editId);
    if (next === 'team' && editId) {
      const v = volOf(editId);
      if (v) forms.volEdit = { id: v.id, name: v.name, phone: '', optedIn: v.optedIn !== false };
    }
    render();
    if (editId) setTimeout(() => {
      const target = Array.from(root.querySelectorAll('[data-form="volEdit"][data-k="phone"]')).find((el) => el.offsetParent !== null);
      target?.focus();
    }, 30);
  }

  // ---- events -------------------------------------------------------------
  const onField = (ev) => {
    const t = ev.target;
    const f = t.dataset?.f;
    if (!f) return;
    const i = Number(t.dataset.i);
    if (f === 'draft') ui.draft[t.dataset.k] = t.value;
    else if (f === 'draft-item') ui.draft.items[i][t.dataset.k] = t.value;
    else if (f === 'manual') ui.manual[t.dataset.k] = t.value;
    else if (f === 'est' && ui.est) { const row = ui.est[i]; row[t.dataset.k] = t.value; row.edited = true; }
    else if (f === 'offer') ui.offerEdits[t.dataset.id] = t.value;
    else if (f === 'quick') {
      ui.quickText = t.value; ui.quickError = '';
      const start = root.querySelector('[data-act="quickStart"]');
      if (start) start.disabled = busy || !t.value.trim();
    }
    else if (f === 'form') {
      const target = forms[t.dataset.form];
      if (!target) return;
      if (t.dataset.k === 'accepts') target.accepts = t.checked ? [...new Set([...target.accepts, t.dataset.v])] : target.accepts.filter((x) => x !== t.dataset.v);
      else if (t.type === 'checkbox') target[t.dataset.k] = t.checked;
      else target[t.dataset.k] = t.value;
      return;
    }
    saveUi();
  };
  root.addEventListener('input', onField, { signal: lifecycle.signal });
  root.addEventListener('change', (ev) => { if (ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT') onField(ev); }, { signal: lifecycle.signal });
  root.addEventListener('focusout', () => { if (deferred) setTimeout(() => { if (!disposed && !typing(document.activeElement)) { deferred = false; render(); } }, 50); }, { signal: lifecycle.signal });

  root.addEventListener('click', async (ev) => {
    const button = ev.target.closest('[data-act], [data-ask]');
    if (!button || button.disabled) return;
    const a = button.dataset.act;
    const id = button.dataset.id;
    const i = Number(button.dataset.i);
    if (button.dataset.ask) {
      asks = [...asks, { kind: button.dataset.ask, at: Date.now() }].slice(-6);
      render();
      const thread = slot('thread');
      thread.scrollTop = thread.scrollHeight;
      return;
    }
    switch (a) {
      case 'demo': demoOpen = !demoOpen; render(); break;
      case 'sample': demoOpen = false; ui.draft = { ...SAMPLE_EVENT() }; await saveEvent(SAMPLE_EVENT()); break;
      case 'ff': demoOpen = false; await act('POST', '/api/demo/fast-forward', { minutes: 1 }); break;
      case 'reset': demoOpen = false; await reset(); break;
      case 'view': if (button.dataset.v === view && view === 'status') view = null; else openView(button.dataset.v); render(); break;
      case 'close': view = null; forms.volEdit = null; forms.placeEdit = null; forms.confirm = null; forms.msg = ''; render(); break;
      case 'addrow': ui.draft.items.push({ item: '', ordered: '' }); render(); break;
      case 'delrow': ui.draft.items.splice(i, 1); render(); break;
      case 'saveEvent': await saveEvent(ui.draft); break;
      case 'newEvent': ui.newEvent = true; ui.stepByStep = false; ui.draft = freshUi().draft; saveUi(); render(); break;
      case 'mic': toggleMic(); break;
      case 'quickStart': await quickStart(); break;
      case 'stepByStep': stopMic(); ui.stepByStep = true; saveUi(); render(); break;
      case 'quickPath': ui.stepByStep = false; saveUi(); render(); break;
      case 'cancelNew': ui.newEvent = false; saveUi(); render(); break;
      case 'chip': await agentSend(button.dataset.v || ''); break;
      case 'agentRetry': agentError = ''; await agentSend(''); break;
      case 'skipQs': ui.agentDone = true; ui.chips = []; saveUi(); render(); break;
      case 'takePhoto': slot('cam').click(); break;
      case 'pickPhoto': slot('gallery').click(); break;
      case 'rmPhoto': photos.splice(i, 1); render(); break;
      case 'estimate': await estimate(); break;
      case 'manualMode': ui.mode = 'manual'; ui.est = null; render(); break;
      case 'photoMode': ui.mode = 'photo'; ui.estMessage = ''; render(); break;
      case 'useManual': await useManual(); break;
      case 'useEst': await useEst(); break;
      case 'sendOffers': {
        const edits = proposed().map((o) => ({ id: o.id, portions: num(ui.offerEdits[o.id] ?? o.portions) }));
        const r = await act('POST', '/api/offers/send', { offers: edits });
        if (r.ok) { ui.offerEdits = {}; saveUi(); }
        break;
      }
      case 'accept': await act('POST', `/api/offers/${encodeURIComponent(id)}/respond`, { action: 'accept' }); break;
      case 'decline': await act('POST', `/api/offers/${encodeURIComponent(id)}/respond`, { action: 'decline' }); break;
      case 'pickup': await act('POST', `/api/offers/${encodeURIComponent(id)}/pickup`, {}); break;
      case 'dropoff': await act('POST', `/api/offers/${encodeURIComponent(id)}/dropoff`, {}); break;
      case 'call': {
        const vid = button.dataset.vid;
        ui.callNote[vid] = { ok: true, text: `Calling ${firstName(volOf(vid)?.name)}…` };
        const r = await act('POST', `/api/offers/${encodeURIComponent(id)}/call`, {}, { quiet: true, missing: 'Calling is not available on this server.' });
        ui.callNote[vid] = r.ok ? { ok: true, text: r.data?.message || 'Calling now.' } : { ok: false, text: r.message || 'The call did not go through.' };
        saveUi();
        render();
        break;
      }
      case 'addPhone': openView('team', id); break;
      case 'volAdd': await saveVolunteer(false); break;
      case 'volEdit': { const v = volOf(id); if (v) { forms.volEdit = { id, name: v.name, phone: '', optedIn: v.optedIn !== false }; forms.confirm = null; forms.msg = ''; } render(); break; }
      case 'volSave': await saveVolunteer(true); break;
      case 'volCancel': forms.volEdit = null; forms.msg = ''; render(); break;
      case 'volRm': forms.confirm = `v:${id}`; forms.msg = ''; render(); break;
      case 'volRmYes': { const name = volOf(id)?.name || 'The volunteer'; const ok = await panelAct('DELETE', `/api/volunteers/${encodeURIComponent(id)}`, {}, 'This server cannot remove volunteers yet.', `${name} was removed from the team.`); if (ok) forms.confirm = null; render(); break; }
      case 'placeAdd': await savePlace(false); break;
      case 'placeEdit': { const p = places().find((x) => x.id === id); if (p) { forms.placeEdit = { id, name: p.name || '', type: PLACE_TYPES.includes(p.type) ? p.type : 'shelter', distanceMiles: p.distanceMiles ?? '', capacity: p.capacity ?? '', accepts: [...(p.accepts || [])], address: p.address || '' }; forms.confirm = null; forms.msg = ''; } render(); break; }
      case 'placeSave': await savePlace(true); break;
      case 'placeCancel': forms.placeEdit = null; forms.msg = ''; render(); break;
      case 'placeRm': forms.confirm = `p:${id}`; forms.msg = ''; render(); break;
      case 'placeRmYes': { const name = places().find((x) => x.id === id)?.name || 'The place'; const ok = await panelAct('DELETE', `/api/places/${encodeURIComponent(id)}`, {}, 'This server cannot remove places yet.', `${name} was removed.`); if (ok) forms.confirm = null; render(); break; }
      case 'rmNo': forms.confirm = null; render(); break;
      case 'retry': showError(''); readState(); break;
      default: break;
    }
  }, { signal: lifecycle.signal });
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && view) { view = null; render(); } }, { signal: lifecycle.signal });
  slot('cam').addEventListener('change', (ev) => { addPhotos(ev.target.files); ev.target.value = ''; }, { signal: lifecycle.signal });
  slot('gallery').addEventListener('change', (ev) => { addPhotos(ev.target.files); ev.target.value = ''; }, { signal: lifecycle.signal });
  slot('composer').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (!event() || ui.newEvent) { showError('Add the event first, then you can post updates.'); return; }
    if (inDetails()) { input.value = ''; await agentSend(text); input.focus(); return; }
    const r = await act('POST', '/api/updates', { text });
    if (r.ok) { input.value = ''; const thread = slot('thread'); thread.scrollTop = thread.scrollHeight; }
  }, { signal: lifecycle.signal });

  render();
  readState();
  let stream = null;
  if (typeof EventSource !== 'undefined') {
    stream = new EventSource(apiBase + '/api/stream');
    stream.onopen = () => { streamConnected = true; tick(); };
    stream.onmessage = (ev) => {
      try { applyState(JSON.parse(ev.data)); showError(''); } catch { showError('A live update could not be read. Retrying.'); }
    };
    stream.onerror = () => { streamConnected = false; tick(); };
  }
  timers.push(setInterval(readState, 3000), setInterval(tick, 250));
  const onVisible = () => { if (!document.hidden) readState(); };
  document.addEventListener('visibilitychange', onVisible, { signal: lifecycle.signal });
  window.addEventListener('online', readState, { signal: lifecycle.signal });

  return () => {
    disposed = true;
    lifecycle.abort();
    timers.forEach(clearInterval);
    stream?.close();
    root.innerHTML = '';
  };
}
