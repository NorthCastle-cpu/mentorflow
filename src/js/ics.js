// Pure iCalendar (RFC 5545) builder shared by the app (calendar.js) and the Cloudflare Worker (9pm digest).
// No DOM, no IndexedDB, no app state: callers pass a `studentById` lookup.
import { INVOICE_METHODS, sortSessions } from './constants.js';
import { ymd, addDays, parseYmd, timeToMins } from './util.js';

export const TZID = 'Europe/London';
export const VTIMEZONE = [
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

export function eventSummary(s, studentById = () => null) {
  const st = studentById(s.studentId);
  // Always "{Student full name} – {Topic/Subject}" (the old TimeTree label field is ignored).
  return `${st?.name || 'Lesson'} – ${(s.subject || '').trim() || st?.subject || 'Tutoring'}`;
}

/** @param {object} s session  @param {{studentById:Function, alarm?:boolean, now?:Date}} opts */
export function sessionToVevent(s, { studentById = () => null, alarm = false, now = new Date() } = {}) {
  const st = studentById(s.studentId);
  const start = timeToMins(s.start); const end = start + (+s.duration || 60);
  const cancelled = s.status === 'cancelled' || s.status === 'late_cancel';
  const desc = [`Channel: ${INVOICE_METHODS[st?.invoiceMethod]?.label || 'Direct'}`];
  if (cancelled) desc.push(s.status === 'late_cancel' ? 'Late cancellation' : 'Cancelled');
  if (s.notes) desc.push('', s.notes);
  desc.push('', 'Added from MentorFlow');
  const location = s.location || st?.location || '';
  const summary = eventSummary(s, studentById);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${sessionUid(s)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `CREATED:${utcStamp(s.createdAt || now)}`,
    `LAST-MODIFIED:${utcStamp(s.updatedAt || s.createdAt || now)}`,
    `SEQUENCE:${+s.sequence || 0}`,
    `DTSTART;TZID=${TZID}:${localStamp(s.date, start)}`,
    `DTEND;TZID=${TZID}:${localStamp(s.date, end)}`,
    `SUMMARY:${escapeText((cancelled ? 'Cancelled: ' : '') + summary)}`,
    `DESCRIPTION:${escapeText(desc.join('\n'))}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `TRANSP:${cancelled ? 'TRANSPARENT' : 'OPAQUE'}`,
  ];
  if (alarm && !cancelled) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(summary)}`, 'TRIGGER:-PT30M', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(sessions, opts = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MentorFlow//MentorFlow Lessons 1.1//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...VTIMEZONE];
  for (const s of [...sessions].sort(sortSessions)) lines.push(...sessionToVevent(s, opts));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
