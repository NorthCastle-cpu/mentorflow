// iCalendar (RFC 5545) export of sessions, plus delivery to the device calendar.
import { state, studentById, sortSessions, markCalendarExported, isCalendarExported } from './store.js';
import { todayStr, parseYmd, slug, download } from './util.js';

import * as ics from './ics.js';
export { TZID, escapeText, foldLine, sessionUid } from './ics.js';

// App wrappers around the shared, pure builder in ics.js (also used by the Worker's 9pm digest).
const appOpts = (opts = {}) => ({ studentById, alarm: state.settings.calendarAlarm === true, ...opts });
export const eventSummary = (s) => ics.eventSummary(s, studentById);
export const sessionToVevent = (s, opts) => ics.sessionToVevent(s, appOpts(opts));
export const buildIcs = (sessions, opts) => ics.buildIcs(sessions, appOpts(opts));

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
