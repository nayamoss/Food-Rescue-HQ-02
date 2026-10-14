// Rescue chat: the whole rescue as one thread, shared by the root dashboard and the /food-rescue-hq/ app.
const SAMPLE = { food: 'tacos', total: 400, location: 'Main hall', minutes: 45 };
const DEFAULT_WINDOW = SAMPLE.minutes * 60;
const AVATARS = [['#FFD8C7', '#B23A0B'], ['#E2DAFF', '#5536CF'], ['#CFF0E1', '#0B7A50'], ['#FFE7A6', '#8A5A00'], ['#EADFE6', '#76667F']];
const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;
const CHIP = { idle: 'All clear', calm: 'Rescue open', warn: 'Hurry up', crit: 'Last minutes', done: 'Rescued', ended: 'Ended' };

const icon = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

const TEMPLATE = `
<div class="rc" data-urg="idle" aria-busy="true">
  <aside class="rc-side" aria-label="Rescue and team">
    <div class="rc-brand"><span class="rc-logo">${icon.logo}</span>Food Rescue HQ</div>
    <p class="rc-label">Rescue</p>
    <div class="rc-chan"><span class="rc-chan-icon">${icon.clock}</span><div><b data-slot="chan-title">Checking the kitchen…</b><small data-slot="chan-sub"></small></div></div>
    <p class="rc-label">Team</p>
    <ul class="rc-team" data-slot="team-side"></ul>
    <p class="rc-foot">Demo mode. No texts are sent.</p>
  </aside>
  <main class="rc-main">
    <header class="rc-top">
      <div class="rc-brand rc-brand-m"><span class="rc-logo">${icon.logo}</span>Food Rescue HQ</div>
      <span class="rc-live" role="status"><i></i><span data-slot="live">Connecting to HQ</span></span>
    </header>
    <button type="button" class="rc-pin" data-act="sheet" aria-expanded="false" aria-controls="rc-sheet">
      ${ring(40, 26)}
      <span class="rc-pin-txt"><b data-t="timer">--:--</b><small data-slot="pin-sub">Getting the latest</small></span>
      <span class="rc-chip" data-slot="chip">All clear</span>
      <span class="rc-pin-open">${icon.up}<span class="rc-sr">Show rescue status</span></span>
    </button>
    <div class="rc-error" role="alert" hidden><span data-slot="error"></span><button type="button" data-act="retry">Retry</button></div>
    <div class="rc-thread" data-slot="thread" role="log" aria-label="Rescue updates" tabindex="0"></div>
    <div class="rc-quick" data-slot="quick" aria-label="Quick replies"></div>
    <form class="rc-composer" data-slot="composer">
      <label class="rc-sr" for="rc-text">Post an update to the team</label>
      <input id="rc-text" name="text" maxlength="280" autocomplete="off" placeholder="Post an update to the team">
      <button type="submit" aria-label="Post update">${icon.send}</button>
    </form>
    <p class="rc-note">Updates appear in this thread. Texting volunteers comes later.</p>
  </main>
  <aside class="rc-status" aria-label="Rescue status" data-slot="status-desk"></aside>
  <div class="rc-scrim" data-act="close" hidden></div>
  <section class="rc-sheet" id="rc-sheet" role="dialog" aria-modal="true" aria-labelledby="rc-sheet-title" hidden>
    <div class="rc-grab" aria-hidden="true"></div>
    <div class="rc-sheet-head"><h2 id="rc-sheet-title">Rescue status</h2><button type="button" class="rc-x" data-act="close" aria-label="Close status">${icon.close}</button></div>
    <div data-slot="status-sheet"></div>
  </section>
</div>`;

function ring(size, stroke, inner = '') {
  return `<span class="rc-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 200 200" aria-hidden="true">` +
    `<circle class="rc-ring-track" cx="100" cy="100" r="${RING_R}" fill="none" stroke-width="${stroke}"/>` +
    `<circle class="rc-ring-fill" data-t="ring" cx="100" cy="100" r="${RING_R}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/></svg>${inner}</span>`;
}
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (value) => Math.max(0, Number(value) || 0);
const fmt = (value) => num(value).toLocaleString();
const initials = (name) => String(name || 'V').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

export function mountRescueChat(root, { apiBase = '' } = {}) {
  const api = (path) => apiBase + path;
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
  let incidentId = null;
  let threadHtml = '';
  let lastUrg = null;

  root.innerHTML = TEMPLATE;
  const app = root.querySelector('.rc');
  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
  const pin = root.querySelector('.rc-pin');
  const sheet = root.querySelector('.rc-sheet');
  const scrim = root.querySelector('.rc-scrim');
  const input = root.querySelector('#rc-text');

  const incident = () => state?.incident || null;
  const isActive = () => Boolean(incident() && ['open', 'in_progress'].includes(incident().status));
  const secondsLeft = () => {
    const deadline = Date.parse(incident()?.deadline);
    return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
  };
  // The original window, so a demo fast-forward shows an almost empty ring.
  const windowSeconds = () => Math.max(num(incident()?.windowSeconds) || DEFAULT_WINDOW, secondsLeft(), 1);
  function urgency() {
    const inc = incident();
    if (!inc) return 'idle';
    if (inc.status === 'resolved') return 'done';
    if (!isActive()) return 'ended';
    const s = secondsLeft();
    return s <= 300 ? 'crit' : s <= 900 ? 'warn' : 'calm';
  }
  const chipText = () => (incident()?.status === 'cancelled' ? 'Cancelled' : CHIP[urgency()]);
  const timerText = () => {
    if (!incident()) return '--:--';
    const s = secondsLeft();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function people() {
    const assignments = incident()?.assignments || [];
    return (state?.volunteers || []).map((volunteer, index) => {
      const a = assignments.find((item) => String(item.volunteerId) === String(volunteer.id));
      const claimed = num(a?.claimed);
      const pickedUp = num(a?.pickedUp);
      const status = claimed > 0 && pickedUp >= claimed ? 'Picked up' : pickedUp > 0 ? 'Picking up' : claimed > 0 ? 'Claimed' : volunteer.optedIn ? 'Ready' : 'Not opted in';
      return { name: String(volunteer.name || 'Volunteer'), optedIn: Boolean(volunteer.optedIn), claimed, pickedUp, status, index };
    });
  }
  const statusClass = (status) => ({ 'Picked up': 'done', 'Picking up': 'go', Claimed: 'claimed' }[status] || '');
  const avatar = (p, small) => {
    const [bg, fg] = AVATARS[p.index % AVATARS.length];
    return `<span class="rc-av${small ? ' rc-av-s' : ''}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initials(p.name))}</span>`;
  };

  function headline() {
    const inc = incident();
    const t = state?.totals || {};
    const food = esc(inc?.food || 'portions');
    if (!inc) {
      const ready = people().filter((p) => p.optedIn).length;
      return ['All clear', `No surplus food reported. ${ready} volunteers are standing by.`];
    }
    if (inc.status === 'resolved') return ['Every portion rescued', `${fmt(t.rescued)} ${food} picked up.`];
    if (!isActive()) return [`${fmt(num(t.total) - num(t.rescued))} ${food} didn’t make it`, `${fmt(t.rescued)} of ${fmt(t.total)} rescued. Reset to start again.`];
    if (num(t.unclaimed) > 0) return [`${fmt(t.unclaimed)} ${food} still need a home`, `${esc(inc.location)} · safe until ${clock(inc.deadline)}`];
    return [`${fmt(t.claimed)} ${food} on their way out`, 'Everything is claimed. Waiting on pickups.'];
  }

  function demoButtons() {
    const off = (cond) => (cond ? ' disabled' : '');
    return `<div class="rc-demo"><span>Demo</span>` +
      `<button type="button" data-act="create"${off(!state || busy || isActive())}>Create sample incident</button>` +
      `<button type="button" data-act="ff"${off(!state || busy || !isActive())}>Fast-forward</button>` +
      `<button type="button" data-act="reset"${off(!state || busy)}>Reset</button></div>`;
  }

  function statusHtml(withTeam) {
    const t = state?.totals || {};
    const inc = incident();
    const [title, lead] = headline();
    const ended = inc && !isActive();
    const lost = num(t.total) - num(t.rescued) - num(t.claimed);
    const bar = inc
      ? `<div class="rc-segs" role="img" aria-label="${fmt(t.rescued)} rescued, ${fmt(t.claimed)} on the way, ${fmt(ended ? lost : t.unclaimed)} ${ended ? 'lost' : 'unclaimed'}"><i style="flex:${num(t.rescued)};background:var(--mint)"></i><i style="flex:${num(t.claimed)};background:var(--violet)"></i><i style="flex:${ended ? lost : num(t.unclaimed)};background:${ended ? 'var(--lost)' : 'var(--chili)'}"></i></div>`
      : '<div class="rc-segs" aria-hidden="true"><i style="flex:1;background:var(--track)"></i></div>';
    const team = withTeam ? `<p class="rc-label">Team</p><ul class="rc-people">${people().map((p) =>
      `<li class="${p.optedIn ? '' : 'rc-off'}">${avatar(p)}<div><b>${esc(p.name)}</b><small>${p.claimed ? `${fmt(p.claimed)} claimed · ${fmt(p.pickedUp)} picked up` : p.optedIn ? 'Free to help' : 'Hasn’t opted in to texts'}</small></div><span class="rc-stt ${statusClass(p.status)}">${p.status}</span></li>`).join('')}</ul>` : '';
    return `<div class="rc-card">${ring(170, 16, `<span class="rc-ring-mid"><b data-t="timer">${timerText()}</b><small data-slot-live="ring-label">${ringLabel()}</small></span>`)}` +
      `<div><h3>${title}</h3><p class="rc-lead">${lead}</p></div>${bar}` +
      `<div class="rc-legend"><div><b>${fmt(t.rescued)}</b><span><i style="background:var(--mint)"></i>Rescued</span></div><div><b>${fmt(t.claimed)}</b><span><i style="background:var(--violet)"></i>On the way</span></div><div><b>${fmt(ended ? lost : t.unclaimed)}</b><span><i style="background:var(--chili)"></i>${ended ? 'Lost' : 'Unclaimed'}</span></div></div></div>` +
      team + demoButtons();
  }
  const ringLabel = () => {
    const inc = incident();
    if (!inc) return 'nothing ticking';
    if (inc.status === 'resolved') return 'all rescued';
    if (!isActive()) return 'window closed';
    return `left · safe till ${clock(inc.deadline)}`;
  };

  function answer(kind) {
    const t = state?.totals || {};
    const inc = incident();
    if (kind === 'free') {
      const list = people();
      const free = list.filter((p) => p.optedIn && p.claimed === 0).length;
      return `<b>${free} free right now</b>` + list.map((p) => `<div class="rc-li">${avatar(p, true)}<span>${esc(p.name)}</span><span class="rc-stt ${statusClass(p.status)}">${p.status}</span></div>`).join('');
    }
    if (!inc) return 'Nothing to rescue right now. Start a sample rescue to see how it works.';
    const food = esc(inc.food);
    if (!isActive()) return `${fmt(t.rescued)} of ${fmt(t.total)} ${food} were rescued. ${fmt(num(t.total) - num(t.rescued))} didn’t make it.`;
    return `${fmt(t.unclaimed)} ${food} still need a taker, ${fmt(t.claimed)} are on the way and ${fmt(t.rescued)} are picked up. ${timerText()} left.`;
  }

  function feedItem(entry) {
    const text = String(entry.text || '');
    const kind = entry.kind || (text.startsWith('Incident opened') ? 'incident' : text.startsWith('Demo') ? 'demo' : text.startsWith('Safety window') ? 'expired' : text.startsWith('All food rescued') ? 'resolved' : 'system');
    const time = clock(entry.at);
    if (kind === 'update') return `<div class="rc-msg rc-me"><div class="rc-who">You<time datetime="${esc(entry.at)}">${time}</time></div><div class="rc-bub">${esc(text)}</div></div>`;
    const tone = { incident: 'rc-sys-new', demo: 'rc-sys-warn', expired: 'rc-sys-warn', resolved: 'rc-sys-good' }[kind] || '';
    return `<div class="rc-sys ${tone}"><span>${esc(text)}</span><time datetime="${esc(entry.at)}">${time}</time></div>`;
  }

  function renderThread() {
    const thread = slot('thread');
    const items = [...(state?.feed || [])].map((entry) => ({ at: Date.parse(entry.at) || 0, html: feedItem(entry) }));
    for (const ask of asks) {
      items.push({ at: ask.at, html: `<div class="rc-msg rc-me"><div class="rc-bub">${ask.kind === 'free' ? 'Who’s free?' : ask.kind === 'team' ? 'Who’s on the team?' : ask.kind === 'recap' ? 'How did we do?' : 'What’s left?'}</div></div>` +
        `<div class="rc-msg rc-hq"><div class="rc-who">HQ</div><div class="rc-bub${ask.kind === 'free' || ask.kind === 'team' ? ' rc-rich' : ''}">${answer(ask.kind === 'team' ? 'free' : ask.kind)}</div></div>` });
    }
    items.sort((a, b) => a.at - b.at);
    const html = items.length ? items.map((item) => item.html).join('')
      : '<div class="rc-msg rc-hq"><div class="rc-who">HQ</div><div class="rc-bub">All clear. No surplus food reported. Start a sample rescue to see how a rescue unfolds.</div></div>';
    if (html === threadHtml) return;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    threadHtml = html;
    thread.innerHTML = html;
    if (nearBottom || !lastSuccess) thread.scrollTop = thread.scrollHeight;
  }

  function renderQuick() {
    const off = busy || !state ? ' disabled' : '';
    let chips;
    if (!incident()) chips = `<button type="button" data-act="create"${off}>Start sample rescue</button><button type="button" data-ask="team"${off}>Who’s on the team?</button>`;
    else if (!isActive()) chips = `<button type="button" data-ask="recap"${off}>How did we do?</button><button type="button" data-act="reset"${off}>Start a new rescue</button>`;
    else chips = `<button type="button" data-ask="left"${off}>What’s left?</button><button type="button" data-ask="free"${off}>Who’s free?</button><button type="button" data-act="ff"${off}>Fast-forward</button>`;
    slot('quick').innerHTML = chips;
  }

  function render() {
    if (disposed) return;
    const inc = incident();
    const t = state?.totals || {};
    app.setAttribute('aria-busy', state ? 'false' : 'true');
    if ((inc?.id || null) !== incidentId) { incidentId = inc?.id || null; asks = []; }
    slot('chan-title').textContent = inc ? `${inc.location} ${inc.food}` : 'No active rescue';
    slot('chan-sub').textContent = inc ? `${fmt(inc.total)} portions · ${chipText()}` : 'All clear';
    slot('team-side').innerHTML = people().map((p) => `<li class="${p.optedIn ? '' : 'rc-off'}">${avatar(p, true)}<span>${esc(p.name)}</span><span class="rc-dot ${statusClass(p.status) || (p.optedIn ? 'ready' : '')}" title="${p.status}"></span><span class="rc-sr">${p.status}</span></li>`).join('');
    slot('pin-sub').textContent = !inc ? 'No active rescue' : !isActive() ? `${fmt(num(t.total) - num(t.rescued))} not rescued` : `${fmt(t.unclaimed)} unclaimed · ${fmt(t.rescued)} rescued`;
    slot('status-desk').innerHTML = statusHtml(false);
    slot('status-sheet').innerHTML = statusHtml(true);
    renderThread();
    renderQuick();
    root.querySelector('.rc-composer button').disabled = busy || !state;
    tick();
  }

  function tick() {
    if (disposed) return;
    const urg = urgency();
    app.dataset.urg = urg;
    slot('chip').textContent = chipText();
    if (lastUrg !== null && lastUrg !== urg && state) { lastUrg = urg; render(); return; }
    lastUrg = urg;
    const text = timerText();
    const fraction = incident() && isActive() ? secondsLeft() / windowSeconds() : incident()?.status === 'resolved' ? 1 : 0;
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
    if (!next || !Array.isArray(next.volunteers) || !Array.isArray(next.feed) || !next.totals || !Object.hasOwn(next, 'incident')) {
      throw new Error('HQ returned an unexpected response. Please retry.');
    }
    state = next;
    revision++;
    lastSuccess = Date.now();
    render();
  }

  async function readState() {
    if (readPending || busy || disposed) return;
    readPending = true;
    const start = revision;
    try {
      const response = await fetch(api('/api/state'), { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(8000), lifecycle.signal]) });
      if (!response.ok) throw new Error(`Could not load HQ updates (${response.status}).`);
      const data = await response.json();
      if (start === revision && !busy) applyState(data);
      lastSuccess = Date.now();
      showError('');
    } catch (error) {
      if (disposed) return;
      if (!streamConnected) showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Unable to reach HQ. Check your connection and retry.' : error.message);
    } finally {
      readPending = false;
    }
  }

  async function post(path, body) {
    if (busy || disposed) return false;
    busy = true;
    revision++;
    render();
    showError('');
    try {
      const response = await fetch(api(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.any([AbortSignal.timeout(12000), lifecycle.signal]),
      });
      if (!response.ok) {
        let message = `Action failed (${response.status}). Please try again.`;
        try { const details = await response.json(); if (typeof details.error === 'string') message = details.error; } catch { /* Keep the status message. */ }
        throw new Error(message);
      }
      busy = false;
      applyState(await response.json());
      return true;
    } catch (error) {
      if (!disposed) showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Could not confirm the action. Check your connection and retry.' : error.message);
      return false;
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }

  function setSheet(open) {
    sheet.hidden = !open;
    scrim.hidden = !open;
    pin.setAttribute('aria-expanded', String(open));
    if (open) sheet.querySelector('.rc-x').focus();
    else pin.focus();
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act], [data-ask]');
    if (!button || button.disabled) return;
    const act = button.dataset.act;
    if (button.dataset.ask) {
      asks = [...asks, { kind: button.dataset.ask, at: Date.now() }].slice(-5);
      renderThread();
      const thread = slot('thread');
      thread.scrollTop = thread.scrollHeight;
    } else if (act === 'create') post('/api/incidents', SAMPLE);
    else if (act === 'ff') post('/api/demo/fast-forward');
    else if (act === 'reset') { asks = []; post('/api/demo/reset'); }
    else if (act === 'retry') { showError(''); readState(); }
    else if (act === 'sheet') setSheet(sheet.hidden);
    else if (act === 'close') setSheet(false);
  }, { signal: lifecycle.signal });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !sheet.hidden) setSheet(false); }, { signal: lifecycle.signal });
  slot('composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (await post('/api/updates', { text })) {
      input.value = '';
      const thread = slot('thread');
      thread.scrollTop = thread.scrollHeight;
    }
  }, { signal: lifecycle.signal });

  render();
  readState();
  let stream = null;
  if (typeof EventSource !== 'undefined') {
    stream = new EventSource(api('/api/stream'));
    stream.onopen = () => { streamConnected = true; tick(); };
    stream.onmessage = (event) => {
      try { applyState(JSON.parse(event.data)); showError(''); }
      catch { showError('A live update could not be read. Retrying through the backup connection.'); }
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
