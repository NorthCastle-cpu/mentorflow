// Create/edit sheets for every record type, plus Quick Import.
import { state, saveStudent, saveSession, saveTask, saveExpense, deleteStudent, deleteSession, deleteTask, deleteExpense, addSessionsBulk, INVOICE_METHODS, SESSION_STATUS, TASK_STATUS, EXPENSE_CATEGORIES, LABEL_COLORS, studentById, studentName } from './store.js';
import { openSheet, closeSheet, sheetHeader, toast, confirmDialog, icon } from './ui.js';
import { esc, todayStr, ymd, parseYmd, addDays, fmtDate, endTime, money } from './util.js';
import { parseQuickImport } from './parser.js';

const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(label)}</option>`;
const activeStudents = (includeId) => state.students.filter(s => s.active !== false || s.id === includeId).sort((a, b) => a.name.localeCompare(b.name));
export const labelHex = (key) => (LABEL_COLORS.find(c => c.key === key) || LABEL_COLORS[9]).hex;
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function bindForm(sheet, onSubmit) {
  const form = sheet.querySelector('form');
  form.addEventListener('submit', (e) => { e.preventDefault(); if (!form.reportValidity()) return; onSubmit(formData(form), form); });
  return form;
}

// ---------------- Student ----------------
export function studentForm(id) {
  const s = id ? studentById(id) : { invoiceMethod: 'guidewell', rate: state.settings.defaultRate, defaultDuration: state.settings.defaultDuration, labelColor: LABEL_COLORS[state.students.length % LABEL_COLORS.length].key, active: true };
  const methods = Object.values(INVOICE_METHODS).map(m => `<label class="seg-opt"><input type="radio" name="invoiceMethod" value="${m.key}" ${s.invoiceMethod === m.key ? 'checked' : ''}><span><b>${esc(m.label)}</b><small>${esc(m.desc)}</small></span></label>`).join('');
  const colors = LABEL_COLORS.map(c => `<label class="swatch" title="${c.key}"><input type="radio" name="labelColor" value="${c.key}" ${s.labelColor === c.key ? 'checked' : ''}><i style="background:${c.hex}"></i></label>`).join('');
  const sheet = openSheet(`${sheetHeader(id ? 'Edit student' : 'New student')}
  <form class="sheet-body form" id="student-form" autocomplete="off">
    <label class="field"><span>Name</span><input name="name" required value="${esc(s.name)}" placeholder="e.g. Student Name" autofocus></label>
    <label class="field"><span>Subject / focus</span><input name="subject" value="${esc(s.subject)}" placeholder="e.g. GCSE Maths"></label>
    <fieldset class="field"><legend>How do you invoice?</legend><div class="seg-cards">${methods}</div></fieldset>
    <div class="row2"><label class="field"><span>Hourly rate (£)</span><input name="rate" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(s.rate)}"></label>
    <label class="field"><span>Usual length (mins)</span><input name="defaultDuration" type="number" inputmode="numeric" min="5" step="5" value="${esc(s.defaultDuration || 60)}"></label></div>
    <div class="row2"><label class="field"><span>Parent / carer name</span><input name="parentName" value="${esc(s.parentName)}"></label>
    <label class="field"><span>Parent email</span><input name="parentEmail" type="email" value="${esc(s.parentEmail)}" inputmode="email"></label></div>
    <label class="field"><span>Parent phone</span><input name="parentPhone" type="tel" value="${esc(s.parentPhone)}"></label>
    <div class="field"><span>TimeTree label / calendar name <button type="button" class="link-btn" data-action="timetree-tip">${icon('info')} Tip</button></span>
      <input name="label" value="${esc(s.label)}" placeholder="The word you use in TimeTree event titles"></div>
    <div class="field"><span>Colour</span><div class="swatches">${colors}</div></div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="3">${esc(s.notes)}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Active student</label>
  </form>
  <footer class="sheet-foot">${id ? `<button class="btn danger ghost" data-x="del">${icon('trash')} Delete</button>` : ''}<span class="grow"></span><button class="btn" data-action="close-sheet">Cancel</button><button class="btn primary" type="submit" form="student-form">Save</button></footer>`);
  bindForm(sheet, (d) => {
    const rec = saveStudent({ ...s, ...d, name: d.name.trim(), rate: d.rate === '' ? null : +d.rate, defaultDuration: +d.defaultDuration || 60, active: !!d.active });
    closeSheet(); toast(id ? 'Student updated' : `Added ${rec.name}`, { type: 'ok' });
  });
  sheet.querySelector('[data-x=del]')?.addEventListener('click', async () => {
    const n = state.sessions.filter(x => x.studentId === id).length;
    if (await confirmDialog(`Delete ${s.name} and their ${n} session${n === 1 ? '' : 's'}? This cannot be undone.`, { confirmText: 'Delete', danger: true })) {
      deleteStudent(id); closeSheet(); location.hash = '#/students'; toast('Student deleted');
    }
  });
}

export function timetreeTip() {
  openSheet(`${sheetHeader('TimeTree label tip')}<div class="sheet-body prose">
  <p>Quick Import matches each pasted event to a student by looking for their <b>label</b>, then their <b>full name</b>, then their <b>first name</b> in the event title.</p>
  <ol><li>In TimeTree, start every lesson title with the student's label, e.g. <code>Student A – Maths</code> or <code>Student C (Bio)</code>.</li>
  <li>Give each student their own TimeTree <b>label colour</b> and pick the same colour here so the calendar looks familiar.</li>
  <li>If two students share a first name, set unique labels such as <code>Jo B</code> and <code>Jo K</code>.</li>
  <li>Open the day/week list in TimeTree, select the events, copy, and paste into <b>Sessions → Quick Import</b>. Lines with a date on their own act as headings for the events below them.</li>
  <li>Add <code>cancelled</code> to an event title and it will be imported as cancelled.</li></ol>
  <p class="muted">Supported formats include <code>Mon 12 Oct 16:00–17:00 Student A</code>, <code>12/10 4pm Student A 90m</code>, <code>2026-10-12 4:30-5:30pm Student C</code> and date headings followed by <code>16:00 - 17:00 Student A</code>.</p>
  </div><footer class="sheet-foot"><span class="grow"></span><button class="btn primary" data-action="close-sheet">Got it</button></footer>`);
}

// ---------------- Session ----------------
export function sessionForm(id, preset = {}) {
  const ex = id ? state.sessions.find(x => x.id === id) : null;
  const firstStudent = preset.studentId ? studentById(preset.studentId) : null;
  const s = ex || { date: preset.date || todayStr(), start: preset.start || '16:00', duration: firstStudent?.defaultDuration || state.settings.defaultDuration || 60, status: (preset.date || todayStr()) < todayStr() ? 'completed' : 'scheduled', studentId: preset.studentId || '' };
  const students = activeStudents(s.studentId);
  if (!students.length) { toast('Add a student first', { type: 'warn' }); return studentForm(); }
  const sheet = openSheet(`${sheetHeader(id ? 'Edit session' : 'Log session')}
  <form class="sheet-body form" id="session-form">
    <label class="field"><span>Student</span><select name="studentId" required>${!s.studentId ? '<option value="">Choose…</option>' : ''}${students.map(st => opt(st.id, `${st.name}${st.subject ? ' · ' + st.subject : ''}`, s.studentId)).join('')}</select></label>
    <div class="row3"><label class="field"><span>Date</span><input type="date" name="date" required value="${esc(s.date)}"></label>
    <label class="field"><span>Start</span><input type="time" name="start" required value="${esc(s.start)}" step="300"></label>
    <label class="field"><span>Minutes</span><input type="number" name="duration" required min="5" max="600" step="5" inputmode="numeric" value="${esc(s.duration)}" list="dur-list"><datalist id="dur-list"><option value="30"><option value="45"><option value="60"><option value="90"><option value="120"></datalist></label></div>
    <div class="field"><span>Status</span><div class="seg">${Object.entries(SESSION_STATUS).map(([k, v]) => `<label><input type="radio" name="status" value="${k}" ${s.status === k ? 'checked' : ''}><span>${esc(v.label.replace(' (charged)', ''))}</span></label>`).join('')}</div></div>
    <label class="field"><span>Rate override (£/h, optional)</span><input type="number" name="rate" min="0" step="0.01" inputmode="decimal" value="${esc(s.rate ?? '')}" placeholder="Uses student's rate"></label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="What did you cover?">${esc(s.notes)}</textarea></label>
    ${!id ? `<label class="field"><span>Repeat weekly</span><select name="repeat">${[0, 1, 2, 3, 5, 7, 11].map(n => opt(n, n ? `+ ${n} more week${n > 1 ? 's' : ''}` : 'Does not repeat', 0)).join('')}</select></label>` : ''}
    <p class="muted small" data-x="value"></p>
  </form>
  <footer class="sheet-foot">${id ? `<button class="btn danger ghost" data-x="del">${icon('trash')} Delete</button>` : ''}<span class="grow"></span><button class="btn" data-action="close-sheet">Cancel</button><button class="btn primary" type="submit" form="session-form">Save</button></footer>`);
  const form = sheet.querySelector('form');
  const updateValue = () => {
    const d = formData(form); const st = studentById(d.studentId);
    const rate = d.rate !== '' ? +d.rate : (st?.rate ?? state.settings.defaultRate);
    sheet.querySelector('[data-x=value]').textContent = st ? `${fmtDate(d.date)} · ${d.start}–${endTime(d.start, d.duration)} · ${money(rate * (+d.duration || 0) / 60)} at ${money(rate)}/h` : '';
  };
  form.addEventListener('input', updateValue);
  form.studentId.addEventListener('change', () => { const st = studentById(form.studentId.value); if (st && !id) form.duration.value = st.defaultDuration || form.duration.value; updateValue(); });
  updateValue();
  bindForm(sheet, (d) => {
    const base = { ...(ex || {}), studentId: d.studentId, date: d.date, start: d.start, duration: +d.duration, status: d.status || 'scheduled', rate: d.rate === '' ? null : +d.rate, notes: d.notes, source: ex?.source || 'manual' };
    saveSession(base);
    const rep = +d.repeat || 0;
    if (rep) addSessionsBulk(Array.from({ length: rep }, (_, i) => ({ ...base, id: undefined, date: ymd(addDays(parseYmd(d.date), 7 * (i + 1))), status: 'scheduled', notes: '' })));
    closeSheet(); toast(id ? 'Session updated' : `Session logged${rep ? ` (+${rep} repeats)` : ''}`, { type: 'ok' });
  });
  sheet.querySelector('[data-x=del]')?.addEventListener('click', async () => {
    if (await confirmDialog('Delete this session?', { confirmText: 'Delete', danger: true })) { deleteSession(id); closeSheet(); toast('Session deleted'); }
  });
}

// ---------------- Task ----------------
export function taskForm(id, preset = {}) {
  const t = id ? state.tasks.find(x => x.id === id) : { type: preset.type || 'mine', status: preset.status || 'todo', studentId: preset.studentId || '', due: '' };
  const sheet = openSheet(`${sheetHeader(id ? 'Edit task' : (t.type === 'homework' ? 'New homework' : 'New task'))}
  <form class="sheet-body form" id="task-form">
    <div class="field"><span>Type</span><div class="seg"><label><input type="radio" name="type" value="mine" ${t.type === 'mine' ? 'checked' : ''}><span>My task</span></label><label><input type="radio" name="type" value="homework" ${t.type === 'homework' ? 'checked' : ''}><span>Homework</span></label></div></div>
    <label class="field"><span>Title</span><input name="title" required value="${esc(t.title)}" autofocus placeholder="${t.type === 'homework' ? 'e.g. Algebra worksheet p.4' : 'e.g. Plan next week'}"></label>
    <div class="row2"><label class="field"><span>Student</span><select name="studentId"><option value="">${t.type === 'homework' ? 'Choose…' : 'None'}</option>${activeStudents(t.studentId).map(s => opt(s.id, s.name, t.studentId)).join('')}</select></label>
    <label class="field"><span>Due</span><input type="date" name="due" value="${esc(t.due)}"></label></div>
    <div class="field"><span>Status</span><div class="seg">${Object.entries(TASK_STATUS).map(([k, v]) => `<label><input type="radio" name="status" value="${k}" ${t.status === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="3">${esc(t.notes)}</textarea></label>
  </form>
  <footer class="sheet-foot">${id ? `<button class="btn danger ghost" data-x="del">${icon('trash')} Delete</button>` : ''}<span class="grow"></span><button class="btn" data-action="close-sheet">Cancel</button><button class="btn primary" type="submit" form="task-form">Save</button></footer>`);
  const form = sheet.querySelector('form');
  const sync = () => { form.studentId.required = form.type.value === 'homework'; };
  form.addEventListener('change', sync); sync();
  bindForm(sheet, (d) => { saveTask({ ...t, ...d, title: d.title.trim(), studentId: d.studentId || null, status: d.status || 'todo' }); closeSheet(); toast(id ? 'Task updated' : 'Task added', { type: 'ok' }); });
  sheet.querySelector('[data-x=del]')?.addEventListener('click', async () => { if (await confirmDialog('Delete this task?', { confirmText: 'Delete', danger: true })) { deleteTask(id); closeSheet(); toast('Task deleted'); } });
}

// ---------------- Expense ----------------
export function expenseForm(id, preset = {}) {
  const e = id ? state.expenses.find(x => x.id === id) : { date: preset.date || todayStr(), category: EXPENSE_CATEGORIES[0], recurring: false };
  const sheet = openSheet(`${sheetHeader(id ? 'Edit expense' : 'New expense')}
  <form class="sheet-body form" id="expense-form">
    <div class="row2"><label class="field"><span>Amount (£)</span><input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(e.amount)}" autofocus></label>
    <label class="field"><span>Date</span><input type="date" name="date" required value="${esc(e.date)}"></label></div>
    <label class="field"><span>Category</span><select name="category">${EXPENSE_CATEGORIES.map(c => opt(c, c, e.category)).join('')}</select></label>
    <label class="field"><span>Description</span><input name="description" value="${esc(e.description)}" placeholder="e.g. Train to Guidewell office"></label>
    <label class="check"><input type="checkbox" name="recurring" ${e.recurring ? 'checked' : ''}> Repeats every month</label>
  </form>
  <footer class="sheet-foot">${id ? `<button class="btn danger ghost" data-x="del">${icon('trash')} Delete</button>` : ''}<span class="grow"></span><button class="btn" data-action="close-sheet">Cancel</button><button class="btn primary" type="submit" form="expense-form">Save</button></footer>`);
  bindForm(sheet, (d) => { saveExpense({ ...e, ...d, amount: +d.amount, recurring: !!d.recurring }); closeSheet(); toast(id ? 'Expense updated' : 'Expense added', { type: 'ok' }); });
  sheet.querySelector('[data-x=del]')?.addEventListener('click', async () => { if (await confirmDialog('Delete this expense?', { confirmText: 'Delete', danger: true })) { deleteExpense(id); closeSheet(); toast('Expense deleted'); } });
}

// ---------------- Quick Import ----------------
export function quickImport() {
  if (!state.students.length) { toast('Add a student first so events can be matched', { type: 'warn' }); return studentForm(); }
  const sheet = openSheet(`${sheetHeader('Quick Import', `<button class="link-btn" data-action="timetree-tip">${icon('tag')} TimeTree tip</button>`)}
  <div class="sheet-body form">
    <label class="field"><span>Paste events (from TimeTree, a calendar, or typed)</span>
    <textarea id="qi-text" rows="7" placeholder="Mon 12 Oct\n16:00 - 17:00 Student A\n18:00 - 19:30 Student C\n\nTue 13 Oct 4:30pm-5:30pm Student D"></textarea></label>
    <label class="check"><input type="checkbox" id="qi-past" checked> Mark past sessions as completed</label>
    <div id="qi-preview"></div>
  </div>
  <footer class="sheet-foot"><button class="btn" data-x="parse">Preview</button><span class="grow"></span><button class="btn" data-action="close-sheet">Cancel</button><button class="btn primary" data-x="import" disabled>Import</button></footer>`, { wide: true });
  const ta = sheet.querySelector('#qi-text'); const pv = sheet.querySelector('#qi-preview'); const btn = sheet.querySelector('[data-x=import]');
  let items = [];
  const count = () => { const n = items.filter(i => i.include && i.studentId).length; btn.disabled = !n; btn.textContent = n ? `Import ${n} session${n === 1 ? '' : 's'}` : 'Import'; };
  const render = (skipped) => {
    if (!items.length) { pv.innerHTML = `<p class="muted">No events found yet. Each event needs a date (or a date heading above it) and a time.</p>`; count(); return; }
    const studs = activeStudents();
    pv.innerHTML = `<div class="qi-summary">${items.length} event${items.length === 1 ? '' : 's'} found · ${items.filter(i => i.matched).length} matched${items.some(i => i.duplicate) ? ` · ${items.filter(i => i.duplicate).length} already logged` : ''}</div>
    <div class="table-wrap"><table class="qi-table"><thead><tr><th></th><th>Date</th><th>Time</th><th>Mins</th><th>Student</th><th>From text</th></tr></thead><tbody>
    ${items.map((it, i) => `<tr class="${it.matched ? '' : 'warn'} ${it.duplicate ? 'dup' : ''}" data-i="${i}">
      <td><input type="checkbox" data-f="include" ${it.include ? 'checked' : ''} aria-label="Include"></td>
      <td><input type="date" data-f="date" value="${it.date}"></td><td><input type="time" data-f="start" value="${it.start}"></td>
      <td><input type="number" data-f="duration" value="${it.duration}" min="5" step="5" class="num"></td>
      <td><select data-f="studentId"><option value="">— choose —</option>${studs.map(s => opt(s.id, s.name, it.studentId)).join('')}</select></td>
      <td class="muted small">${esc(it.title)}${it.duplicate ? ' <span class="chip">duplicate</span>' : ''}${it.cancelled ? ' <span class="chip">cancelled</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>${skipped?.length ? `<details class="small muted"><summary>${skipped.length} line${skipped.length === 1 ? '' : 's'} ignored</summary><pre>${esc(skipped.join('\n'))}</pre></details>` : ''}`;
    count();
  };
  const parse = () => {
    const r = parseQuickImport(ta.value, { students: activeStudents(), existing: state.sessions, defaultDuration: +state.settings.defaultDuration || 60 });
    items = r.items; render(r.skipped);
  };
  ta.addEventListener('input', debounceLocal(parse, 300));
  sheet.querySelector('[data-x=parse]').onclick = parse;
  pv.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const it = items[+tr.dataset.i]; const f = e.target.dataset.f;
    it[f] = e.target.type === 'checkbox' ? e.target.checked : (f === 'duration' ? +e.target.value : e.target.value);
    if (f === 'studentId') { it.matched = !!it.studentId; if (it.studentId) { it.include = true; tr.querySelector('[data-f=include]').checked = true; } tr.classList.toggle('warn', !it.studentId); }
    count();
  });
  btn.onclick = () => {
    const t = todayStr(); const markPast = sheet.querySelector('#qi-past').checked;
    const recs = items.filter(i => i.include && i.studentId).map(i => ({ studentId: i.studentId, date: i.date, start: i.start, duration: +i.duration || 60, status: i.cancelled ? 'cancelled' : (markPast && i.date < t ? 'completed' : 'scheduled'), notes: '', rate: null, source: 'import' }));
    addSessionsBulk(recs); closeSheet(); toast(`Imported ${recs.length} session${recs.length === 1 ? '' : 's'}`, { type: 'ok' });
  };
}
function debounceLocal(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
