// Quick Import parser: turns pasted calendar text (e.g. copied from TimeTree, Google Calendar,
// a WhatsApp message or a typed list) into draft sessions. Pure functions, no DOM.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DOW_RE = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?';
const pad = (n) => String(n).padStart(2, '0');

const RE_ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const RE_SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const RE_DMY = new RegExp(`\\b(?:${DOW_RE}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}(?:,?\\s+(\\d{4}))?`, 'i');
const RE_MDY = new RegExp(`\\b(?:${DOW_RE}\\s+)?${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
const RE_REL = /\b(today|tomorrow|yesterday)\b/i;
const T = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z]))?';
const RE_RANGE = new RegExp(`(?<![\\d/])${T}\\s*(?:-|–|—|to|until)\\s*${T}(?![\\d/])`, 'i');
const RE_TIME = new RegExp(`(?<![\\d/])(\\d{1,2})(?:[:.](\\d{2})\\s*(?:(am|pm)(?![a-z]))?|\\s*(am|pm)(?![a-z]))(?![\\d/])`, 'i');
const RE_DUR = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i;
const RE_ALLDAY = /\ball[- ]day\b/i;
const RE_CANCEL = /\b(cancel+ed|cancel+ation|cancel)\b/i;

function fixYear(y, m, d, today) {
  if (y) { y = +y; if (y < 100) y += 2000; return y; }
  // No year given: choose the year that puts the date nearest to today.
  const cands = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];
  let best = cands[1], bestDiff = Infinity;
  for (const c of cands) { const diff = Math.abs(new Date(c, m - 1, d) - today); if (diff < bestDiff) { bestDiff = diff; best = c; } }
  return best;
}
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();

export function extractDate(line, today = new Date()) {
  let m;
  if ((m = line.match(RE_ISO))) { const y = +m[1], mo = +m[2], d = +m[3]; if (valid(y, mo, d)) return { date: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] }; }
  if ((m = line.match(RE_DMY))) { const d = +m[1], mo = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)) + 1; const y = fixYear(m[3], mo, d, today); if (valid(y, mo, d)) return { date: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] }; }
  if ((m = line.match(RE_MDY))) { const mo = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, d = +m[2]; const y = fixYear(m[3], mo, d, today); if (valid(y, mo, d)) return { date: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] }; }
  if ((m = line.match(RE_SLASH))) { const d = +m[1], mo = +m[2]; const y = fixYear(m[3], mo, d, today); if (valid(y, mo, d)) return { date: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] }; }
  if ((m = line.match(RE_REL))) {
    const off = { today: 0, tomorrow: 1, yesterday: -1 }[m[1].toLowerCase()];
    const x = new Date(today); x.setDate(x.getDate() + off);
    return { date: `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`, match: m[0] };
  }
  return null;
}

function to24(h, min, ap, hintPm) {
  h = +h; min = +(min || 0);
  ap = ap ? ap.toLowerCase().replace(/\./g, '') : null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && hintPm && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function extractTime(line) {
  let m = line.match(RE_RANGE);
  if (m) {
    const [, h1, m1, ap1, h2, m2, ap2] = m;
    // Ignore things that are clearly not times, e.g. "1-2" with no colon/am/pm and small numbers is ambiguous but common ("4-5pm").
    if (!m1 && !m2 && !ap1 && !ap2) { /* bare "4-5": treat as afternoon tutoring hours if both <= 12 */ }
    let end = to24(h2, m2, ap2, false);
    let start = to24(h1, m1, ap1 || (ap2 && +h1 <= +h2 ? ap2 : null), false);
    if (!ap1 && !ap2 && !m1 && !m2) {
      if (+h1 > 12 || +h2 > 12) { /* 24h */ } else if (+h1 < 8) { start += 12 * 60; end += 12 * 60; }
    } else if (!ap1 && !ap2 && +h1 < 8 && +h2 <= 12) { start += 12 * 60; end += 12 * 60; }
    if (start != null && end != null) {
      if (end <= start) end += 12 * 60; // e.g. 11:30-1pm or 4:30-5 with missing pm
      return { start, duration: end - start, match: m[0] };
    }
  }
  m = line.match(RE_TIME);
  if (m) {
    const [, h, mm, ap1, ap2] = m;
    let start = to24(h, mm, ap1 || ap2, false);
    if (start != null && !(ap1 || ap2) && +h < 8) start += 12 * 60; // "4:30" → 16:30 for after-school tutoring
    if (start != null) return { start, duration: null, match: m[0] };
  }
  return null;
}

export function extractDuration(line) {
  const m = line.match(RE_DUR);
  if (!m) return null;
  const n = parseFloat(m[1]); const unit = m[2].toLowerCase();
  const mins = unit.startsWith('h') ? Math.round(n * 60) : Math.round(n);
  return mins > 0 && mins <= 600 ? { duration: mins, match: m[0] } : null;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function matchStudent(text, students) {
  const t = ' ' + norm(text) + ' ';
  let best = null, bestScore = 0;
  for (const s of students) {
    const keys = [];
    if (s.label) keys.push([norm(s.label), 4]);
    if (s.name) { keys.push([norm(s.name), 3]); const parts = norm(s.name).split(' '); keys.push([parts[0], 2]); if (parts.length > 1) keys.push([parts[parts.length - 1], 1]); }
    for (const [k, w] of keys) {
      if (!k || k.length < 2) continue;
      if (t.includes(' ' + k + ' ')) { const score = w * 100 + k.length; if (score > bestScore) { bestScore = score; best = s; } }
    }
  }
  return best;
}

function cleanTitle(line, parts) {
  let s = line;
  for (const p of parts) if (p) s = s.replace(p, ' ');
  return s.replace(RE_ALLDAY, ' ').replace(/^[\s\-–—•·*|,:>]+|[\s\-–—•·*|,:]+$/g, '').replace(/\s+[\-–—•·|]\s+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse pasted text into draft sessions.
 * @returns {{items: Array, skipped: Array<string>}}
 */
export function parseQuickImport(text, { students = [], existing = [], defaultDuration = 60, today = new Date() } = {}) {
  const items = []; const skipped = [];
  let currentDate = null;
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\u00a0/g, ' ').trim();
    if (!line) continue;
    const d = extractDate(line, today);
    const lineNoDate = d ? line.replace(d.match, ' ') : line;
    const t = extractTime(lineNoDate);
    if (d) currentDate = d.date;
    if (!t) {
      if (!d) skipped.push(line);
      else {
        // Date-only line; may still be an all-day event with a student name.
        const rest = cleanTitle(lineNoDate, []);
        if (rest && matchStudent(rest, students) && !/^(mon|tue|wed|thu|fri|sat|sun)/i.test(rest)) skipped.push(line + '  (no time found)');
      }
      continue;
    }
    if (!currentDate) { skipped.push(line + '  (no date found)'); continue; }
    const restNoTime = lineNoDate.replace(t.match, ' ');
    const dur = extractDuration(restNoTime);
    const title = cleanTitle(restNoTime.replace(RE_CANCEL, ' '), [dur?.match]);
    const student = matchStudent(title, students);
    const startStr = `${pad(Math.floor(t.start / 60))}:${pad(t.start % 60)}`;
    const duration = t.duration || dur?.duration || student?.defaultDuration || defaultDuration;
    const duplicate = !!(student && existing.some(e => e.studentId === student.id && e.date === currentDate && e.start === startStr));
    items.push({
      date: currentDate, start: startStr, duration, title, raw: line,
      studentId: student?.id || null, matched: !!student, duplicate,
      cancelled: RE_CANCEL.test(line),
      include: !!student && !duplicate,
    });
  }
  return { items, skipped };
}
