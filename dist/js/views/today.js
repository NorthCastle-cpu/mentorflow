import { state, hasSampleData, sessionsOn, sessionValue, studentById, monthStats, SESSION_STATUS, INVOICE_METHODS, sortSessions } from '../store.js';
import { esc, money, todayStr, ymd, addDays, fmtDate, fmtDateLong, endTime, ym, fmtMonth, parseYmd, monthDays } from '../util.js';
import { icon, emptyState, avatar, chip } from '../ui.js';
import { labelHex } from '../forms.js';
import { todayCalendarCard } from '../calendar-ui.js';
import { isCalendarExported } from '../store.js';
import { syncBannerHtml } from '../sync-ui.js';

export function sessionRow(s, { showDate = false, actions = true } = {}) {
  const st = studentById(s.studentId);
  const stat = SESSION_STATUS[s.status] || SESSION_STATUS.scheduled;
  return `<div class="row-item session ${s.status}" style="--lbl:${labelHex(st?.labelColor)}">
    <button class="row-main" data-action="edit-session" data-id="${s.id}">
      <span class="lbl-bar"></span>
      <span class="time"><b>${esc(s.start)}</b><small>${esc(endTime(s.start, s.duration))}</small></span>
      <span class="who"><b>${esc(st?.name || 'Unknown')}${isCalendarExported(s) ? `<span class="cal-badge" title="Added to Calendar" aria-label="Added to Calendar">${icon('calCheck')}</span>` : ''}</b><small>${showDate ? esc(fmtDate(s.date)) + ' · ' : ''}${esc(st?.subject || '')}${s.notes ? ' · ' + esc(s.notes) : ''}</small></span>
      <span class="val"><b>${money(sessionValue(s))}</b><small>${esc(stat.label.replace(' (charged)', ''))}</small></span>
    </button>
    ${actions && s.status === 'scheduled' ? `<div class="row-actions"><button class="icon-btn ok" data-action="set-status" data-id="${s.id}" data-status="completed" title="Mark completed" aria-label="Mark completed">${icon('check')}</button><button class="icon-btn" data-action="set-status" data-id="${s.id}" data-status="cancelled" title="Cancel" aria-label="Cancel session">${icon('close')}</button></div>` : ''}
  </div>`;
}

export function taskRow(t) {
  const st = t.studentId ? studentById(t.studentId) : null;
  const overdue = t.due && t.due < todayStr() && t.status !== 'done';
  return `<div class="row-item task ${t.status}"><label class="tick"><input type="checkbox" data-action="toggle-task" data-id="${t.id}" ${t.status === 'done' ? 'checked' : ''} aria-label="Done"><i></i></label>
    <button class="row-main" data-action="edit-task" data-id="${t.id}"><span class="who"><b>${esc(t.title)}</b><small>${st ? esc(st.name) + ' · ' : ''}${t.due ? `<span class="${overdue ? 'overdue' : ''}">${overdue ? 'Overdue · ' : 'Due '}${esc(fmtDate(t.due))}</span>` : 'No due date'}</small></span>
    ${t.status === 'doing' ? chip('In progress', 'doing') : ''}</button></div>`;
}

export const title = 'Today';
const DAY = 864e5;
export function backupDue(now = Date.now()) {
  const S = state.settings;
  if (!state.students.length || state.students.every(s => s.sample)) return false; // nothing real to protect yet
  const last = S.lastBackupAt ? Date.parse(S.lastBackupAt) : 0;
  const firstUse = Math.min(...state.students.map(s => Date.parse(s.createdAt) || now));
  if (!last && now - firstUse < 7 * DAY) return false; // give new users a week before nagging
  if (last && now - last <= 30 * DAY) return false;
  if (S.backupReminderDismissedAt && now - Date.parse(S.backupReminderDismissedAt) <= 30 * DAY) return false;
  return true;
}
export function render() {
  const t = todayStr(); const now = new Date();
  if (!state.students.length) {
    return `<section class="welcome card"><div class="brand-mark big">${icon('sparkle')}</div><h2>Welcome to MentorFlow</h2>
      <p>Track students, sessions, homework and month-end invoicing — all stored privately on this device and working offline.</p>
      <div class="btn-row"><button class="btn primary" data-action="new-student">${icon('plus')} Add your first student</button><button class="btn" data-action="sample-data">Load sample data</button><button class="btn ghost" data-action="restore-backup">Restore from backup</button></div>
      <p class="muted small">Tip: on iPad, tap Share → <b>Add to Home Screen</b> to install MentorFlow as an app.</p></section>`;
  }
  const todays = sessionsOn(t);
  const upcoming = state.sessions.filter(s => s.date > t && s.date <= ymd(addDays(now, 7)) && s.status === 'scheduled').sort(sortSessions);
  const unmarked = state.sessions.filter(s => s.date < t && s.status === 'scheduled').sort(sortSessions);
  const m = monthStats(ym(now));
  const myTasks = state.tasks.filter(x => x.type === 'mine' && x.status !== 'done' && (!x.due || x.due <= ymd(addDays(now, 3)))).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 6);
  const hw = state.tasks.filter(x => x.type === 'homework' && x.status !== 'done' && x.due && x.due <= ymd(addDays(now, 7))).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);
  const dayOfMonth = now.getDate(); const dim = monthDays(ym(now));
  const monthEnd = dayOfMonth >= dim - 3 || dayOfMonth <= 5;
  const endMonth = dayOfMonth <= 5 ? ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)) : ym(now);
  const pct = m.target ? Math.min(100, Math.round(m.actual / m.target * 100)) : 0;
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  return `
  <div class="today-head"><div><p class="muted">${esc(fmtDateLong(t))}</p><h2>${greet}${state.settings.yourName ? ', ' + esc(state.settings.yourName.split(' ')[0]) : ''}</h2></div>
    <div class="btn-row"><button class="btn primary" data-action="new-session" data-date="${t}">${icon('plus')} Log session</button><button class="btn" data-action="quick-import">${icon('import')} Quick Import</button></div></div>
  ${syncBannerHtml()}
  ${backupDue() ? `<div class="banner warn" data-testid="backup-reminder">${icon('cloud')}<div><b>${state.settings.lastBackupAt ? 'It’s been over a month since your last backup' : 'You haven’t backed up yet'}</b><small>Your data lives only on this device. Save a backup to Files / iCloud Drive.</small></div><button class="btn small primary" data-action="backup-export">Back up now</button><button class="icon-btn" data-action="dismiss-backup-reminder" aria-label="Dismiss backup reminder">${icon('close')}</button></div>` : ''}
  ${hasSampleData() ? `<div class="banner tip">${icon('info')}<div><b>You’re looking at sample data</b><small>All names, emails and bank details are fictional. Clear it before entering real students.</small></div><button class="btn small" data-action="clear-sample">Clear sample data</button></div>` : ''}
  <div class="kpis">
    <button class="kpi" data-action="go" data-to="#/money"><small>Earned in ${esc(fmtMonth(ym(now), { month: 'long' }))}</small><b>${money(m.actual)}</b>${m.target ? `<div class="bar"><i style="width:${pct}%"></i></div><small>${pct}% of ${money(m.target)} target</small>` : ''}</button>
    <button class="kpi" data-action="go" data-to="#/money"><small>Forecast this month</small><b>${money(m.forecast)}</b><small>${m.scheduledCount} still scheduled</small></button>
    <button class="kpi" data-action="go" data-to="#/sessions"><small>Sessions today</small><b>${todays.filter(s => s.status !== 'cancelled').length}</b><small>${upcoming.length} more in the next 7 days</small></button>
    <button class="kpi" data-action="go" data-to="#/tasks"><small>Open tasks</small><b>${state.tasks.filter(x => x.status !== 'done' && x.type === 'mine').length}</b><small>${state.tasks.filter(x => x.status !== 'done' && x.type === 'homework').length} homework open</small></button>
  </div>
  ${monthEnd ? `<div class="banner">${icon('file')}<div><b>Month-end for ${esc(fmtMonth(endMonth))}</b><small>Send Guidewell invoice, Luba Jones hours and parent emails.</small></div><button class="btn small" data-action="go" data-to="#/money" data-month="${endMonth}">Open checklist ${icon('arrowR')}</button></div>` : ''}
  ${unmarked.length ? `<div class="banner warn">${icon('alert')}<div><b>${unmarked.length} past session${unmarked.length === 1 ? '' : 's'} not marked</b><small>Mark them completed or cancelled so totals are right.</small></div><button class="btn small" data-action="mark-past-complete">Mark all completed</button></div>` : ''}
  ${todayCalendarCard()}
  <div class="cols">
    <section class="card"><header class="card-head"><h3>Today’s sessions</h3><button class="icon-btn" data-action="new-session" data-date="${t}" aria-label="Add session">${icon('plus')}</button></header>
      ${todays.length ? `<div class="list">${todays.map(s => sessionRow(s)).join('')}</div>` : emptyState('sessions', 'No sessions today', 'Enjoy the breather, or log one now.', `<button class="btn small" data-action="new-session" data-date="${t}">Log session</button>`)}
      ${upcoming.length ? `<h4 class="sub">Coming up</h4><div class="list">${upcoming.slice(0, 6).map(s => sessionRow(s, { showDate: true, actions: false })).join('')}</div>` : ''}
    </section>
    <div class="stack">
      <section class="card"><header class="card-head"><h3>My tasks</h3><button class="icon-btn" data-action="new-task" data-type="mine" aria-label="Add task">${icon('plus')}</button></header>
        ${myTasks.length ? `<div class="list">${myTasks.map(taskRow).join('')}</div>` : emptyState('tasks', 'Nothing urgent', 'Tasks due in the next few days show here.')}</section>
      <section class="card"><header class="card-head"><h3>Homework due this week</h3><button class="icon-btn" data-action="new-task" data-type="homework" aria-label="Add homework">${icon('plus')}</button></header>
        ${hw.length ? `<div class="list">${hw.map(taskRow).join('')}</div>` : emptyState('tasks', 'No homework due', 'Set homework from a student’s page.')}</section>
    </div>
  </div>`;
}
