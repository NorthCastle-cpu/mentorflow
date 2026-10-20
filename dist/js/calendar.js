// iCalendar (RFC 5545) export of sessions, plus delivery to the device calendar.
import { state, studentById, INVOICE_METHODS, sortSessions, markCalendarExported, isCalendarExported } from './store.js';
import { todayStr, ymd, addDays, parseYmd, timeToMins, slug, download } from './util.js';

export const TZID = 'Europe/London';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/London', 'X-LIC-LOCATION:Europe/London',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

export const escapeText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Fold content lines at 75 octets (UTF-8 aware, never splitting a multi-byte character).
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = ''; let curLen = 0; let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curLen + n > limit) { out.push(cur); cur = ''; curLen = 0; limit = 74; }
    cur += ch; curLen += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const utcStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const localStamp = (date, mins) => {
  const d = addDays(parseYmd(date), Math.floor(mins / 1440)); const m = ((mins % 1440) + 1440) % 1440;
  return `${ymd(d).replace(/-/g, '')}T${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
};

export const sessionUid = (s) => `${s.id}@mentorflow`;

export function eventSummary(s) {
  const st = studentById(s.studentId);
  return `${st?.name || 'Lesson'} – ${st?.subject || 'Tutoring'}`;
}

export function sessionToVevent(s, { alarm = state.settings.calendarAlarm === true, now = new Date() } = {}) {
  const st = studentById(s.studentId);
  const start = timeToMins(s.start); const end = start + (+s.duration || 60);
  const cancelled = s.status === 'cancelled' || s.status === 'late_cancel';
  const desc = [`Channel: ${INVOICE_METHODS[st?.invoiceMethod]?.label || 'Direct'}`];
  if (cancelled) desc.push(s.status === 'late_cancel' ? 'Late cancellation' : 'Cancelled');
  if (s.notes) desc.push('', s.notes);
  desc.push('', 'Added from MentorFlow');
  const location = s.location || st?.location || '';
  const label = st?.label || st?.name?.split(' ')[0] || '';
  const lines = [
    'BEGIN:VEVENT',
    `UID:${sessionUid(s)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `CREATED:${utcStamp(s.createdAt || now)}`,
    `LAST-MODIFIED:${utcStamp(s.updatedAt || s.createdAt || now)}`,
    `SEQUENCE:${+s.sequence || 0}`,
    `DTSTART;TZID=${TZID}:${localStamp(s.date, start)}`,
    `DTEND;TZID=${TZID}:${localStamp(s.date, end)}`,
    `SUMMARY:${escapeText((cancelled ? 'Cancelled: ' : '') + eventSummary(s))}`,
    `DESCRIPTION:${escapeText(desc.join('\n'))}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(label ? [`CATEGORIES:${escapeText(label)}`] : []),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `TRANSP:${cancelled ? 'TRANSPARENT' : 'OPAQUE'}`,
  ];
  if (alarm && !cancelled) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(eventSummary(s))}`, 'TRIGGER:-PT30M', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(sessions, opts = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MentorFlow//MentorFlow Lessons 1.1//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...VTIMEZONE];
  for (const s of [...sessions].sort(sortSessions)) lines.push(...sessionToVevent(s, opts));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------- which sessions to export ----------
export const RANGES = { today: { label: 'Today', days: 1 }, '3d': { label: 'Last 3 days', days: 3 }, '7d': { label: 'Last 7 days', days: 7 }, all: { label: 'All lessons', days: null } };
const startOfDayIso = (daysBack = 0) => { const d = parseYmd(todayStr()); d.setDate(d.getDate() - daysBack); return d.toISOString(); };
const touchedSince = (s, iso) => (s.updatedAt || s.createdAt || '') >= iso || (s.createdAt || '') >= iso;

/** Sessions created or changed within the range (or every session for "all"). */
export function sessionsForRange(range = 'today') {
  const r = RANGES[range] || RANGES.today;
  if (!r.days) return [...state.sessions].sort(sortSessions);
  const since = startOfDayIso(r.days - 1);
  return state.sessions.filter(s => touchedSince(s, since)).sort(sortSessions);
}
export function sessionsSinceLastExport() {
  const last = state.settings.lastCalendarExportAt;
  if (!last) return [];
  return state.sessions.filter(s => (s.updatedAt || s.createdAt || '') > last).sort(sortSessions);
}
export const lastExportBeforeToday = () => !!state.settings.lastCalendarExportAt && state.settings.lastCalendarExportAt < startOfDayIso(0);
export const upcomingSessions = () => state.sessions.filter(s => s.date >= todayStr()).sort(sortSessions);
export { isCalendarExported };

// ---------- delivery ----------
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function icsFile(sessions, filename) {
  const text = buildIcs(sessions);
  // NB: plain "text/calendar" – iOS ignores the file when a charset parameter is added.
  return { text, file: new File([text], filename, { type: 'text/calendar' }), filename };
}

/**
 * Hand the .ics to the system.
 * - iPhone/iPad (Safari and Home Screen app): open the file directly (blob URL, no download attribute) so iOS shows
 *   its calendar preview with "Add All". If that does not appear the user can use shareIcs() from the follow-up sheet.
 * - Everything else: download the .ics (Windows opens it in Outlook/Calendar).
 */
export function openIcs({ file, filename }) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  let method;
  if (isIOS()) { method = 'open'; } else { a.download = filename; method = 'download'; }
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  window.__mentorflowLastIcs = { method, filename, size: file.size };
  return method;
}

/** Fallback: share sheet (Save to Files → tap the file → Add All), or a plain download where sharing is unavailable. */
export async function shareIcs({ file, filename, text }) {
  try {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'MentorFlow lessons' }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  download(filename, new Blob([text], { type: 'text/calendar' })); return 'download';
}

export function exportToCalendar(sessions, { filename } = {}) {
  if (!sessions.length) return null;
  const name = filename || `mentorflow-lessons-${todayStr()}.ics`;
  const f = icsFile(sessions, name);
  const method = openIcs(f);
  markCalendarExported(sessions.map(s => s.id));
  return { ...f, method, count: sessions.length };
}
export const singleFilename = (s) => `mentorflow-lesson-${slug(studentById(s.studentId)?.name || 'lesson')}-${s.date}.ics`;
