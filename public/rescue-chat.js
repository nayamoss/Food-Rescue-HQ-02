// Rescue chat: the whole rescue as one thread (event, questions, photo, places, outreach, summary).
import { createMock } from '/mock-api.js'; // mock: demo stand-in, only used when an endpoint is missing (404)

const STAGES = ['event', 'details', 'photo', 'match', 'outreach', 'done'];
const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;
const AVATARS = [['#E3EDE8', '#40745C'], ['#F3E6DD', '#9A4F2B'], ['#E6E9F2', '#4A5678'], ['#F1ECD9', '#7A6420']];
const MAX_PHOTOS = 4;
const MAX_SIDE = 1600;
const STATUS_WORD = { offered: 'Asked', accepted: 'Accepted', declined: 'Declined', picked_up: 'On the way', dropped_off: 'Dropped off' };
const RAW_LOG = /(^|\s)[\w.-]+=\S|\b[a-z]+_[a-z]+\b|[{}[\]]|\b(undefined|null|NaN)\b|\b[0-9a-f]{8}-[0-9a-f]{4}\b|^(POST|GET|PATCH|PUT)\b|https?:\/\/|\+?\d[\d\s().-]{8,}\d/i;

const icon = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const TEMPLATE = `
<div class="rc" data-urg="idle" aria-busy="true">
  <aside class="rc-side" aria-label="Rescue and team">
    <div class="rc-brand"><span class="rc-logo">${icon.logo}</span>Food Rescue HQ</div>
    <p class="rc-label">Event</p>
    <div class="rc-chan"><div><b data-slot="chan-title">No event yet</b><small data-slot="chan-sub"></small></div></div>
    <p class="rc-label">Team</p>
    <ul class="rc-team" data-slot="team-side"></ul>
    <p class="rc-foot">Demo mode. Phone numbers stay private.</p>
  </aside>
  <main class="rc-main">
    <header class="rc-top">
      <div class="rc-brand rc-brand-m"><span class="rc-logo">${icon.logo}</span>Food Rescue HQ</div>
      <span class="rc-live" role="status"><i></i><span data-slot="live">Connecting to HQ</span></span>
      <button type="button" class="rc-btn rc-demo-btn" data-act="demo" aria-expanded="false">Demo</button>
    </header>
    <div class="rc-demo" data-slot="demo" hidden>
      <button type="button" class="rc-btn" data-act="sample">Sample event</button>
      <button type="button" class="rc-btn" data-act="ff">Fast-forward 1 minute</button>
      <button type="button" class="rc-btn" data-act="reset">Reset</button>
    </div>
    <button type="button" class="rc-pin" data-act="sheet" aria-expanded="false" aria-controls="rc-sheet">
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
    <div class="rc-sheet-head"><h2 id="rc-sheet-title">Rescue status</h2><button type="button" class="rc-btn" data-act="close">Close</button></div>
    <div data-slot="status-sheet"></div>
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
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function niceDate(value) {
  if (!value) return '';
  if (value === todayIso()) return 'Today';
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
const SAMPLE_EVENT = () => ({
  name: 'Conference lunch', venue: 'Main hall', date: todayIso(),
  items: [{ item: 'Tacos', ordered: 400 }, { item: 'Sandwiches', ordered: 20 }, { item: 'Chips', ordered: 10 }],
});
const freshUi = () => ({ draft: { name: '', venue: '', date: todayIso(), items: [{ item: '', ordered: '' }] }, qa: {}, confirmed: false, stageAt: {}, mode: 'photo', manual: {}, est: null, estMessage: '', phone: {}, phoneSaved: {}, offerEdits: {}, formError: '', eventId: null });

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
  let mock = null; // mock: set when a new endpoint is missing
  let photos = []; // data URLs, never persisted
  let photoBusy = 0;
  let estimating = false;
  let demoOpen = false;
  let deferred = false;
  let ui = freshUi();
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
  const OPEN = ['accepted', 'picked_up', 'dropped_off'];

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
    if (!event()) return 'event';
    const srv = state.journeyStep;
    if (!report()) return ui.confirmed || ['photo', 'match', 'outreach', 'done'].includes(srv) ? 'photo' : 'details';
    const r = remaining();
    if (srv === 'done' || (incident() && !isActiveInc()) || (r.left > 0 && r.rescued >= r.left) || r.left === 0) return 'done';
    return offers().some((o) => o.status !== 'proposed') ? 'outreach' : 'match';
  }
  function urgency() {
    const inc = incident();
    if (!inc || !report()) return 'idle';
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
      <button type="button" class="rc-btn" data-act="sample"${dis()}>Sample event</button></div></div>`;
  }
  const itemsLine = (list) => (list || []).map((i) => `${fmt(i.ordered)} ${esc(i.item)}`).join(', ');
  function eventSummary() {
    const e = event();
    return `<div class="rc-cardm"><h3>${esc(e.name)}</h3><p class="rc-line">${esc(e.venue)}${e.date ? ` · ${esc(niceDate(e.date))}` : ''}</p><p class="rc-line">Ordered: ${itemsLine(e.items)}</p></div>`;
  }

  const QUESTIONS = [
    { key: 'minutes', text: 'How long is the food good for?', opts: ['30', '45', '60'] },
    { key: 'pickup', text: 'Where should volunteers pick it up?' },
    { key: 'contact', text: 'Who should volunteers ask for on site? Type a name below.' },
  ];
  const currentQ = () => QUESTIONS.find((q) => ui.qa[q.key] === undefined) || null;
  function qaLabel(key) {
    const v = ui.qa[key];
    if (key === 'minutes') return `${v} minutes`;
    if (key === 'pickup') return v === event()?.venue ? `Use the venue (${v})` : String(v);
    return v === '' ? 'Skip for now' : String(v);
  }
  function understood(locked) {
    const e = event();
    const rows = [['Event', esc(e.name)], ['Venue', esc(e.venue)], ['Date', esc(niceDate(e.date))], ['Food', itemsLine(e.items)],
      ['Good for', `${esc(ui.qa.minutes)} minutes`], ['Pickup', esc(ui.qa.pickup)], ['Contact', ui.qa.contact ? esc(ui.qa.contact) : 'Not set']];
    return `<div class="rc-cardm"><h3>What I understood</h3>${rows.map(([k, v]) => `<p class="rc-kv"><span>${k}</span><b>${v}</b></p>`).join('')}
      ${locked ? '' : `<div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="looksRight"${dis()}>Looks right</button><button type="button" class="rc-btn" data-act="qaReset">Change answers</button></div>`}</div>`;
  }
  function detailsBlock(locked) {
    let html = '';
    const q = currentQ();
    for (const item of QUESTIONS) {
      if (ui.qa[item.key] === undefined) break;
      html += hqRow(bubble(esc(item.text))) + meRow(qaLabel(item.key));
    }
    if (!q) return html + hqRow(bubble('Here is what I understood. Does it look right?') + understood(locked));
    const opts = q.key === 'minutes' ? q.opts.map((m) => `<button type="button" class="rc-btn" data-act="qa" data-v="${m}"${dis()}>${m} minutes</button>`).join('')
      : q.key === 'pickup' ? `<button type="button" class="rc-btn" data-act="qa" data-v="${esc(event().venue)}"${dis()}>Use the venue (${esc(event().venue)})</button>`
      : `<button type="button" class="rc-btn" data-act="qa" data-v=""${dis()}>Skip for now</button>`;
    const hint = q.key === 'minutes' ? '' : '<p class="rc-hint">Or type your answer below.</p>';
    return html + hqRow(bubble(esc(q.text)) + `<div class="rc-opts">${opts}</div>${hint}`);
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

  function placesCard() {
    const list = offers().filter((o) => o.status === 'proposed');
    if (!list.length) return hqRow(bubble('I am matching the leftovers to places that can take them.'));
    const rows = list.map((o) => {
      const p = placeOf(o);
      const val = ui.offerEdits[o.id] ?? o.portions;
      return `<div class="rc-itemrow"><div class="rc-grow"><b>${esc(p?.name || 'Partner')}</b><p class="rc-line">${esc(p?.type || '')}${p?.distanceMiles != null ? ` · ${esc(p.distanceMiles)} mi away` : ''} · ${esc(o.item)}</p></div>
        <label class="rc-fld rc-qty"><span>Portions</span><input type="number" min="0" inputmode="numeric" data-f="offer" data-id="${esc(o.id)}" value="${esc(val)}"></label></div>`;
    }).join('');
    return hqRow(bubble('These places can take the food. Change the portions if you need to.') + `<div class="rc-cardm">${rows}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="sendOffers"${dis()}>Approve and reach out</button></div></div>`);
  }

  function chipFor(o, v) {
    return o ? (STATUS_WORD[o.status] || 'Asked') : (v?.optedIn === false ? 'Not opted in' : 'Ready');
  }
  function outreachCard() {
    const rows = volunteers().map((v) => {
      const mine = offers().filter((o) => o.volunteerId === v.id && o.status !== 'proposed');
      const o = mine[mine.length - 1];
      const p = o && placeOf(o);
      const b = (act, label) => `<button type="button" class="rc-btn rc-sm" data-act="${act}" data-id="${esc(o.id)}"${dis()}>${label}</button>`;
      const demo = !o ? '' : o.status === 'offered' ? b('accept', 'Accept') + b('decline', 'Decline')
        : o.status === 'accepted' ? b('pickup', 'Mark picked up') : o.status === 'picked_up' ? b('dropoff', 'Mark dropped off') : '';
      const saved = ui.phoneSaved[v.id];
      return `<div class="rc-vol"><div class="rc-volhead">${avatarHtml({ name: v.name, vol: v })}<div class="rc-grow"><b>${esc(v.name)}</b>
          <p class="rc-line">${o ? `${fmt(o.portions)} ${esc(o.item)} to ${esc(p?.name || 'a partner')}` : 'No ask yet'}</p></div><span class="rc-stt ${o ? esc(o.status) : ''}">${chipFor(o, v)}</span></div>
        <div class="rc-phone"><label class="rc-fld rc-grow"><span>1. Phone number for ${esc(v.name)}</span><input type="tel" autocomplete="off" data-f="phone" data-id="${esc(v.id)}" value="${esc(ui.phone[v.id] || '')}" placeholder="+15551234567"></label>
        <button type="button" class="rc-btn rc-sm" data-act="savePhone" data-id="${esc(v.id)}"${dis()}>Save phone</button></div>
        ${saved ? '<p class="rc-hint">Saved. It is kept private.</p>' : ''}
        ${o && ['offered', 'accepted'].includes(o.status) ? `<div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="call" data-id="${esc(o.id)}" data-vid="${esc(v.id)}"${dis()}>2. Call ${esc(v.name.split(' ')[0])} now</button></div>` : ''}
        ${(ui.callNote || {})[v.id] ? `<p class="rc-hint">${esc(ui.callNote[v.id])}</p>` : ''}
        ${demo ? `<div class="rc-actions">${demo}</div>` : ''}</div>`;
    }).join('');
    return hqRow(bubble('Reaching out to volunteers. Add a phone number, then tap Call now. They hear the offer and press 1 to accept, or 2 to decline.') + `<div class="rc-cardm">${rows}</div>`);
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
    const urg = urgency();
    const line = urg === 'done' ? 'Everything that was left found a home.' : 'The window closed. Here is how it went.';
    return hqRow(bubble(line) + `<div class="rc-cardm"><h3>Rescue summary</h3>
      ${[['Ordered', d.ordered], ['Eaten', d.eaten], ['Left over', d.left], ['Rescued', d.rescued], ['Not rescued', d.notRescued]].map(([k, v]) => `<p class="rc-kv"><span>${k}</span><b>${fmt(v)}</b></p>`).join('')}
      ${d.by.length ? `<p class="rc-sub">Where it went</p>${d.by.map((p) => `<p class="rc-kv"><span>${esc(p.name)}</span><b>${fmt(p.n)}</b></p>`).join('')}` : ''}
      <div class="rc-actions"><button type="button" class="rc-btn rc-primary" data-act="reset"${dis()}>Start a new event</button></div></div>`);
  }

  function feedRow(entry) {
    const text = String(entry.text || '').trim();
    if (!text || RAW_LOG.test(text)) return '';
    const who = sender(entry);
    if (who.me) return `<div class="rc-row rc-me"><div class="rc-col"><div class="rc-who">You<time>${esc(clock(entry.at))}</time></div><div class="rc-bub me">${esc(text)}</div></div></div>`;
    return `<div class="rc-row">${avatarHtml(who)}<div class="rc-col"><div class="rc-who">${esc(who.name)}<time>${esc(clock(entry.at))}</time></div>${bubble(esc(text))}</div></div>`;
  }
  function answer(kind) {
    if (kind === 'free') {
      const busyIds = new Set(offers().filter((o) => ['offered', 'accepted', 'picked_up'].includes(o.status)).map((o) => o.volunteerId));
      const free = volunteers().filter((v) => v.optedIn !== false && !busyIds.has(v.id));
      return `<b>${free.length} free right now</b>` + volunteers().map((v) => {
        const o = offers().filter((x) => x.volunteerId === v.id && x.status !== 'proposed').pop();
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
    if (!event()) {
      blocks.event = hqRow(bubble('Hi, I am HQ. Add the event and what food was ordered, and I will help you rescue what is left.') + eventCard());
    } else {
      blocks.event = hqRow(bubble('Event saved.') + eventSummary());
      blocks.details = hqRow(bubble('A few quick questions.')) + detailsBlock(STAGES.indexOf(cur) > 1);
      if (visible.includes('photo')) blocks.photo = photoCard();
      if (visible.includes('match')) blocks.match = placesCard();
      if (visible.includes('outreach')) blocks.outreach = outreachCard();
      if (visible.includes('done')) blocks.done = summaryCard();
    }
    if (report() && blocks.photo) {
      const inc = incident();
      const qty = sum(report().items, (i) => i.left);
      const names = report().items.filter((i) => num(i.left) > 0).map((i) => `${fmt(i.left)} ${esc(i.item)}`).join(', ') || fmt(qty);
      blocks.photo += `<div class="rc-sys">Rescue started · ${names} at ${esc(event().venue)}${inc?.deadline ? ` · safe until ${esc(clock(inc.deadline))}` : ''}</div>`;
    }
    const keys = visible.filter((k) => blocks[k]);
    const place = (at) => { let hit = keys[0]; for (const k of keys) if ((ui.stageAt[k] || 0) <= at + 300) hit = k; return hit; };
    const extras = {};
    const pushExtra = (at, html) => { if (html) (extras[place(at)] ||= []).push({ at, html }); };
    for (const entry of state?.feed || []) pushExtra(Date.parse(entry.at) || 0, feedRow(entry));
    for (const ask of asks) {
      pushExtra(ask.at, meRow(ask.kind === 'free' ? 'Who’s free?' : 'What’s left?') + hqRow(ask.kind === 'free' ? `<div class="rc-bub rc-rich">${answer('free')}</div>` : bubble(answer(ask.kind))));
    }
    return keys.map((k) => blocks[k] + (extras[k] || []).sort((a, b) => a.at - b.at).map((x) => x.html).join('')).join('');
  }

  function renderThread() {
    const thread = slot('thread');
    const html = buildThread();
    if (html === threadHtml) return;
    const el = document.activeElement;
    if (el && thread.contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName)) { deferred = true; return; } // do not steal focus while typing
    deferred = false;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
    const keep = thread.scrollTop;
    threadHtml = html;
    thread.innerHTML = html;
    thread.scrollTop = nearBottom || !lastSuccess ? thread.scrollHeight : keep;
  }

  function renderQuick() {
    const e = event();
    const cur = state ? stage() : 'event';
    let chips = '';
    if (!e) chips = `<button type="button" class="rc-btn" data-act="sample"${dis()}>Sample event</button>`;
    else if (cur === 'details') {
      const q = currentQ();
      if (q?.key === 'minutes') chips = q.opts.map((m) => `<button type="button" class="rc-btn" data-act="qa" data-v="${m}"${dis()}>${m} minutes</button>`).join('');
    } else {
      chips = `<button type="button" class="rc-btn" data-ask="left">What’s left?</button><button type="button" class="rc-btn" data-ask="free">Who’s free?</button>` +
        `<button type="button" class="rc-btn" data-act="ff"${dis()}${isActiveInc() ? '' : ' disabled'}>Fast-forward</button>`;
    }
    slot('quick').innerHTML = chips;
    const q = e && cur === 'details' ? currentQ() : null;
    input.placeholder = q ? (q.key === 'pickup' ? 'Type a pickup location' : q.key === 'contact' ? 'Type a contact name' : 'Type the number of minutes') : 'Post an update to the team';
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
    const team = withTeam ? `<p class="rc-label">Team</p><ul class="rc-people">${volunteers().map((v) => {
      const o = offers().filter((x) => x.volunteerId === v.id && x.status !== 'proposed').pop();
      return `<li>${avatarHtml({ name: v.name, vol: v })}<b>${esc(v.name)}</b><span class="rc-stt">${chipFor(o, v)}</span></li>`;
    }).join('')}</ul>` : '';
    const inc = incident();
    const sub = urg === 'done' ? 'all rescued' : urg === 'ended' ? 'time ran out' : urg === 'idle' ? 'no rescue yet' : `left · safe till ${clock(inc?.deadline)}`;
    const venue = event()?.venue ? `<p class="rc-lead">${esc(event().venue)}</p>` : '';
    const dot = (c) => `<i style="background:${c}"></i>`;
    return `<div class="rc-card"><div class="rc-ringbox">${ring(150, 16)}<span class="rc-ring-mid"><b data-t="timer">${timerText()}</b><small>${sub}</small></span></div>
      <h3>${title}</h3>${venue}<p class="rc-lead">${lead}</p>${bar}</div>
      <div class="rc-legend"><div><b>${fmt(r.rescued)}</b><span>${dot('var(--green)')}Rescued</span></div><div><b>${fmt(r.onWay)}</b><span>${dot('var(--purple)')}On the way</span></div><div><b>${fmt(r.need)}</b><span>${dot('var(--orange)')}Unclaimed</span></div></div>${team}<div class="rc-demo rc-demo-row"><span>Demo</span><button type="button" class="rc-btn rc-sm" data-act="sample">Create sample</button><button type="button" class="rc-btn rc-sm" data-act="ff">Fast-forward</button><button type="button" class="rc-btn rc-sm" data-act="reset">Reset</button></div>`;
  }

  function render() {
    if (disposed) return;
    app.setAttribute('aria-busy', state ? 'false' : 'true');
    const e = event();
    if ((e?.id || null) !== ui.eventId) {
      const first = ui.eventId === null && e && !ui.confirmed && !Object.keys(ui.qa).length;
      ui.eventId = e?.id || null;
      if (!first || !e) { ui.qa = {}; ui.confirmed = false; ui.mode = 'photo'; ui.manual = {}; ui.est = null; ui.estMessage = ''; ui.stageAt = {}; ui.offerEdits = {}; photos = []; asks = []; }
      saveUi();
    }
    slot('chan-title').textContent = e ? e.name : 'No event yet';
    slot('chan-sub').textContent = e ? `${e.venue}${e.date ? ` · ${niceDate(e.date)}` : ''}` : 'Add one to begin';
    slot('team-side').innerHTML = volunteers().map((v) => {
      const o = offers().filter((x) => x.volunteerId === v.id && x.status !== 'proposed').pop();
      return `<li>${avatarHtml({ name: v.name, vol: v })}<span>${esc(v.name)}</span><span class="rc-stt">${chipFor(o, v)}</span></li>`;
    }).join('');
    const r = remaining();
    slot('pin-sub').textContent = !e ? 'No event yet' : !report() ? e.name : `${fmt(r.need)} unclaimed · ${fmt(r.rescued)} rescued`;
    slot('status-desk').innerHTML = statusHtml(false);
    slot('status-sheet').innerHTML = statusHtml(true);
    slot('demo').hidden = !demoOpen;
    root.querySelector('[data-act="demo"]').setAttribute('aria-expanded', String(demoOpen));
    root.querySelector('[data-act="ff"]').disabled = !isActiveInc() || busy;
    root.querySelector('.rc-composer button').disabled = busy || !state;
    renderThread();
    renderQuick();
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
    const fraction = urg === 'done' ? 1 : urg === 'ended' || urg === 'idle' ? 0 : secondsLeft() / windowSeconds();
    root.querySelectorAll('[data-t="timer"]').forEach((el) => { el.textContent = text; });
    root.querySelectorAll('[data-t="ring"]').forEach((el) => el.setAttribute('stroke-dashoffset', (RING_C * (1 - Math.min(1, fraction))).toFixed(2)));
    const recent = lastSuccess && Date.now() - lastSuccess < 10000;
    slot('live').textContent = mock ? 'Demo' : streamConnected ? 'Live' : recent ? 'Connected' : lastSuccess ? 'Reconnecting' : 'Connecting to HQ';
    root.querySelector('.rc-live').classList.toggle('on', Boolean(mock || streamConnected || recent));
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
    if (mock) {
      const res = mock.handle(method, path, body);
      return { ok: res.status < 400, status: res.status, data: res.json };
    }
    const res = await fetch(apiBase + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: AbortSignal.any([AbortSignal.timeout(method === 'POST' && path === '/api/estimate' ? 45000 : 12000), lifecycle.signal]),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    const missing = res.status === 404 && (!data || data.error === 'Endpoint not found.');
    if (missing && state) { // mock: the backend does not have this endpoint yet
      mock = createMock(state);
      const out = mock.handle(method, path, body);
      return { ok: out.status < 400, status: out.status, data: out.json };
    }
    return { ok: res.ok, status: res.status, data };
  }

  async function readState() {
    if (readPending || busy || disposed || mock) return;
    readPending = true;
    const start = revision;
    try {
      const res = await call('GET', '/api/state');
      if (!res.ok) throw new Error(`Could not load HQ updates (${res.status}).`);
      if (start === revision && !busy && !mock) applyState(res.data);
      lastSuccess = Date.now();
      showError('');
    } catch (error) {
      if (disposed) return;
      if (!streamConnected) showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Unable to reach HQ. Check your connection and retry.' : error.message);
    } finally {
      readPending = false;
    }
  }

  // Runs an action against the API. Returns {ok, data}. Errors become plain-language messages.
  async function act(method, path, body, { quiet } = {}) {
    if (busy || disposed) return { ok: false };
    busy = true;
    revision++;
    render();
    showError('');
    try {
      const res = await call(method, path, body);
      if (!res.ok) {
        const msg = res.status === 404 ? 'HQ cannot do that yet. Please try again later.' : (typeof res.data?.error === 'string' ? res.data.error : `That did not work (${res.status}). Please try again.`);
        if (!quiet) showError(msg);
        return { ok: false, data: res.data, message: msg };
      }
      busy = false;
      if (res.data && Array.isArray(res.data.volunteers)) applyState(res.data);
      return { ok: true, data: res.data };
    } catch (error) {
      const msg = error.name === 'TimeoutError' || error instanceof TypeError ? 'Could not reach HQ. Check your connection and try again.' : error.message;
      if (!quiet) showError(msg);
      return { ok: false, message: msg };
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }

  // ---- actions ------------------------------------------------------------
  async function saveEvent(payload) {
    const items = payload.items.filter((i) => String(i.item).trim()).map((i) => ({ item: String(i.item).trim(), ordered: num(i.ordered) }));
    if (!String(payload.name).trim()) { ui.formError = 'Give the event a name.'; return render(); }
    if (!String(payload.venue).trim()) { ui.formError = 'Add the venue.'; return render(); }
    if (!items.length || items.some((i) => i.ordered < 1)) { ui.formError = 'Add at least one food item with a quantity.'; return render(); }
    ui.formError = '';
    const r = await act('POST', '/api/event', { name: String(payload.name).trim(), venue: String(payload.venue).trim(), date: payload.date, items });
    if (r.ok) { ui = { ...freshUi(), eventId: ui.eventId }; ui.stageAt = {}; photos = []; asks = []; saveUi(); render(); }
  }
  async function answerQ(value) {
    const q = currentQ();
    if (!q) return;
    let v = String(value).trim();
    if (q.key === 'minutes') {
      const n = parseInt(v, 10);
      if (!n || n < 5 || n > 600) { showError('Tell me how many minutes, for example 45.'); return; }
      v = String(n);
    }
    ui.qa[q.key] = v;
    saveUi();
    const patch = q.key === 'minutes' ? { goodForMinutes: Number(v) } : q.key === 'pickup' ? { notes: `Pickup: ${v}` } : { contact: v };
    render();
    await act('PATCH', '/api/event', patch);
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
    try { res = await call('POST', '/api/estimate', { images: photos, dataUrls: photos, items: event().items }); }
    catch (error) { res = { ok: false, data: { failed: true } }; }
    estimating = false;
    const d = res.data || {};
    const failedText = 'I could not read the photos. Count what is left by hand instead.';
    if (!res.ok || d.notConfigured || d.failed || d.unreadable || !Array.isArray(d.items) || !d.items.length) {
      ui.estMessage = d.message || (res.status === 404 ? 'Photo estimates are not available yet. Count what is left by hand.' : d.notConfigured ? 'Photo estimates are not set up yet. Count what is left by hand.' : failedText);
      ui.mode = 'manual';
    } else {
      ui.est = d.items.map((i) => ({ item: i.item, count: num(i.count), unit: i.unit || 'portions', confidence: String(i.confidence || 'medium'), orig: num(i.count), edited: false }));
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

  async function reset() {
    asks = [];
    const r = await act('POST', '/api/demo/reset', {});
    if (r.ok) { ui = freshUi(); photos = []; threadHtml = ''; try { sessionStorage.removeItem('rc-ui'); } catch { /* ok */ } render(); }
  }

  function setSheet(open) {
    sheet.hidden = !open;
    scrim.hidden = !open;
    pin.setAttribute('aria-expanded', String(open));
  }

  // ---- events -------------------------------------------------------------
  root.addEventListener('input', (ev) => {
    const t = ev.target;
    const f = t.dataset?.f;
    if (!f) return;
    const i = Number(t.dataset.i);
    if (f === 'draft') ui.draft[t.dataset.k] = t.value;
    else if (f === 'draft-item') ui.draft.items[i][t.dataset.k] = t.value;
    else if (f === 'manual') ui.manual[t.dataset.k] = t.value;
    else if (f === 'est' && ui.est) { const row = ui.est[i]; row[t.dataset.k] = t.value; row.edited = true; }
    else if (f === 'offer') ui.offerEdits[t.dataset.id] = t.value;
    else if (f === 'phone') ui.phone[t.dataset.id] = t.value;
    saveUi();
  }, { signal: lifecycle.signal });
  root.addEventListener('focusout', () => { if (deferred) setTimeout(() => { if (!disposed && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) render(); }, 50); }, { signal: lifecycle.signal });

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
      case 'sample': demoOpen = false; await saveEvent(SAMPLE_EVENT()); break;
      case 'ff': demoOpen = false; await act('POST', '/api/demo/fast-forward', { minutes: 1 }); break;
      case 'reset': demoOpen = false; await reset(); break;
      case 'addrow': ui.draft.items.push({ item: '', ordered: '' }); render(); break;
      case 'delrow': ui.draft.items.splice(i, 1); render(); break;
      case 'saveEvent': await saveEvent(ui.draft); break;
      case 'qa': await answerQ(button.dataset.v ?? ''); break;
      case 'qaReset': ui.qa = {}; saveUi(); render(); break;
      case 'looksRight': ui.confirmed = true; saveUi(); render(); break;
      case 'takePhoto': slot('cam').click(); break;
      case 'pickPhoto': slot('gallery').click(); break;
      case 'rmPhoto': photos.splice(i, 1); render(); break;
      case 'estimate': await estimate(); break;
      case 'manualMode': ui.mode = 'manual'; ui.est = null; render(); break;
      case 'photoMode': ui.mode = 'photo'; ui.estMessage = ''; render(); break;
      case 'useManual': await useManual(); break;
      case 'useEst': await useEst(); break;
      case 'sendOffers': {
        const edits = offers().filter((o) => o.status === 'proposed').map((o) => ({ id: o.id, portions: num(ui.offerEdits[o.id] ?? o.portions) }));
        const r = await act('POST', '/api/offers/send', { offers: edits });
        if (r.ok) { ui.offerEdits = {}; saveUi(); }
        break;
      }
      case 'accept': await act('POST', `/api/offers/${encodeURIComponent(id)}/respond`, { action: 'accept' }); break;
      case 'decline': await act('POST', `/api/offers/${encodeURIComponent(id)}/respond`, { action: 'decline' }); break;
      case 'pickup': await act('POST', `/api/offers/${encodeURIComponent(id)}/pickup`, {}); break;
      case 'dropoff': await act('POST', `/api/offers/${encodeURIComponent(id)}/dropoff`, {}); break;
      case 'savePhone': {
        const phone = String(ui.phone[id] || '').trim();
        if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) { showError('Enter a phone number with the country code, for example +15551234567.'); break; }
        const r = await act('POST', `/api/volunteers/${encodeURIComponent(id)}/phone`, { phone: phone.replace(/[^\d+]/g, '') });
        if (r.ok) { ui.phone[id] = ''; ui.phoneSaved[id] = true; saveUi(); render(); }
        break;
      }
      case 'call': {
        const vid = button.dataset.vid;
        ui.callNote = ui.callNote || {};
        const r = await act('POST', `/api/offers/${encodeURIComponent(id)}/call`, {});
        ui.callNote[vid] = r.ok ? (r.data?.message || 'Calling now.') : (r.message || 'The call did not go through.');
        render();
        break;
      }
      case 'retry': showError(''); readState(); break;
      case 'sheet': setSheet(sheet.hidden); break;
      case 'close': setSheet(false); break;
      default: break;
    }
  }, { signal: lifecycle.signal });
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !sheet.hidden) setSheet(false); }, { signal: lifecycle.signal });
  slot('cam').addEventListener('change', (ev) => { addPhotos(ev.target.files); ev.target.value = ''; }, { signal: lifecycle.signal });
  slot('gallery').addEventListener('change', (ev) => { addPhotos(ev.target.files); ev.target.value = ''; }, { signal: lifecycle.signal });
  slot('composer').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (state && event() && stage() === 'details' && currentQ()) { input.value = ''; await answerQ(text); return; }
    if (!event()) { showError('Add the event first, then you can post updates.'); return; }
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
      if (mock) return;
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
