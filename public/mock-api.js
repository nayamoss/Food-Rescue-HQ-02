// Demo-only stand-in for the new backend endpoints.
// rescue-chat.js uses this ONLY when an endpoint answers 404 ("Endpoint not found").
// Delete this file and the two lines marked "mock" in rescue-chat.js to remove it.
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_PLACES = [
  { id: 'p1', name: 'Partner shelter A', type: 'shelter', distanceMiles: 2, capacity: 150, accepts: ['prepared', 'packaged', 'drinks'] },
  { id: 'p2', name: 'Partner shelter B', type: 'shelter', distanceMiles: 4, capacity: 200, accepts: ['prepared', 'packaged', 'drinks'] },
  { id: 'p3', name: 'Community kitchen', type: 'kitchen', distanceMiles: 6, capacity: 100, accepts: ['prepared', 'packaged', 'drinks'] },
];
const SEED_VOLUNTEERS = ['Alex Rivera', 'Jordan Lee', 'Sam Taylor'];
const sum = (list, fn) => list.reduce((t, x) => t + (Number(fn(x)) || 0), 0);

export function createMock(seed) {
  const s = clone(seed || {});
  s.feed = Array.isArray(s.feed) ? s.feed : [];
  s.places = Array.isArray(s.places) && s.places.length ? s.places : clone(SEED_PLACES);
  s.volunteers = (Array.isArray(s.volunteers) && s.volunteers.length ? s.volunteers : SEED_VOLUNTEERS.map((name, i) => ({ id: `v${i + 1}`, name, optedIn: true })))
    .map((v) => ({ ...v, status: v.status || 'ready' }));
  s.offers = Array.isArray(s.offers) ? s.offers : [];
  s.event = s.event || null;
  s.report = s.report || null;
  s.incident = s.incident || null;

  const say = (text, kind = 'hq') => s.feed.unshift({ id: uid(), at: new Date().toISOString(), text, kind });
  const vol = (id) => s.volunteers.find((v) => v.id === id);
  const placeOf = (offer) => s.places.find((p) => p.id === offer.placeId);

  function expire() {
    const inc = s.incident;
    if (inc && inc.status === 'open' && Date.now() >= Date.parse(inc.deadline)) {
      const rescued = sum(s.offers.filter((o) => o.status === 'dropped_off'), (o) => o.portions);
      inc.status = rescued >= inc.total ? 'resolved' : 'expired';
      say(inc.status === 'expired' ? 'Time ran out. The food that is left can no longer be rescued.' : 'Everything is rescued.');
    }
  }
  function snapshot() {
    expire();
    const left = sum(s.report?.items || [], (i) => i.left);
    const ordered = sum(s.event?.items || [], (i) => i.ordered);
    const dropped = s.offers.filter((o) => o.status === 'dropped_off');
    const rescued = sum(dropped, (o) => o.portions);
    const claimed = sum(s.offers.filter((o) => ['accepted', 'picked_up'].includes(o.status)), (o) => o.portions);
    const sent = s.offers.some((o) => o.status !== 'proposed');
    let journeyStep = 'event';
    if (s.event) journeyStep = 'details';
    if (s.report) journeyStep = sent ? 'outreach' : 'match';
    if (s.incident && s.incident.status !== 'open') journeyStep = 'done';
    const byPlace = s.places.map((p) => ({ name: p.name, portions: sum(dropped.filter((o) => o.placeId === p.id), (o) => o.portions) })).filter((p) => p.portions > 0);
    const snap = clone({
      ...s, journeyStep,
      totals: { total: left, unclaimed: Math.max(0, left - claimed - rescued), claimed, rescued },
      summary: { ordered, eaten: Math.max(0, ordered - left), left, rescued, notRescued: Math.max(0, left - rescued), byPlace },
    });
    snap.volunteers.forEach((v) => { delete v.phone; });
    return snap;
  }
  const ok = (status = 200) => ({ status, json: snapshot() });
  const fail = (status, error) => ({ status, json: { error } });

  function propose() {
    s.offers = [];
    const spare = s.places.map((p) => ({ ...p, room: p.capacity }));
    for (const it of s.report.items) {
      let left = Number(it.left) || 0;
      for (const p of spare) {
        if (left <= 0) break;
        const take = Math.min(left, p.room);
        if (take > 0) { s.offers.push({ id: uid(), placeId: p.id, volunteerId: null, item: it.item, portions: take, status: 'proposed', updatedAt: new Date().toISOString() }); p.room -= take; left -= take; }
      }
    }
  }
  function freeVolunteer() {
    const busy = new Set(s.offers.filter((o) => ['offered', 'accepted', 'picked_up'].includes(o.status)).map((o) => o.volunteerId));
    return s.volunteers.find((v) => v.optedIn !== false && !busy.has(v.id)) || null;
  }
  const syncVol = (offer) => {
    const v = vol(offer.volunteerId);
    if (v) v.status = { offered: 'asked', accepted: 'accepted', declined: 'declined', picked_up: 'on_the_way', dropped_off: 'dropped_off' }[offer.status] || v.status;
  };

  function handle(method, path, body = {}) {
    path = path.replace(/^\/food-rescue-hq/, '');
    let m;
    if (method === 'GET' && path === '/api/state') return ok();
    if (path === '/api/event' && method === 'POST') {
      const items = (body.items || []).filter((i) => i && String(i.item || '').trim());
      if (!String(body.name || '').trim() || !items.length) return fail(400, 'Add an event name and at least one food item.');
      s.event = { id: uid(), name: body.name, venue: body.venue || '', date: body.date || '', organizer: '', contact: '', goodForMinutes: body.goodForMinutes || null, items: clone(items), notes: '' };
      s.report = null; s.offers = []; s.incident = null; s.feed = [];
      s.volunteers.forEach((v) => { v.status = 'ready'; });
      say(`Event saved: ${s.event.name} at ${s.event.venue}.`);
      return ok(201);
    }
    if (path === '/api/event' && method === 'PATCH') {
      if (!s.event) return fail(409, 'Add an event first.');
      Object.assign(s.event, body);
      return ok();
    }
    if (path === '/api/estimate' && method === 'POST') {
      return { status: 200, json: { mock: true, message: 'This is a sample estimate from demo mode. Check the numbers before using them.',
        items: (body.items || s.event?.items || []).map((i) => ({ item: i.item, count: Math.max(0, Math.round((Number(i.ordered) || 0) * 0.1)), unit: 'portions', confidence: 'medium', note: '' })), unreadable: false } };
    }
    if (path === '/api/report' && method === 'POST') {
      if (!s.event) return fail(409, 'Add an event first.');
      const items = (body.items || []).map((i) => {
        const ordered = s.event.items.find((o) => o.item.toLowerCase() === String(i.item).toLowerCase())?.ordered ?? 0;
        return { item: i.item, ordered, left: Math.max(0, Number(i.left) || 0), unit: i.unit || 'portions', source: i.source || 'manual', confidence: i.confidence };
      });
      s.report = { items, confirmedAt: new Date().toISOString() };
      const total = sum(items, (i) => i.left);
      const minutes = Number(s.event.goodForMinutes) || 45;
      s.incident = { id: uid(), food: items.map((i) => i.item).join(', '), total, location: s.event.venue, createdAt: new Date().toISOString(), windowSeconds: minutes * 60,
        deadline: new Date(Date.now() + minutes * 60000).toISOString(), status: total ? 'open' : 'resolved', assignments: [] };
      propose();
      say(total ? `${total} portions are left. I found places that can take them.` : 'Nothing is left. Great work.');
      return ok();
    }
    if (path === '/api/offers/send' && method === 'POST') {
      for (const edit of body.offers || []) {
        const o = s.offers.find((x) => x.id === edit.id);
        if (o && o.status === 'proposed' && Number(edit.portions) >= 0) o.portions = Number(edit.portions);
      }
      s.offers = s.offers.filter((o) => o.status !== 'proposed' || o.portions > 0);
      for (const o of s.offers.filter((x) => x.status === 'proposed')) {
        const v = freeVolunteer();
        if (!v) break;
        o.volunteerId = v.id; o.status = 'offered'; o.updatedAt = new Date().toISOString(); syncVol(o);
        say(`I asked ${v.name} to take ${o.portions} ${o.item} to ${placeOf(o)?.name || 'a partner'}.`);
      }
      return ok();
    }
    if ((m = path.match(/^\/api\/offers\/([^/]+)\/(respond|pickup|dropoff)$/)) && method === 'POST') {
      const o = s.offers.find((x) => x.id === m[1]);
      if (!o) return fail(404, 'That offer was not found.');
      const v = vol(o.volunteerId);
      const who = v?.name || 'A volunteer';
      if (m[2] === 'respond') {
        if (o.status !== 'offered') return fail(409, 'This offer was already answered.');
        if (body.action === 'accept') { o.status = 'accepted'; say(`${who} accepted. ${o.portions} ${o.item} will go to ${placeOf(o)?.name}.`, 'volunteer'); }
        else {
          o.status = 'declined'; say(`${who} can't help this time.`, 'volunteer'); syncVol(o);
          const next = freeVolunteer();
          if (next) { s.offers.push({ ...o, id: uid(), volunteerId: next.id, status: 'offered' }); syncVol(s.offers[s.offers.length - 1]); say(`I asked ${next.name} instead.`); }
        }
      } else if (m[2] === 'pickup') { o.status = 'picked_up'; say(`${who} picked up ${o.portions} ${o.item}.`, 'volunteer'); }
      else { o.status = 'dropped_off'; say(`${who} dropped off ${o.portions} ${o.item} at ${placeOf(o)?.name}.`, 'volunteer'); }
      o.updatedAt = new Date().toISOString();
      syncVol(o);
      return ok();
    }
    if ((m = path.match(/^\/api\/volunteers\/([^/]+)\/phone$/)) && method === 'POST') {
      const v = vol(m[1]);
      if (!v) return fail(404, 'That volunteer was not found.');
      v.phone = String(body.phone || '');
      return ok();
    }
    if (path === '/api/demo/fast-forward' && method === 'POST') {
      if (!s.incident || s.incident.status !== 'open') return fail(409, 'There is no running rescue to fast-forward.');
      s.incident.deadline = new Date(Date.now() + 60000).toISOString();
      return ok();
    }
    if (path === '/api/demo/reset' && method === 'POST') {
      s.event = null; s.report = null; s.offers = []; s.incident = null; s.feed = [];
      s.volunteers.forEach((v) => { v.status = 'ready'; delete v.phone; });
      return ok();
    }
    if (path === '/api/updates' && method === 'POST') {
      const text = String(body.text || '').trim();
      if (!text) return fail(400, 'Write an update first.');
      say(text, 'update');
      return ok(201);
    }
    return fail(404, 'Endpoint not found.');
  }
  return { handle, snapshot };
}
