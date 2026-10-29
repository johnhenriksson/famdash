'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ical = require('node-ical');

const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.TZ || 'UTC';
const ICS_URL = process.env.ICS_URL || '';
const WEEK_START = (process.env.WEEK_START || 'monday').toLowerCase() === 'sunday' ? 0 : 1;
const REFRESH_MS = Number(process.env.REFRESH_MINUTES || 10) * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const DAY_MS = 24 * 60 * 60 * 1000;

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// "YYYY-MM-DD" for an instant, as seen in TZ
const dayKey = (d) => dayFmt.format(d);
const timeStr = (d) => timeFmt.format(d);

// Pure calendar arithmetic on "YYYY-MM-DD" keys (UTC midnight is just a carrier)
const keyToUtc = (k) => new Date(`${k}T00:00:00Z`);
const utcToKey = (d) => d.toISOString().slice(0, 10);
const addDays = (k, n) => utcToKey(new Date(keyToUtc(k).getTime() + n * DAY_MS));

function weekStartKey(todayKey, offsetWeeks) {
  const dow = keyToUtc(todayKey).getUTCDay(); // 0 = Sunday
  const back = (dow - WEEK_START + 7) % 7;
  return addDays(todayKey, -back + offsetWeeks * 7);
}

// ISO 8601 week number for a "YYYY-MM-DD" key
function isoWeek(k) {
  const d = keyToUtc(k);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
}

// ---- ICS fetching and cache -------------------------------------------------

const cache = { events: [], fetchedAt: null, error: null };

async function loadIcsText() {
  if (!ICS_URL) throw new Error('ICS_URL is not set');
  if (ICS_URL.startsWith('file:')) {
    return fs.readFileSync(path.resolve(ICS_URL.slice(5)), 'utf8');
  }
  const res = await fetch(ICS_URL.replace(/^webcal:/i, 'https:'), {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'famdash/1.0' },
  });
  if (!res.ok) throw new Error(`ICS fetch failed: HTTP ${res.status}`);
  return res.text();
}

async function refresh() {
  try {
    const parsed = ical.sync.parseICS(await loadIcsText());
    cache.events = Object.values(parsed).filter((e) => e.type === 'VEVENT');
    cache.fetchedAt = new Date();
    cache.error = null;
    console.log(`[${cache.fetchedAt.toISOString()}] loaded ${cache.events.length} events`);
  } catch (err) {
    cache.error = err.message;
    console.error(`[${new Date().toISOString()}] refresh failed: ${err.message}`);
  }
}

// ---- Event expansion --------------------------------------------------------

const text = (v) => (v && typeof v === 'object' && 'val' in v ? v.val : v) || '';

// Turn one VEVENT (or one instance of it) into a normalised occurrence.
function occurrence(ev, start, end) {
  const allDay = ev.datetype === 'date';
  if (!end || end <= start) end = new Date(start.getTime() + (allDay ? DAY_MS : 0));
  return {
    uid: ev.uid,
    title: String(text(ev.summary) || '(no title)'),
    location: String(text(ev.location) || ''),
    allDay,
    start,
    end,
  };
}

// All-day dates arrive as local-midnight Dates (process TZ == TZ), so use the
// local getters to get a stable calendar date instead of shifting via UTC.
const localKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function expand(ev, rangeStart, rangeEnd) {
  if (String(ev.status || '').toUpperCase() === 'CANCELLED') return [];
  if (!ev.start) return [];

  const duration = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;

  if (!ev.rrule) return [occurrence(ev, ev.start, ev.end)];

  const out = [];
  const dates = ev.rrule.between(rangeStart, rangeEnd, true);
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    if (ev.exdate && ev.exdate[key]) continue;
    const override = ev.recurrences && ev.recurrences[key];
    if (override) {
      if (String(override.status || '').toUpperCase() === 'CANCELLED') continue;
      out.push(occurrence({ ...ev, ...override }, override.start, override.end));
    } else {
      out.push(occurrence(ev, date, new Date(date.getTime() + duration)));
    }
  }
  return out;
}

function buildWeek(offsetWeeks) {
  const today = dayKey(new Date());
  const startKey = weekStartKey(today, offsetWeeks);
  const keys = Array.from({ length: 7 }, (_, i) => addDays(startKey, i));
  const days = keys.map((date) => ({ date, isToday: date === today, events: [] }));
  const byKey = new Map(days.map((d) => [d.date, d]));

  // Generous window so timezone edges never drop an instance; days are filtered below.
  const rangeStart = new Date(keyToUtc(keys[0]).getTime() - 2 * DAY_MS);
  const rangeEnd = new Date(keyToUtc(keys[6]).getTime() + 3 * DAY_MS);

  for (const ev of cache.events) {
    let occs;
    try {
      occs = expand(ev, rangeStart, rangeEnd);
    } catch (err) {
      console.error(`skipping event ${ev.uid}: ${err.message}`);
      continue;
    }
    for (const o of occs) {
      // Span of calendar days this occurrence touches (end is exclusive)
      const first = o.allDay ? localKey(o.start) : dayKey(o.start);
      const lastInstant = new Date(o.end.getTime() - (o.allDay || o.end > o.start ? 1 : 0));
      const last = o.allDay ? localKey(lastInstant) : dayKey(lastInstant);

      for (let k = first; k <= last; k = addDays(k, 1)) {
        const day = byKey.get(k);
        if (!day) continue;
        day.events.push({
          title: o.title,
          location: o.location,
          allDay: o.allDay || first !== last, // multi-day timed events render as all-day pills
          start: o.allDay ? null : timeStr(o.start),
          end: o.allDay ? null : timeStr(o.end),
          startsToday: k === first,
          endsToday: k === last,
          startMs: o.start.getTime(),
          endMs: o.end.getTime(),
        });
      }
    }
  }

  for (const day of days) {
    day.events.sort((a, b) => (b.allDay - a.allDay) || a.startMs - b.startMs || a.title.localeCompare(b.title));
  }

  return {
    tz: TZ,
    weekStart: keys[0],
    weekEnd: keys[6],
    weekNumber: isoWeek(addDays(keys[0], 3)),
    days,
    updatedAt: cache.fetchedAt && cache.fetchedAt.toISOString(),
    stale: !cache.fetchedAt || Date.now() - cache.fetchedAt.getTime() > REFRESH_MS * 3,
    error: cache.error,
  };
}

// ---- HTTP -------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, fetchedAt: cache.fetchedAt, error: cache.error });
  }

  if (url.pathname === '/api/week') {
    const offset = Math.max(-52, Math.min(52, parseInt(url.searchParams.get('offset') || '0', 10) || 0));
    return sendJson(res, 200, buildWeek(offset));
  }

  // Static files, confined to PUBLIC_DIR
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

refresh().finally(() => {
  setInterval(refresh, REFRESH_MS).unref();
  server.listen(PORT, () => console.log(`famdash listening on :${PORT} (TZ=${TZ})`));
});
