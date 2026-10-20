import { state, sessionsInMonth, sessionsOn, studentById, sessionValue, monthStats, SESSION_STATUS } from '../store.js';
import { esc, money, ym, ymd, fmtDate, fmtDateLong, fmtMonth, todayStr, monthDays, parseYmd, fmtHours } from '../util.js';
import { icon, emptyState } from '../ui.js';
import { ui } from '../uistate.js';
import { labelHex } from '../forms.js';
import { sessionRow } from './today.js';

export const title = 'Sessions';

function calendar(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday start
  const dim = monthDays(month); const t = todayStr();
  const byDate = {};
  for (const s of sessionsInMonth(month)) (byDate[s.date] ||= []).push(s);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="cal-cell pad"></div>';
  for (let d = 1; d <= dim; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const list = byDate[date] || [];
    const evs = list.slice(0, 3).map(s => { const st = studentById(s.studentId); return `<span class="cal-ev ${s.status}" style="--lbl:${labelHex(st?.labelColor)}" title="${esc(s.start)} ${esc(st?.name || '')}">${esc(st?.label || st?.name?.split(' ')[0] || '?')} <small>${esc(s.start)}</small></span>`; }).join('');
    const dots = list.slice(0, 5).map(s => `<i style="background:${labelHex(studentById(s.studentId)?.labelColor)}" class="${s.status}"></i>`).join('');
    cells += `<button class="cal-cell ${date === t ? 'today' : ''} ${date === ui.date ? 'sel' : ''} ${list.length ? 'has' : ''}" data-action="pick-date" data-date="${date}" aria-label="${esc(fmtDateLong(date))}, ${list.length} sessions">
      <span class="cal-d">${d}</span><span class="cal-evs">${evs}${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}</span><span class="cal-dots">${dots}</span></button>`;
  }
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="cal-dow">${x}</div>`).join('');
  return `<div class="calendar card"><div class="cal-grid">${dow}${cells}</div></div>`;
}

function dayPanel(date) {
  const list = sessionsOn(date);
  const total = list.filter(s => SESSION_STATUS[s.status]?.forecast).reduce((a, s) => a + sessionValue(s), 0);
  return `<section class="card day-panel"><header class="card-head"><div><h3>${esc(fmtDateLong(date))}</h3><small class="muted">${list.length} session${list.length === 1 ? '' : 's'} · ${money(total)}</small></div>
    <button class="btn small primary" data-action="new-session" data-date="${date}">${icon('plus')} Add</button></header>
    ${list.length ? `<div class="list">${list.map(s => sessionRow(s)).join('')}</div>` : emptyState('sessions', 'Nothing booked', 'Tap Add to log a session on this day.')}</section>`;
}

function monthList(month) {
  const list = sessionsInMonth(month);
  if (!list.length) return emptyState('sessions', `No sessions in ${fmtMonth(month)}`, 'Log a session or paste your TimeTree events with Quick Import.', `<button class="btn small primary" data-action="new-session">${icon('plus')} Log session</button><button class="btn small" data-action="quick-import">${icon('import')} Quick Import</button>`);
  const groups = {};
  list.forEach(s => (groups[s.date] ||= []).push(s));
  return Object.entries(groups).map(([d, ss]) => `<section class="day-group"><h4 class="sub ${d === todayStr() ? 'today' : ''}">${esc(fmtDateLong(d))}</h4><div class="list">${ss.map(s => sessionRow(s)).join('')}</div></section>`).join('');
}

export function monthNav(key, month) {
  return `<div class="month-nav"><button class="icon-btn" data-action="month-shift" data-key="${key}" data-n="-1" aria-label="Previous month">${icon('chevL')}</button>
    <h3>${esc(fmtMonth(month))}</h3><button class="icon-btn" data-action="month-shift" data-key="${key}" data-n="1" aria-label="Next month">${icon('chevR')}</button>
    ${month !== ym(new Date()) ? `<button class="btn small ghost" data-action="month-today" data-key="${key}">Today</button>` : ''}</div>`;
}

export function render() {
  const month = ui.month;
  if (!ui.date || !ui.date.startsWith(month)) ui.date = month === ym(new Date()) ? todayStr() : `${month}-01`;
  const st = monthStats(month);
  const tip = state.students.length && !state.settings.timetreeTipDismissed ? `<div class="banner tip">${icon('tag')}<div><b>TimeTree tip</b><small>Start each TimeTree event title with the student’s full name (e.g. “Student A – Maths”) so Quick Import matches it automatically.</small></div><button class="btn small" data-action="timetree-tip">How it works</button><button class="icon-btn" data-action="dismiss-tip" aria-label="Dismiss tip">${icon('close')}</button></div>` : '';
  const head = `<div class="view-tools">${monthNav('month', month)}
    <div class="seg compact" role="tablist"><button class="${ui.sessionsMode === 'calendar' ? 'on' : ''}" data-action="sessions-mode" data-mode="calendar">${icon('sessions')} Month</button><button class="${ui.sessionsMode === 'list' ? 'on' : ''}" data-action="sessions-mode" data-mode="list">${icon('list')} List</button></div></div>
    <div class="stat-strip"><span><b>${st.sessions.length}</b> sessions</span><span><b>${fmtHours(st.actualMins)}</b> billed</span><span><b>${money(st.actual)}</b> actual</span><span><b>${money(st.forecast)}</b> forecast</span></div>`;
  const body = ui.sessionsMode === 'list' ? `<div class="card">${monthList(month)}</div>` : `<div class="cal-layout">${calendar(month)}${dayPanel(ui.date)}</div>`;
  return { html: tip + head + body, actions: `<button class="btn" data-action="export-csv" data-month="${month}" title="Export CSV">${icon('download')}<span class="hide-sm"> CSV</span></button><button class="btn" data-action="quick-import">${icon('import')}<span class="hide-sm"> Quick Import</span></button><button class="btn primary" data-action="new-session" data-date="${ui.date}">${icon('plus')}<span class="hide-sm"> Session</span></button>` };
}
