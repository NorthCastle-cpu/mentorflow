// Calendar export UI: Today card, help sheet, follow-up sheet.
import { state, saveSettings } from './store.js';
import { RANGES, sessionsForRange, sessionsSinceLastExport, lastExportBeforeToday, exportToCalendar, shareIcs, icsFile, isIOS, isStandalone, upcomingSessions, singleFilename } from './calendar.js';
import { openSheet, closeSheet, sheetHeader, toast, icon } from './ui.js';
import { esc } from './util.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function buttonLabel(range, n) {
  if (!n) return { text: { today: 'No new or changed lessons today', '3d': 'No new or changed lessons in the last 3 days', '7d': 'No new or changed lessons in the last 7 days', all: 'No lessons to add yet' }[range], disabled: true };
  if (range === 'all') return { text: `Add all ${plural(n, 'lesson')} to Calendar`, disabled: false };
  if (range === 'today') return { text: `Add ${n} new ${n === 1 ? 'lesson' : 'lessons'} to Calendar`, disabled: false };
  return { text: `Add ${n} new or changed ${n === 1 ? 'lesson' : 'lessons'} to Calendar`, disabled: false };
}

export function todayCalendarCard() {
  if (!state.students.length) return '';
  const range = RANGES[state.settings.calendarRange] ? state.settings.calendarRange : 'today';
  const list = sessionsForRange(range);
  const b = buttonLabel(range, list.length);
  const since = lastExportBeforeToday() ? sessionsSinceLastExport() : [];
  const last = state.settings.lastCalendarExportAt;
  return `<section class="card cal-export" data-testid="calendar-card">
    <header class="card-head"><h3>${icon('calCheck')} Calendar</h3><button class="link-btn" data-action="calendar-help">${icon('info')} How it works</button></header>
    <div class="seg compact cal-range" role="radiogroup" aria-label="Which lessons">${Object.entries(RANGES).map(([k, r]) => `<button class="${k === range ? 'on' : ''}" data-action="calendar-range" data-range="${k}" aria-pressed="${k === range}">${esc(r.label)}</button>`).join('')}</div>
    <button class="btn primary block cal-go" data-action="calendar-export" data-range="${range}" data-testid="calendar-export" ${b.disabled ? 'disabled' : ''}>${icon('calCheck')} ${esc(b.text)}</button>
    ${since.length ? `<button class="btn block" data-action="calendar-export-since" data-testid="calendar-export-since">${icon('clock')} Add everything new since last time (${since.length})</button>` : ''}
    <p class="muted small">${range === 'all' ? 'Every lesson, past and upcoming. Re-adding updates events instead of duplicating them where Calendar supports it.' : 'Lessons created or changed in this period, including cancellations.'}${last ? ` Last added ${esc(new Date(last).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}.` : ''}</p>
  </section>`;
}

export function calendarHelp() {
  openSheet(`${sheetHeader('Lessons in your iPad Calendar & TimeTree')}<div class="sheet-body prose">
  <ol>
    <li>Each evening, tap <b>Add … lessons to Calendar</b> on Today (pick <b>Today</b>, <b>Last 3 days</b>, <b>Last 7 days</b> or <b>All lessons</b>).</li>
    <li>iPadOS shows the lessons in a Calendar preview – tap <b>Add All</b> and choose your calendar.</li>
    <li>The lessons now appear in the Calendar app.</li>
    <li>TimeTree shows them too if it can read your calendars: <b>Settings › TimeTree › Calendars → Full Access</b>, then in TimeTree turn on the iPad calendar you added them to.</li>
  </ol>
  <p><b>Note:</b> TimeTree shows device-calendar events on its <b>home calendar only</b>, not in shared TimeTree calendars.</p>
  <p>Changed or cancelled a lesson? Just add it again – it keeps the same ID and a higher version number, so Calendar updates the existing event (cancelled lessons are marked cancelled). Deleting a lesson in MentorFlow does not remove it from Calendar; mark it <i>Cancelled</i> instead and re-add.</p>
  <p class="muted">If the <b>Add All</b> preview doesn't appear (it can vary between Safari and the Home Screen app), use <b>Share / Save to Files</b>, then open the .ics in the Files app and tap <b>Add All</b>.</p>
  <p class="muted">Reminders are off by default (TimeTree reminds you). Turn on a 30-minute alert in <b>More › Calendar</b>.</p>
  </div><footer class="sheet-foot"><span class="grow"></span><button class="btn primary" data-action="close-sheet">Got it</button></footer>`);
}

/** Export, then (on iPad/iPhone) offer the share-sheet fallback in case the Add All preview didn't show. */
export function runCalendarExport(sessions, { filename, label } = {}) {
  if (!sessions.length) { toast('No lessons to add'); return null; }
  const res = exportToCalendar(sessions, { filename });
  if (res.method === 'download') { toast(`${plural(res.count, 'lesson')} saved as ${res.filename} – open it to add to Calendar`, { type: 'ok', ms: 4000 }); return res; }
  const sheet = openSheet(`${sheetHeader('Add to Calendar')}<div class="sheet-body">
    <p>Opening <b>${esc(plural(res.count, 'lesson'))}</b> in Calendar${label ? ` (${esc(label)})` : ''}. Tap <b>Add All</b> on the preview.</p>
    <p class="muted small">Didn't see the Calendar preview${isStandalone() ? ' in the Home Screen app' : ''}? Share the file instead and choose <b>Save to Files</b>, then tap it in Files → <b>Add All</b>.</p></div>
    <footer class="sheet-foot"><button class="btn" data-x="share">${icon('upload')} Share / Save to Files</button><span class="grow"></span><button class="btn primary" data-action="close-sheet">Done</button></footer>`);
  sheet.querySelector('[data-x=share]').onclick = async () => { const r = await shareIcs(icsFile(sessions, res.filename)); if (r !== 'cancelled') closeSheet(); };
  return res;
}

export const exportSingle = (s) => runCalendarExport([s], { filename: singleFilename(s) });
export const exportUpcoming = () => runCalendarExport(upcomingSessions(), { label: 'all upcoming' });
export const exportRange = (range) => runCalendarExport(sessionsForRange(range), { label: RANGES[range]?.label });
export const exportSince = () => runCalendarExport(sessionsSinceLastExport(), { label: 'new since last time' });
export const setRange = (range) => saveSettings({ calendarRange: range });
