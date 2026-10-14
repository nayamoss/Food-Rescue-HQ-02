// @ts-nocheck
// Original browser behavior, scoped to this canvas frame and a local demo adapter.
import { createDemo } from './_demo';
export function mountDashboard(root: HTMLElement) {
const cleanups: Array<() => void> = [];
const realDocument = globalThis.document;
function listen(element, event, handler) { element.addEventListener(event, handler); cleanups.push(() => element.removeEventListener(event, handler)); }
const document = {
 getElementById: (id: string) => root.querySelector('#' + id),
 createElement: realDocument.createElement.bind(realDocument),
 get hidden() { return realDocument.hidden; },
 addEventListener: (name, fn) => { realDocument.addEventListener(name, fn); cleanups.push(() => realDocument.removeEventListener(name, fn)); }
};
const window = {
 setInterval: (fn, ms) => { const id = globalThis.setInterval(fn, ms); cleanups.push(() => globalThis.clearInterval(id)); return id; },
 addEventListener: (name, fn) => { globalThis.addEventListener(name, fn); cleanups.push(() => globalThis.removeEventListener(name, fn)); }
};
const fetch = createDemo();
const EventSource = undefined;


const byId = (id) => document.getElementById(id);
let state = null;
let busy = false;
let streamConnected = false;
let lastSuccess = 0;
let requestError = '';
let readPending = false;
let revision = 0;
const number = (value) => Math.max(0, Number(value) || 0);
const format = (value) => number(value).toLocaleString();
const isActive = () => Boolean(state?.incident && ['open', 'in_progress'].includes(state.incident.status));

function showError(message) {
  requestError = message;
  byId('error-text').textContent = message;
  byId('error').hidden = !message;
}

function updateConnection() {
  const recent = lastSuccess && Date.now() - lastSuccess < 10000;
  const connected = streamConnected || recent;
  byId('connection').classList.toggle('connected', Boolean(connected));
  byId('connection-text').textContent = streamConnected ? 'Canvas preview' : recent ? 'Canvas preview' : lastSuccess ? 'Connection interrupted' : 'Connecting to HQ';
}

function updateControls() {
  byId('create').disabled = !state || busy || isActive();
  byId('fast-forward').disabled = !state || busy || !isActive();
  byId('reset').disabled = !state || busy;
  byId('retry').disabled = busy;
}

function updateTimer() {
  const incident = state?.incident;
  const deadline = incident ? Date.parse(incident.deadline) : NaN;
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
  byId('countdown').textContent = incident
    ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : '--:--';
  byId('timer-help').textContent = !incident ? 'No active safety window' : incident.status === 'resolved' ? 'Rescue complete' : incident.status === 'cancelled' ? 'Incident cancelled' : seconds === 0 ? 'Safety window has ended' : 'Time remaining to rescue food';
}

function renderTeam(volunteers, assignments) {
  const body = byId('volunteers');
  body.replaceChildren();
  byId('volunteer-count').textContent = `${volunteers.length} volunteers`;
  if (!volunteers.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = 'table-empty';
    cell.textContent = 'No volunteers in the rescue team yet.';
    return;
  }
  for (const volunteer of volunteers) {
    const assignment = assignments.find((item) => String(item.volunteerId) === String(volunteer.id));
    const claimed = number(assignment?.claimed);
    const pickedUp = number(assignment?.pickedUp);
    const row = body.insertRow();
    const nameCell = row.insertCell();
    const person = document.createElement('span');
    person.className = 'person';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const name = String(volunteer.name || 'Volunteer');
    avatar.textContent = name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    const label = document.createElement('span');
    label.textContent = name;
    person.append(avatar, label);
    nameCell.append(person);
    row.insertCell().textContent = format(claimed);
    row.insertCell().textContent = format(pickedUp);
    const status = document.createElement('span');
    status.className = 'vol-status';
    status.textContent = assignment
      ? pickedUp > 0 && pickedUp >= claimed ? 'Picked up' : pickedUp > 0 ? 'Picking up' : claimed > 0 ? 'Claimed' : volunteer.optedIn ? 'Ready' : 'Not opted in'
      : volunteer.optedIn ? 'Ready' : 'Not opted in';
    row.insertCell().append(status);
  }
}

function renderFeed(feed) {
  const list = byId('feed');
  list.replaceChildren();
  byId('feed-empty').hidden = feed.length > 0;
  const entries = [...feed].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  for (const entry of entries) {
    const item = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'feed-icon';
    const dot = document.createElement('span');
    dot.className = 'dot';
    icon.append(dot);
    const content = document.createElement('div');
    const text = document.createElement('p');
    text.className = 'feed-text';
    text.textContent = String(entry.text || '');
    const time = document.createElement('time');
    time.className = 'feed-time';
    const date = new Date(entry.at);
    if (!Number.isNaN(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      time.title = date.toLocaleString();
    } else {
      time.textContent = 'Time unavailable';
    }
    content.append(text, time);
    item.append(icon, content);
    list.append(item);
  }
}

function applyState(next) {
  if (!next || !Array.isArray(next.volunteers) || !Array.isArray(next.feed) || !next.totals || !Object.hasOwn(next, 'incident')) {
    throw new Error('HQ returned an unexpected response. Please retry.');
  }
  state = next;
  revision++;
  lastSuccess = Date.now();
  byId('dashboard').classList.remove('loading');
  byId('dashboard').setAttribute('aria-busy', 'false');
  const incident = state.incident;
  const statusMap = { open: 'Urgent', in_progress: 'Urgent', resolved: 'Rescued', expired: 'Expired', cancelled: 'Cancelled' };
  byId('status-text').textContent = incident ? statusMap[incident.status] || 'Idle' : 'Idle';
  byId('status').dataset.state = incident?.status || 'idle';
  byId('incident-title').textContent = incident ? `${format(incident.total)} ${incident.food} to rescue.` : 'All clear. No surplus food reported.';
  byId('incident-note').textContent = !incident
    ? 'Standing by for the next rescue. Your team is ready when you are.'
    : incident.status === 'resolved' ? 'Every portion accounted for. That’s a rescue worth celebrating.'
    : incident.status === 'expired' ? 'The safety window has closed. This incident is no longer active.'
    : incident.status === 'cancelled' ? 'This rescue has been cancelled. No further pickups are expected.'
    : 'The clock is ticking. Let’s get this food into the right hands.';
  byId('location').hidden = !incident;
  byId('location-text').textContent = incident?.location || '';
  for (const key of ['total', 'unclaimed', 'claimed', 'rescued']) byId(key).textContent = format(state.totals[key]);
  const total = number(state.totals.total);
  const rescued = number(state.totals.rescued);
  const percentage = total ? Math.min(100, Math.max(0, rescued / total * 100)) : 0;
  const percentageText = Number(percentage.toFixed(1));
  byId('progress-text').textContent = `${percentageText}% rescued`;
  byId('progress').setAttribute('aria-valuenow', String(percentageText));
  byId('progress-fill').style.width = `${percentage}%`;
  byId('progress-caption').textContent = total ? `${format(rescued)} of ${format(total)} portions picked up. Every portion counts.` : 'Every portion picked up is a portion saved.';
  renderTeam(state.volunteers, incident?.assignments || []);
  renderFeed(state.feed);
  updateTimer();
  updateControls();
  updateConnection();
}

async function readState() {
  if (readPending || busy) return;
  readPending = true;
  const startRevision = revision;
  try {
    const response = await fetch('/api/state', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Could not load HQ updates (${response.status}).`);
    const data = await response.json();
    if (startRevision === revision && !busy) applyState(data);
    lastSuccess = Date.now();
    if (requestError.startsWith('Could not load') || requestError.startsWith('Unable to reach')) showError('');
  } catch (error) {
    if (!streamConnected) showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Unable to reach HQ. Check your connection and retry.' : error.message);
    if (!state) {
      byId('dashboard').classList.remove('loading');
      byId('dashboard').setAttribute('aria-busy', 'false');
      byId('incident-title').textContent = 'Waiting for a connection.';
      byId('incident-note').textContent = 'Your dashboard will update as soon as HQ is available.';
    }
  } finally {
    readPending = false;
    updateConnection();
  }
}

async function postAction(path, body) {
  if (busy) return;
  busy = true;
  revision++;
  updateControls();
  showError('');
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      let message = `Action failed (${response.status}). Please try again.`;
      try { const details = await response.json(); if (typeof details.error === 'string') message = details.error; } catch { /* Use the HTTP status if the response is not JSON. */ }
      throw new Error(message);
    }
    applyState(await response.json());
  } catch (error) {
    showError(error.name === 'TimeoutError' || error instanceof TypeError ? 'Could not confirm the action. Check your connection and retry.' : error.message);
  } finally {
    busy = false;
    updateControls();
  }
}

listen(byId('create'), 'click', () => postAction('/api/incidents', { food: 'tacos', total: 400, location: 'Main hall', minutes: 45 }));
listen(byId('fast-forward'), 'click', () => postAction('/api/demo/fast-forward'));
listen(byId('reset'), 'click', () => postAction('/api/demo/reset'));
listen(byId('retry'), 'click', () => { showError(''); readState(); });

readState();
if (typeof EventSource !== 'undefined') {
  const stream = new EventSource('/api/stream');
  stream.onopen = () => { streamConnected = true; updateConnection(); };
  stream.onmessage = (event) => {
    try {
      applyState(JSON.parse(event.data));
      if (requestError.startsWith('Could not load') || requestError.startsWith('Unable to reach')) showError('');
    } catch {
      showError('A live update could not be read. Retrying through the backup connection.');
    }
  };
  stream.onerror = () => { streamConnected = false; updateConnection(); };
}
window.setInterval(readState, 3000);
window.setInterval(() => { updateTimer(); updateConnection(); }, 250);
window.addEventListener('online', readState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateTimer(); readState(); } });

return () => cleanups.forEach(dispose => dispose());
}
