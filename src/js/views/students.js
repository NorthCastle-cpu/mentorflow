import { state, studentById, sessionValue, monthStats, SESSION_STATUS, INVOICE_METHODS, sortSessions } from '../store.js';
import { esc, money, ym, fmtDate, fmtHours, todayStr, round2 } from '../util.js';
import { icon, emptyState, avatar, chip } from '../ui.js';
import { ui } from '../uistate.js';
import { labelHex } from '../forms.js';
import { sessionRow, taskRow } from './today.js';

export const title = 'Students';

function listHtml(selectedId) {
  const q = (ui.studentQuery || '').toLowerCase();
  const f = ui.studentFilter || 'active';
  let list = state.students.filter(s => f === 'all' ? true : f === 'inactive' ? s.active === false : f in INVOICE_METHODS ? s.invoiceMethod === f && s.active !== false : s.active !== false);
  if (q) list = list.filter(s => [s.name, s.subject, s.parentName, s.label].join(' ').toLowerCase().includes(q));
  list.sort((a, b) => a.name.localeCompare(b.name));
  const month = ym(new Date());
  const filters = [['active', 'Active'], ['guidewell', 'Guidewell'], ['luba', 'Luba Jones'], ['direct', 'Direct'], ['inactive', 'Inactive'], ['all', 'All']];
  return `<div class="list-pane">
    <div class="toolbar"><div class="search-inline">${icon('search')}<input type="search" placeholder="Filter students" value="${esc(ui.studentQuery)}" data-input="student-query" aria-label="Filter students"></div></div>
    <div class="chips-row">${filters.map(([k, l]) => `<button class="chip-btn ${f === k ? 'on' : ''}" data-action="student-filter" data-f="${k}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="list">${list.map(s => {
      const ms = state.sessions.filter(x => x.studentId === s.id && x.date.startsWith(month) && SESSION_STATUS[x.status]?.billable);
      return `<a class="row-item student ${s.id === selectedId ? 'sel' : ''}" href="#/students/${s.id}">${avatar(s.name, labelHex(s.labelColor))}
        <span class="who"><b>${esc(s.name)}</b><small>${esc(s.subject || '—')}</small></span>
        <span class="val">${chip(INVOICE_METHODS[s.invoiceMethod]?.label || '', 'm-' + s.invoiceMethod)}<small>${ms.length} this month</small></span></a>`;
    }).join('')}</div>` : (state.students.length ? emptyState('search', 'No matches', 'Try a different filter.') : emptyState('students', 'No students yet', 'Add a student to start logging sessions.', `<button class="btn primary small" data-action="new-student">${icon('plus')} Add student</button><button class="btn small" data-action="sample-data">Load sample data</button>`))}
  </div>`;
}

function detailHtml(s) {
  if (!s) return `<div class="detail-pane placeholder">${emptyState('students', 'Select a student', 'Their sessions, homework and notes appear here.')}</div>`;
  const sessions = state.sessions.filter(x => x.studentId === s.id).sort(sortSessions);
  const t = todayStr(); const month = ym(new Date());
  const past = sessions.filter(x => x.date <= t).reverse().slice(0, 8);
  const next = sessions.filter(x => x.date > t && x.status === 'scheduled').slice(0, 4);
  const billable = sessions.filter(x => SESSION_STATUS[x.status]?.billable);
  const thisMonth = billable.filter(x => x.date.startsWith(month));
  const hw = state.tasks.filter(x => x.studentId === s.id && x.type === 'homework').sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '').localeCompare(b.due || ''));
  const totalMins = billable.reduce((a, x) => a + +x.duration, 0);
  return `<div class="detail-pane">
    <a class="back-link only-phone" href="#/students">${icon('chevL')} Students</a>
    <div class="detail-head" style="--lbl:${labelHex(s.labelColor)}">${avatar(s.name, labelHex(s.labelColor))}<div><h2>${esc(s.name)}</h2><p class="muted">${esc(s.subject || '')}${s.active === false ? ' · Inactive' : ''}</p></div>
      <div class="btn-row"><button class="btn" data-action="edit-student" data-id="${s.id}">${icon('edit')} Edit</button><button class="btn primary" data-action="new-session" data-student="${s.id}">${icon('plus')} Session</button></div></div>
    <div class="kpis small">
      <div class="kpi"><small>Invoice</small><b>${esc(INVOICE_METHODS[s.invoiceMethod]?.label || '')}</b></div>
      <div class="kpi"><small>Rate</small><b>${money(s.rate ?? state.settings.defaultRate)}/h</b></div>
      <div class="kpi"><small>This month</small><b>${money(round2(thisMonth.reduce((a, x) => a + sessionValue(x), 0)))}</b><small>${thisMonth.length} sessions</small></div>
      <div class="kpi"><small>All time</small><b>${fmtHours(totalMins)}</b><small>${billable.length} sessions</small></div>
    </div>
    <div class="cols">
      <section class="card"><header class="card-head"><h3>Sessions</h3><button class="icon-btn" data-action="new-session" data-student="${s.id}" aria-label="Add session">${icon('plus')}</button></header>
        ${next.length ? `<h4 class="sub">Upcoming</h4><div class="list">${next.map(x => sessionRow(x, { showDate: true, actions: false })).join('')}</div>` : ''}
        ${past.length ? `<h4 class="sub">Recent</h4><div class="list">${past.map(x => sessionRow(x, { showDate: true })).join('')}</div>` : (!next.length ? emptyState('sessions', 'No sessions yet', 'Log the first session or Quick Import from TimeTree.') : '')}
      </section>
      <div class="stack">
        <section class="card"><header class="card-head"><h3>Homework</h3><button class="icon-btn" data-action="new-task" data-type="homework" data-student="${s.id}" aria-label="Add homework">${icon('plus')}</button></header>
          ${hw.length ? `<div class="list">${hw.map(taskRow).join('')}</div>` : emptyState('tasks', 'No homework set', 'Add homework to track it on the board.')}</section>
        <section class="card"><header class="card-head"><h3>Contact & notes</h3></header>
          <dl class="dl"><dt>Parent</dt><dd>${esc(s.parentName || '—')}</dd>
          <dt>Email</dt><dd>${s.parentEmail ? `<a href="mailto:${esc(s.parentEmail)}">${esc(s.parentEmail)}</a>` : '—'}</dd>
          <dt>Phone</dt><dd>${s.parentPhone ? `<a href="tel:${esc(s.parentPhone)}">${esc(s.parentPhone)}</a>` : '—'}</dd>
          <dt>TimeTree label</dt><dd>${s.label ? `<span class="lbl-dot" style="--lbl:${labelHex(s.labelColor)}"></span>${esc(s.label)}` : '<span class="muted">Not set – uses name</span>'}</dd></dl>
          ${s.notes ? `<p class="notes">${esc(s.notes).replace(/\n/g, '<br>')}</p>` : ''}</section>
      </div>
    </div></div>`;
}

export function render(params) {
  const id = params[0];
  const s = id ? studentById(id) : null;
  return { html: `<div class="split ${id ? 'has-detail' : ''}">${listHtml(id)}${detailHtml(s)}</div>`, actions: `<button class="btn primary" data-action="new-student">${icon('plus')}<span class="hide-sm"> Student</span></button>`, title: s ? s.name : title };
}
