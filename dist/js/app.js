import { state, load, subscribe, saveSession, saveTask, saveSettings, setChecklist, loadSampleData, clearSampleData, hasSampleData, eraseAll, exportBackup, importBackup, validateBackup, studentById, studentName, sessionValue, INVOICE_METHODS, SESSION_STATUS, expensesInMonth } from './store.js';
import { requestPersistence } from './db.js';
import { esc, money, fmtDate, todayStr, ym, addMonths, download, copyText, toCsv, debounce, fmtMonth } from './util.js';
import { icon, openSheet, closeSheet, sheetHeader, sheetOpen, toast, confirmDialog, avatar } from './ui.js';
import { ui, setUi } from './uistate.js';
import { studentForm, sessionForm, taskForm, expenseForm, quickImport, timetreeTip, labelHex } from './forms.js';
import { downloadSessionsCsv, downloadLubaCsv, guidewellPdf, openPrintableInvoice, parentEmail } from './export.js';
import * as Today from './views/today.js';
import * as Students from './views/students.js';
import * as Sessions from './views/sessions.js';
import * as Tasks from './views/tasks.js';
import * as Money from './views/money.js';
import * as Expenses from './views/expenses.js';
import * as More from './views/more.js';

const ROUTES = [
  { key: 'today', label: 'Today', icon: 'today', view: Today },
  { key: 'students', label: 'Students', icon: 'students', view: Students },
  { key: 'sessions', label: 'Sessions', icon: 'sessions', view: Sessions },
  { key: 'tasks', label: 'Tasks', icon: 'tasks', view: Tasks },
  { key: 'money', label: 'Money', icon: 'money', view: Money },
  { key: 'expenses', label: 'Expenses', icon: 'expenses', view: Expenses, phoneHidden: true },
  { key: 'more', label: 'More', icon: 'more', view: More },
];

// ---------- theme ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = state.settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b1416' : '#f6f8f8');
}
mq.addEventListener?.('change', applyTheme);

// ---------- shell ----------
function shell() {
  const nav = (cls) => ROUTES.filter(r => !(cls === 'tab' && r.phoneHidden)).map(r => `<a class="${cls}" href="#/${r.key}" data-route="${r.key}">${icon(r.icon)}<span>${r.label}</span></a>`).join('');
  document.getElementById('app').innerHTML = `
  <aside class="sidebar"><div class="brand"><span class="brand-mark">${icon('sparkle')}</span><b>MentorFlow</b></div>
    <button class="search-btn" data-action="open-search">${icon('search')}<span>Search</span><kbd>⌘K</kbd></button>
    <nav class="side-nav">${nav('side-link')}</nav>
    <div class="side-foot"><button class="btn primary block" data-action="new-session">${icon('plus')} Log session</button></div></aside>
  <main class="main"><header class="topbar"><h1 id="view-title">MentorFlow</h1><div class="top-actions"><button class="icon-btn only-phone" data-action="open-search" aria-label="Search">${icon('search')}</button><span id="view-actions"></span></div></header>
    <div id="view" class="view" tabindex="-1"></div></main>
  <nav class="tabbar">${nav('tab')}</nav>`;
}

function parseHash() {
  const h = (location.hash || '#/today').replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { key: parts[0] || 'today', params: parts.slice(1), query: new URLSearchParams(query || '') };
}

let lastKey = null;
function render() {
  if (!state.ready) return;
  const { key, params } = parseHash();
  const route = ROUTES.find(r => r.key === key) || ROUTES[0];
  const out = route.view.render(params);
  const res = typeof out === 'string' ? { html: out } : out;
  const view = document.getElementById('view');
  const scroll = lastKey === route.key + params.join('/') ? document.scrollingElement.scrollTop : 0;
  // keep focus on filter inputs across re-render
  const focused = document.activeElement?.dataset?.input; const selStart = document.activeElement?.selectionStart;
  view.innerHTML = res.html;
  view.dataset.view = route.key;
  document.getElementById('view-actions').innerHTML = res.actions || '';
  const ttl = res.title || route.view.title;
  document.getElementById('view-title').textContent = ttl;
  document.title = `${ttl} · MentorFlow`;
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route.key || (route.key === 'expenses' && a.dataset.route === 'money' && a.classList.contains('tab'))));
  if (focused) { const el = view.querySelector(`[data-input="${focused}"]`); if (el) { el.focus(); try { el.setSelectionRange(selStart, selStart); } catch {} } }
  if (lastKey !== route.key + params.join('/')) window.scrollTo(0, 0); else document.scrollingElement.scrollTop = scroll;
  lastKey = route.key + params.join('/');
}

// ---------- actions ----------
const go = (to) => { if (location.hash !== to) location.hash = to; else render(); };
const ACTIONS = {
  'close-sheet': () => closeSheet(),
  go: (el) => { if (el.dataset.month) setUi({ moneyMonth: el.dataset.month }); go(el.dataset.to); },
  'new-student': () => studentForm(),
  'edit-student': (el) => studentForm(el.dataset.id),
  'new-session': (el) => sessionForm(null, { date: el.dataset.date, studentId: el.dataset.student }),
  'edit-session': (el) => sessionForm(el.dataset.id),
  'new-task': (el) => taskForm(null, { type: el.dataset.type || ui.taskBoard, studentId: el.dataset.student, status: el.dataset.status }),
  'edit-task': (el) => taskForm(el.dataset.id),
  'new-expense': () => expenseForm(null, { date: ui.expMonth === ym(new Date()) ? todayStr() : ui.expMonth + '-01' }),
  'edit-expense': (el) => expenseForm(el.dataset.id),
  'quick-import': () => quickImport(),
  'timetree-tip': () => timetreeTip(),
  'dismiss-tip': () => saveSettings({ timetreeTipDismissed: true }),
  'open-search': () => openSearch(),
  'set-status': (el) => { const s = state.sessions.find(x => x.id === el.dataset.id); if (s) { saveSession({ ...s, status: el.dataset.status }); toast(el.dataset.status === 'completed' ? `Completed · ${money(sessionValue(s))}` : 'Session cancelled', { type: 'ok' }); } },
  'mark-past-complete': async (el) => {
    const t = todayStr(); const list = state.sessions.filter(s => s.status === 'scheduled' && s.date < t && (!el.dataset.month || s.date.startsWith(el.dataset.month)));
    if (await confirmDialog(`Mark ${list.length} past session${list.length === 1 ? '' : 's'} as completed?`, { confirmText: 'Mark completed', title: 'Mark completed' })) { list.forEach(s => saveSession({ ...s, status: 'completed' })); toast(`${list.length} marked completed`, { type: 'ok' }); }
  },
  'toggle-task': (el) => { const t = state.tasks.find(x => x.id === el.dataset.id); if (t) saveTask({ ...t, status: el.checked ? 'done' : 'todo' }); },
  'move-task': (el) => { const t = state.tasks.find(x => x.id === el.dataset.id); if (t) saveTask({ ...t, status: el.dataset.status }); },
  'task-board': (el) => { setUi({ taskBoard: el.dataset.board }); render(); },
  'task-mode': (el) => { setUi({ taskMode: el.dataset.mode }); render(); },
  'sessions-mode': (el) => { setUi({ sessionsMode: el.dataset.mode }); render(); },
  'pick-date': (el) => { setUi({ date: el.dataset.date }); render(); if (matchMedia('(max-width: 899px)').matches) document.querySelector('.day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'month-shift': (el) => shiftMonth(el.dataset.key, +el.dataset.n),
  'month-today': (el) => { setUi({ [el.dataset.key]: ym(new Date()), date: todayStr() }); render(); },
  'student-filter': (el) => { setUi({ studentFilter: el.dataset.f }); render(); },
  'export-csv': (el) => { downloadSessionsCsv(el.dataset.month || ui.month); toast('Sessions CSV downloaded', { type: 'ok' }); },
  'export-all-csv': () => {
    const rows = [['Date', 'Start', 'Duration (mins)', 'Student', 'Invoice method', 'Status', 'Value (GBP)', 'Notes']];
    [...state.sessions].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).forEach(s => rows.push([s.date, s.start, s.duration, studentName(s.studentId), INVOICE_METHODS[studentById(s.studentId)?.invoiceMethod]?.label || '', SESSION_STATUS[s.status]?.label, SESSION_STATUS[s.status]?.billable ? sessionValue(s).toFixed(2) : '0.00', s.notes || '']));
    download(`mentorflow-all-sessions-${todayStr()}.csv`, toCsv(rows), 'text/csv'); toast('CSV downloaded', { type: 'ok' });
  },
  'export-expenses': (el) => {
    const m = el.dataset.month; const rows = [['Date', 'Category', 'Description', 'Amount (GBP)', 'Recurring']];
    expensesInMonth(m).forEach(e => rows.push([e._recurringInstance ? m + e.date.slice(7) : e.date, e.category, e.description || '', (+e.amount).toFixed(2), e.recurring ? 'Monthly' : '']));
    download(`mentorflow-expenses-${m}.csv`, toCsv(rows), 'text/csv'); toast('Expenses CSV downloaded', { type: 'ok' });
  },
  'luba-csv': (el) => { downloadLubaCsv(el.dataset.month); setChecklist(el.dataset.month, 'lj-csv', true); toast('Luba Jones hours CSV downloaded', { type: 'ok' }); },
  'guidewell-pdf': async (el) => {
    try { const r = await guidewellPdf(el.dataset.month); setChecklist(el.dataset.month, 'gw-invoice', true); toast(`Invoice ${r.invoice.invoiceNo} downloaded`, { type: 'ok' }); }
    catch (e) { console.error(e); toast('PDF failed – opening printable invoice instead', { type: 'warn' }); openPrintableInvoice(el.dataset.month); }
  },
  'guidewell-print': (el) => { openPrintableInvoice(el.dataset.month); },
  'mark-sent': (el) => { setChecklist(el.dataset.month, el.dataset.key, true); return 'default'; },
  'copy-parent': async (el) => { const e = parentEmail(el.dataset.month, el.dataset.id); const ok = await copyText(`To: ${e.to}\nSubject: ${e.subject}\n\n${e.body}`); toast(ok ? 'Email text copied' : 'Copy failed', { type: ok ? 'ok' : 'warn' }); },
  'backup-export': () => backupNow(),
  'restore-backup': () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'; inp.style.display = 'none'; document.body.appendChild(inp); inp.addEventListener('change', () => { restoreFromFile(inp.files?.[0]).finally(() => inp.remove()); }); inp.click(); },
  'dismiss-backup-reminder': () => saveSettings({ backupReminderDismissedAt: new Date().toISOString() }),
  'sample-data': async () => {
    if (hasSampleData()) { toast('Sample data is already loaded'); return; }
    await loadSampleData(); toast('Sample data loaded', { type: 'ok' }); go('#/today');
  },
  'clear-sample': async () => {
    if (!(await confirmDialog('Remove all sample students, sessions, tasks and expenses (and the placeholder profile)? Your own records are kept.', { confirmText: 'Clear sample data', title: 'Clear sample data?' }))) return;
    const n = await clearSampleData(); toast(`Removed ${n} sample records`, { type: 'ok' });
  },
  'erase-all': async () => {
    if (!(await confirmDialog('This permanently deletes every student, session, task, expense and setting on this device. Export a backup first if you might need it.', { confirmText: 'Erase everything', danger: true, title: 'Erase all data?' }))) return;
    await eraseAll(); applyTheme(); toast('All data erased'); go('#/today');
  },
};

// ---------- backup / restore ----------
async function backupNow() {
  const json = JSON.stringify(exportBackup(), null, 2);
  const name = `mentorflow-backup-${todayStr()}.json`;
  const markDone = () => saveSettings({ lastBackupAt: new Date().toISOString() });
  // iPad/iPhone: share sheet → "Save to Files" (iCloud Drive). Falls back to a normal download elsewhere.
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'MentorFlow backup' });
      markDone(); toast('Backup shared – keep it somewhere safe', { type: 'ok' }); return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') { toast('Backup cancelled'); return 'cancelled'; }
    console.warn('Share failed, falling back to download', e);
  }
  download(name, json, 'application/json'); markDone(); toast('Backup downloaded', { type: 'ok' }); return 'downloaded';
}

async function restoreFromFile(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); validateBackup(data); }
  catch (e) { toast('Not a valid MentorFlow backup: ' + e.message, { type: 'warn', ms: 4500 }); return; }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('en-GB') : 'unknown date';
  const ok = await confirmDialog(`Restore “${file.name}” from ${when}? This REPLACES everything on this device with the backup (${data.students.length} students, ${data.sessions.length} sessions, ${data.tasks.length} tasks, ${data.expenses.length} expenses).`, { confirmText: 'Replace my data', danger: true, title: 'Restore from backup?' });
  if (!ok) return;
  try { await importBackup(data, 'replace'); applyTheme(); toast('Backup restored', { type: 'ok' }); go('#/today'); }
  catch (e) { toast('Restore failed: ' + e.message, { type: 'warn', ms: 4500 }); }
}

function shiftMonth(key, n) {
  const patch = { [key]: addMonths(ui[key], n) };
  if (key === 'month') patch.date = null;
  setUi(patch); render();
}

const CHANGE = {
  checklist: (el) => setChecklist(el.dataset.month, el.dataset.key, el.checked),
  'task-student': (el) => { setUi({ taskStudent: el.value }); render(); },
  'backup-import': async (el) => { await restoreFromFile(el.files?.[0]); el.value = ''; },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') { fn(el, e); return; }
  const r = fn(el, e);
  if (r !== 'default') e.preventDefault();
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.change && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el, e);
  else if (el.hasAttribute('data-setting')) saveSettingField(el);
});
const saveSettingField = (el) => {
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number') v = el.value === '' ? '' : +el.value;
  saveSettings({ [el.name]: v }); if (el.name === 'theme') applyTheme();
};
const debouncedSetting = debounce(saveSettingField, 500);
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.input === 'student-query') { setUi({ studentQuery: el.value }); render(); }
  else if (el.hasAttribute('data-setting') && el.type !== 'radio') { suppressRender = true; debouncedSetting(el); }
});
let suppressRender = false;

// ---------- kanban drag & drop (mouse + iPad pointer/drag) ----------
let dragId = null;
document.addEventListener('dragstart', (e) => { const c = e.target.closest?.('[data-drag-id]'); if (!c) return; dragId = c.dataset.dragId; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch {} });
document.addEventListener('dragend', (e) => { e.target.closest?.('[data-drag-id]')?.classList.remove('dragging'); document.querySelectorAll('.drop-over').forEach(x => x.classList.remove('drop-over')); });
document.addEventListener('dragover', (e) => { const col = e.target.closest?.('[data-drop]'); if (col && dragId) { e.preventDefault(); document.querySelectorAll('.drop-over').forEach(x => x !== col && x.classList.remove('drop-over')); col.classList.add('drop-over'); } });
document.addEventListener('drop', (e) => { const col = e.target.closest?.('[data-drop]'); if (!col || !dragId) return; e.preventDefault(); const t = state.tasks.find(x => x.id === dragId); dragId = null; if (t && t.status !== col.dataset.drop) saveTask({ ...t, status: col.dataset.drop }); });

// ---------- global search ----------
function searchResults(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const has = (...xs) => xs.join(' ').toLowerCase().includes(q);
  const out = [];
  state.students.filter(s => has(s.name, s.subject, s.parentName, s.parentEmail, s.label, s.notes)).slice(0, 8).forEach(s => out.push({ group: 'Students', html: `${avatar(s.name, labelHex(s.labelColor))}<span><b>${esc(s.name)}</b><small>${esc(s.subject || '')} · ${esc(INVOICE_METHODS[s.invoiceMethod]?.label || '')}</small></span>`, run: () => go('#/students/' + s.id) }));
  state.sessions.filter(s => has(studentName(s.studentId), s.date, fmtDate(s.date), s.notes, SESSION_STATUS[s.status]?.label)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).forEach(s => out.push({ group: 'Sessions', html: `<span><b>${esc(studentName(s.studentId))} · ${esc(fmtDate(s.date))} ${esc(s.start)}</b><small>${esc(SESSION_STATUS[s.status]?.label)} · ${money(sessionValue(s))}${s.notes ? ' · ' + esc(s.notes) : ''}</small></span>`, run: () => sessionForm(s.id) }));
  state.tasks.filter(t => has(t.title, t.notes, t.studentId ? studentName(t.studentId) : '')).slice(0, 8).forEach(t => out.push({ group: t.type === 'homework' ? 'Homework' : 'Tasks', html: `<span><b>${esc(t.title)}</b><small>${t.studentId ? esc(studentName(t.studentId)) + ' · ' : ''}${t.due ? 'Due ' + esc(fmtDate(t.due)) : 'No due date'} · ${t.status === 'done' ? 'Done' : 'Open'}</small></span>`, run: () => taskForm(t.id) }));
  state.expenses.filter(x => has(x.description, x.category, x.date)).slice(0, 6).forEach(x => out.push({ group: 'Expenses', html: `<span><b>${esc(x.description || x.category)}</b><small>${esc(fmtDate(x.date))} · ${money(x.amount)}</small></span>`, run: () => expenseForm(x.id) }));
  const pages = ROUTES.filter(r => r.label.toLowerCase().includes(q)).map(r => ({ group: 'Go to', html: `${icon(r.icon)}<span><b>${r.label}</b></span>`, run: () => go('#/' + r.key) }));
  return [...pages, ...out];
}
function openSearch() {
  if (document.querySelector('.search-sheet')) return;
  const sheet = openSheet(`<div class="search-sheet"><div class="search-bar">${icon('search')}<input type="search" id="gs-input" placeholder="Search students, sessions, tasks, expenses…" autocomplete="off" autofocus aria-label="Search"><button class="btn small ghost" data-action="close-sheet">Cancel</button></div><div id="gs-results" class="gs-results"><p class="muted center small">Type to search. Tip: press <kbd>/</kbd> or <kbd>⌘K</kbd> anywhere.</p></div></div>`, { wide: true });
  const input = sheet.querySelector('#gs-input'); const box = sheet.querySelector('#gs-results');
  let results = []; let sel = 0;
  const draw = () => {
    if (!input.value.trim()) { box.innerHTML = '<p class="muted center small">Type to search. Tip: press <kbd>/</kbd> or <kbd>⌘K</kbd> anywhere.</p>'; return; }
    if (!results.length) { box.innerHTML = `<p class="muted center">No results for “${esc(input.value)}”</p>`; return; }
    let g = null; box.innerHTML = results.map((r, i) => `${r.group !== g ? `<h4 class="sub">${esc(g = r.group)}</h4>` : ''}<button class="gs-item ${i === sel ? 'sel' : ''}" data-i="${i}">${r.html}</button>`).join('');
  };
  input.addEventListener('input', () => { results = searchResults(input.value); sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); draw(); e.preventDefault(); box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && results[sel]) { const r = results[sel]; closeSheet(); r.run(); }
  });
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { const r = results[+b.dataset.i]; closeSheet(); r.run(); } });
  setTimeout(() => input.focus(), 50);
}

function shortcutsHelp() {
  openSheet(`${sheetHeader('Keyboard shortcuts')}<div class="sheet-body"><dl class="dl kbd-list">${More.SHORTCUTS.map(([k, d]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(d)}</dd>`).join('')}</dl></div>`);
}

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (sheetOpen() && document.querySelector('.search-sheet')) closeSheet(); else openSearch(); return; }
  if (e.key === 'Escape' && sheetOpen()) { e.preventDefault(); closeSheet(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || sheetOpen()) return;
  const k = e.key;
  if (/^[1-7]$/.test(k)) { go('#/' + ROUTES[+k - 1].key); return; }
  const map = { '/': openSearch, n: () => sessionForm(null, { date: parseHash().key === 'sessions' ? ui.date : todayStr() }), a: () => studentForm(), t: () => taskForm(null, { type: ui.taskBoard }), e: () => expenseForm(), i: quickImport, '?': shortcutsHelp,
    '[': () => monthKeyShift(-1), ']': () => monthKeyShift(1) };
  if (map[k]) { e.preventDefault(); map[k](); }
});
function monthKeyShift(n) { const key = { sessions: 'month', money: 'moneyMonth', expenses: 'expMonth' }[parseHash().key]; if (key) shiftMonth(key, n); }

// ---------- boot ----------
subscribe(() => { applyTheme(); if (suppressRender) { suppressRender = false; return; } render(); });
window.addEventListener('hashchange', render);

async function boot() {
  shell();
  try { await load(); } catch (e) { console.error(e); document.getElementById('view').innerHTML = `<div class="card"><h3>Could not open local storage</h3><p>${esc(e.message)}</p></div>`; return; }
  applyTheme(); render();
  document.documentElement.classList.add('ready');
  requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready – reopen MentorFlow to use it', { ms: 5000 }); });
      });
    }).catch(err => console.warn('SW registration failed', err));
  }
}
window.__mentorflow = { state, ui }; // handy for debugging / tests
boot();
