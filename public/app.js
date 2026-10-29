'use strict';

const POLL_MS = 5 * 60 * 1000;
const grid = document.getElementById('grid');
const rangeEl = document.getElementById('range');
const weekEl = document.getElementById('week');
const clockEl = document.getElementById('clock');
const statusEl = document.getElementById('status');

let week = null;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const parseKey = (k) => new Date(`${k}T12:00:00`); // noon avoids DST edge cases

function fmtRange(a, b) {
  const da = parseKey(a), db = parseKey(b);
  const m = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  return da.getMonth() === db.getMonth()
    ? `${da.getDate()}–${db.getDate()} ${m(db)}`
    : `${da.getDate()} ${m(da)} – ${db.getDate()} ${m(db)}`;
}

function nowInTz(tz) {
  // "HH:MM" in the server's timezone, for dimming past events today
  return new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function render() {
  if (!week) return;
  rangeEl.textContent = fmtRange(week.weekStart, week.weekEnd);
  weekEl.textContent = `Week ${week.weekNumber}`;

  const now = nowInTz(week.tz);
  grid.replaceChildren(...week.days.map((day) => {
    const d = parseKey(day.date);
    const card = el('section', day.isToday ? 'day today' : 'day');

    const head = el('div', 'day-head');
    head.append(
      el('span', 'num', d.getDate()),
      el('span', 'dow', d.toLocaleDateString(undefined, { weekday: 'short' })),
    );

    const list = el('div', 'events');
    for (const ev of day.events) {
      if (ev.allDay) {
        const pill = el('div', 'pill', ev.title);
        if (!ev.startsToday) pill.classList.add('cont-prev');
        if (!ev.endsToday) pill.classList.add('cont-next');
        list.append(pill);
        continue;
      }
      const item = el('div', 'event');
      if (day.isToday && ev.end && ev.end <= now) item.classList.add('past');
      item.append(el('span', 'time', `${ev.start}–${ev.end}`), el('span', 'name', ev.title));
      if (ev.location) item.append(el('span', 'loc', ev.location));
      list.append(item);
    }
    if (!day.events.length) list.append(el('span', 'empty', '—'));

    card.append(head, list);
    return card;
  }));

  const updated = week.updatedAt ? new Date(week.updatedAt) : null;
  statusEl.textContent = updated
    ? `updated ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'no data yet';
  statusEl.classList.toggle('stale', week.stale || !!week.error);
  statusEl.title = week.error || '';
}

async function load() {
  try {
    const res = await fetch('/api/week', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    week = await res.json();
  } catch (err) {
    statusEl.textContent = 'offline';
    statusEl.classList.add('stale');
    statusEl.title = err.message;
    return;
  }
  render();
}

function tick() {
  clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let lastDay = null;
setInterval(() => {
  tick();
  // Re-fetch at midnight so "today" rolls over; re-render each minute for dimming
  const today = new Date().toDateString();
  if (lastDay && today !== lastDay) load(); else render();
  lastDay = today;
}, 60 * 1000);

tick();
lastDay = new Date().toDateString();
load();
setInterval(load, POLL_MS);
