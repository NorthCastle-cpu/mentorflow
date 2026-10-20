// In-memory state mirrored to IndexedDB. Views read from `state` and call the mutators below.
import * as db from './db.js';
import { uid, todayStr, ym, ymd, addDays, parseYmd, round2, timeToMins, addMonths } from './util.js';

export const SCHEMA_VERSION = 2;

import { INVOICE_METHODS, sortSessions } from './constants.js';
export { INVOICE_METHODS, sortSessions };

export const SESSION_STATUS = {
  scheduled:   { label: 'Scheduled', billable: false, forecast: true },
  completed:   { label: 'Completed', billable: true, forecast: true },
  late_cancel: { label: 'Late cancel (charged)', billable: true, forecast: true },
  cancelled:   { label: 'Cancelled', billable: false, forecast: false },
};

export const TASK_STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' };
export const EXPENSE_CATEGORIES = ['Travel', 'Resources & books', 'Software & subscriptions', 'Training', 'Phone & internet', 'Insurance', 'Equipment', 'Other'];
export const LABEL_COLORS = [
  { key: 'emerald', hex: '#10b981' }, { key: 'sky', hex: '#0ea5e9' }, { key: 'violet', hex: '#8b5cf6' },
  { key: 'rose', hex: '#f43f5e' }, { key: 'amber', hex: '#f59e0b' }, { key: 'lime', hex: '#84cc16' },
  { key: 'indigo', hex: '#6366f1' }, { key: 'pink', hex: '#ec4899' }, { key: 'slate', hex: '#64748b' }, { key: 'teal', hex: '#14b8a6' },
];

export const DEFAULT_SETTINGS = {
  id: 'settings',
  yourName: '', businessName: '', address: '', email: '', phone: '',
  bankAccountName: '', bankSortCode: '', bankAccountNumber: '',
  defaultRate: 40, defaultDuration: 60, monthlyTarget: 2000,
  guidewellEmail: '', guidewellRef: '', lubaEmail: '',
  invoicePrefix: 'MF-', nextInvoiceNumber: 1, paymentTermsDays: 14,
  theme: 'system', weekStartsMonday: true,
  syncProvider: 'local', notionToken: '', notionDatabaseId: '',
  calendarAlarm: false, calendarRange: 'today', lastCalendarExportAt: '',
  onboarded: false,
};

export const state = {
  students: [], sessions: [], tasks: [], expenses: [],
  settings: { ...DEFAULT_SETTINGS },
  checklists: {}, // 'YYYY-MM' -> { key: bool }
  ready: false,
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export async function load() {
  const [students, sessions, tasks, expenses, meta] = await Promise.all(db.STORES.map(s => db.getAll(s)));
  state.students = students; state.sessions = sessions; state.tasks = tasks; state.expenses = expenses;
  migrateSessions(sessions);
  const settings = meta.find(m => m.id === 'settings');
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.checklists = {};
  meta.filter(m => m.id.startsWith('checklist-')).forEach(m => state.checklists[m.id.slice(10)] = m.items || {});
  state.ready = true;
  emit();
}

// Migration (schema v2): every session needs createdAt/updatedAt/sequence for calendar export.
export function migrateSessions(sessions) {
  const now = new Date().toISOString(); const migrated = [];
  for (const s of sessions) {
    if (!s.createdAt || !s.updatedAt || s.sequence == null) {
      s.createdAt ||= now; s.updatedAt ||= s.createdAt; if (s.sequence == null) s.sequence = 0; migrated.push(s);
    }
  }
  if (migrated.length) db.putMany('sessions', migrated).catch(console.error);
  return migrated.length;
}

// ---------- generic CRUD ----------
function upsert(coll, obj) {
  const list = state[coll];
  const now = new Date().toISOString();
  const rec = { ...obj, id: obj.id || uid(), updatedAt: now, createdAt: obj.createdAt || now };
  const i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  db.put(coll, rec).catch(console.error);
  emit();
  return rec;
}
function remove(coll, id) {
  state[coll] = state[coll].filter(x => x.id !== id);
  db.del(coll, id).catch(console.error);
  emit();
}

export const saveStudent = (s) => upsert('students', s);
export function saveSession(s) {
  // Every edit bumps SEQUENCE so calendars treat a re-export as an update of the same event (same UID).
  const prev = s.id ? state.sessions.find(x => x.id === s.id) : null;
  const sequence = prev ? (+prev.sequence || 0) + 1 : (+s.sequence || 0);
  return upsert('sessions', { ...s, sequence });
}

/** Record that sessions were sent to the calendar without touching updatedAt/sequence. */
export function markCalendarExported(ids, at = new Date().toISOString()) {
  const set = new Set(ids); const changed = [];
  for (const s of state.sessions) if (set.has(s.id)) { s.calendarExportedAt = at; s.calendarExportedSeq = +s.sequence || 0; changed.push(s); }
  db.putMany('sessions', changed).catch(console.error);
  saveSettings({ lastCalendarExportAt: at });
}
export const isCalendarExported = (s) => !!s.calendarExportedAt && (+s.calendarExportedSeq || 0) === (+s.sequence || 0) && s.calendarExportedAt >= (s.updatedAt || '');
export const saveTask = (t) => upsert('tasks', t);
export const saveExpense = (e) => upsert('expenses', e);
export const deleteSession = (id) => remove('sessions', id);
export const deleteTask = (id) => remove('tasks', id);
export const deleteExpense = (id) => remove('expenses', id);
export function deleteStudent(id) {
  const sess = state.sessions.filter(s => s.studentId === id);
  sess.forEach(s => db.del('sessions', s.id));
  state.sessions = state.sessions.filter(s => s.studentId !== id);
  const now = new Date().toISOString();
  state.tasks.filter(t => t.studentId === id).forEach(t => { t.studentId = null; t.updatedAt = now; db.put('tasks', t); });
  remove('students', id);
}

export function addSessionsBulk(list) {
  const now = new Date().toISOString();
  const recs = list.map(s => ({ ...s, id: s.id || uid(), createdAt: now, updatedAt: now, sequence: 0 }));
  state.sessions.push(...recs);
  db.putMany('sessions', recs).catch(console.error);
  emit();
  return recs;
}

// Settings sync field-by-field (newest edit of each field wins), so every change records a per-field time.
// Fields never edited on this device carry no time and are never pushed (a new device can't overwrite with defaults).
export const SETTINGS_INTERNAL = new Set(['id', 'updatedAt', '_fieldTimes']);
export function stampSettings(settings, keys, at = new Date().toISOString()) {
  const times = { ...(settings._fieldTimes || {}) };
  for (const k of keys) if (!SETTINGS_INTERNAL.has(k)) times[k] = at;
  return { ...settings, _fieldTimes: times, updatedAt: at };
}
export function saveSettings(patch) {
  const changed = Object.keys(patch).filter(k => state.settings[k] !== patch[k]);
  state.settings = stampSettings({ ...state.settings, ...patch, id: 'settings' }, changed);
  db.put('meta', state.settings).catch(console.error);
  emit();
}

export function setChecklist(month, key, value) {
  const items = { ...(state.checklists[month] || {}), [key]: value };
  state.checklists[month] = items;
  db.put('meta', { id: 'checklist-' + month, items, updatedAt: new Date().toISOString() }).catch(console.error);
  emit();
}

// ---------- derived ----------
export const studentById = (id) => state.students.find(s => s.id === id);
export const studentName = (id) => studentById(id)?.name || 'Unknown student';
export const sessionRate = (s) => {
  const st = studentById(s.studentId);
  return +(s.rate ?? st?.rate ?? state.settings.defaultRate) || 0;
};
export const sessionValue = (s) => round2(sessionRate(s) * (+s.duration || 0) / 60);
export const sessionMethod = (s) => studentById(s.studentId)?.invoiceMethod || 'direct';
export const sessionsInMonth = (month) => state.sessions.filter(s => s.date.startsWith(month)).sort(sortSessions);
export const sessionsOn = (date) => state.sessions.filter(s => s.date === date).sort(sortSessions);

export function expensesInMonth(month) {
  return state.expenses.filter(e => {
    if (e.date.startsWith(month)) return true;
    if (e.recurring && e.date.slice(0, 7) < month) {
      if (e.recurringUntil && e.recurringUntil < month) return false;
      return true;
    }
    return false;
  }).map(e => e.date.startsWith(month) ? e : { ...e, _recurringInstance: true });
}

export function monthStats(month) {
  const sessions = sessionsInMonth(month);
  const byMethod = Object.fromEntries(Object.keys(INVOICE_METHODS).map(k => [k, { actual: 0, forecast: 0, mins: 0, count: 0 }]));
  let actual = 0, forecast = 0, actualMins = 0, scheduledCount = 0, completedCount = 0, cancelledCount = 0;
  for (const s of sessions) {
    const st = SESSION_STATUS[s.status] || SESSION_STATUS.scheduled;
    const v = sessionValue(s); const m = sessionMethod(s);
    if (st.billable) { actual += v; actualMins += +s.duration || 0; byMethod[m].actual += v; byMethod[m].mins += +s.duration || 0; byMethod[m].count++; }
    if (st.forecast) { forecast += v; byMethod[m].forecast += v; }
    if (s.status === 'scheduled') scheduledCount++;
    if (s.status === 'completed') completedCount++;
    if (s.status === 'cancelled') cancelledCount++;
  }
  const exp = expensesInMonth(month).reduce((a, e) => a + (+e.amount || 0), 0);
  return {
    month, sessions, actual: round2(actual), forecast: round2(forecast), actualMins, expenses: round2(exp),
    net: round2(actual - exp), netForecast: round2(forecast - exp), byMethod,
    scheduledCount, completedCount, cancelledCount, target: +state.settings.monthlyTarget || 0,
  };
}

export function billableByStudent(month, method) {
  const map = new Map();
  for (const s of sessionsInMonth(month)) {
    if (!SESSION_STATUS[s.status]?.billable) continue;
    if (method && sessionMethod(s) !== method) continue;
    if (!map.has(s.studentId)) map.set(s.studentId, { student: studentById(s.studentId), sessions: [], mins: 0, total: 0 });
    const e = map.get(s.studentId); e.sessions.push(s); e.mins += +s.duration || 0; e.total = round2(e.total + sessionValue(s));
  }
  return [...map.values()].sort((a, b) => (a.student?.name || '').localeCompare(b.student?.name || ''));
}

export function nextInvoiceNumber(consume = false) {
  const n = +state.settings.nextInvoiceNumber || 1;
  const num = `${state.settings.invoicePrefix || ''}${String(n).padStart(4, '0')}`;
  if (consume) saveSettings({ nextInvoiceNumber: n + 1 });
  return num;
}

// ---------- backup ----------
export function exportBackup() {
  return {
    app: 'MentorFlow', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    students: state.students, sessions: state.sessions, tasks: state.tasks, expenses: state.expenses,
    settings: state.settings, checklists: state.checklists,
  };
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a JSON object');
  if (data.app !== 'MentorFlow') throw new Error('This file is not a MentorFlow backup');
  for (const k of ['students', 'sessions', 'tasks', 'expenses']) if (!Array.isArray(data[k])) throw new Error(`Backup is missing "${k}"`);
  return true;
}

export async function importBackup(data, mode = 'replace') {
  validateBackup(data);
  if (mode === 'replace') await db.clearAll();
  const merge = (coll) => {
    const incoming = data[coll].filter(x => x && x.id);
    if (mode === 'replace') return incoming;
    const map = new Map(state[coll].map(x => [x.id, x]));
    incoming.forEach(x => { const cur = map.get(x.id); if (!cur || (x.updatedAt || '') >= (cur.updatedAt || '')) map.set(x.id, x); });
    return [...map.values()];
  };
  for (const coll of ['students', 'sessions', 'tasks', 'expenses']) {
    state[coll] = merge(coll);
    if (coll === 'sessions') migrateSessions(state.sessions);
    await db.putMany(coll, state[coll]);
  }
  if (mode === 'replace' || !state.settings.onboarded) {
    // A restore is a deliberate choice: stamp every restored setting as "edited now" so it syncs.
    const restored = { ...DEFAULT_SETTINGS, ...(data.settings || {}), id: 'settings' };
    state.settings = stampSettings(restored, Object.keys(data.settings || {}));
  }
  await db.put('meta', state.settings);
  for (const [m, items] of Object.entries(data.checklists || {})) {
    state.checklists[m] = { ...(mode === 'replace' ? {} : state.checklists[m] || {}), ...items };
    await db.put('meta', { id: 'checklist-' + m, items: state.checklists[m], updatedAt: new Date().toISOString() });
  }
  emit();
}

export async function eraseAll() {
  await db.clearAll();
  state.students = []; state.sessions = []; state.tasks = []; state.expenses = [];
  state.settings = { ...DEFAULT_SETTINGS }; state.checklists = {};
  emit();
}

// ---------- sample data ----------
export async function loadSampleData() {
  const today = new Date();
  const students = [
    { name: 'Sample Student A', subject: 'GCSE Maths', invoiceMethod: 'guidewell', rate: 38, parentName: 'Sample Parent A', parentEmail: 'parent.a@example.com', label: 'Student A', labelColor: 'emerald', defaultDay: 1, defaultTime: '16:00' },
    { name: 'Sample Student B', subject: 'KS3 English', invoiceMethod: 'guidewell', rate: 38, parentName: 'Sample Parent B', parentEmail: 'parent.b@example.com', label: 'Student B', labelColor: 'sky', defaultDay: 3, defaultTime: '17:00' },
    { name: 'Sample Student C', subject: 'A-level Biology', invoiceMethod: 'luba', rate: 45, parentName: 'Sample Parent C', parentEmail: 'parent.c@example.com', label: 'Student C', labelColor: 'violet', defaultDay: 2, defaultTime: '18:00' },
    { name: 'Sample Student D', subject: 'Study skills mentoring', invoiceMethod: 'luba', rate: 42, parentName: 'Sample Parent D', parentEmail: 'parent.d@example.com', label: 'Student D', labelColor: 'rose', defaultDay: 4, defaultTime: '15:30' },
    { name: 'Sample Student E', subject: '11+ prep', invoiceMethod: 'direct', rate: 50, parentName: 'Sample Parent E', parentEmail: 'parent.e@example.com', label: 'Student E', labelColor: 'amber', defaultDay: 6, defaultTime: '10:00' },
  ].map(s => ({ ...s, id: uid(), sample: true, active: true, notes: 'Fictional sample student.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const sessions = [];
  const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const t = todayStr();
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    for (const st of students) {
      if (d.getDay() !== st.defaultDay) continue;
      const date = ymd(d);
      const past = date < t;
      let status = past ? 'completed' : 'scheduled';
      if (past && (d.getDate() * st.name.length) % 17 === 0) status = 'cancelled';
      else if (past && (d.getDate() * st.name.length) % 23 === 0) status = 'late_cancel';
      sessions.push({ id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sequence: 0, studentId: st.id, date, start: st.defaultTime, duration: st.subject.startsWith('A-level') ? 90 : 60, status, notes: past && status === 'completed' ? 'Good progress.' : '', source: 'sample' });
    }
  }
  const mk = (title, type, studentId, dueOffset, status = 'todo', notes = '') => ({ id: uid(), sample: true, title, type, studentId, due: dueOffset == null ? '' : ymd(addDays(today, dueOffset)), status, notes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const tasks = [
    mk('Send Guidewell invoice', 'mine', null, 3), mk('Prepare 11+ mock paper', 'mine', students[4].id, 1, 'doing'),
    mk('Update DBS certificate', 'mine', null, 20), mk('Order revision guides', 'mine', null, -1),
    mk('Renew professional insurance', 'mine', null, null, 'done'),
    mk('Quadratics worksheet p.12', 'homework', students[0].id, 2), mk('Read chapters 3–4 of set text', 'homework', students[1].id, 4, 'doing'),
    mk('Cell biology flashcards', 'homework', students[2].id, 0), mk('Weekly planner reflection', 'homework', students[3].id, 5),
    mk('Verbal reasoning test B', 'homework', students[4].id, -2, 'done'),
  ];
  const m0 = ym(today), m1 = addMonths(m0, -1), m2 = addMonths(m0, -2);
  const ex = (date, category, description, amount, recurring = false) => ({ id: uid(), sample: true, date, category, description, amount, recurring, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const expenses = [
    ex(`${m2}-01`, 'Software & subscriptions', 'Online whiteboard subscription', 9.99, true),
    ex(`${m2}-05`, 'Insurance', 'Professional indemnity (monthly)', 12.5, true),
    ex(`${m2}-14`, 'Resources & books', 'CGP revision guides', 32.4),
    ex(`${m1}-09`, 'Travel', 'Train to agency training day', 18.6),
    ex(`${m1}-21`, 'Training', 'Safeguarding refresher course', 45),
    ex(`${m0}-03`, 'Resources & books', '11+ practice papers', 21.99),
  ];
  state.students.push(...students); state.sessions.push(...sessions); state.tasks.push(...tasks); state.expenses.push(...expenses);
  await Promise.all([db.putMany('students', students), db.putMany('sessions', sessions), db.putMany('tasks', tasks), db.putMany('expenses', expenses)]);
  if (!state.settings.yourName) saveSettings({ ...SAMPLE_SETTINGS, sampleSettingsApplied: true });
  emit();
}

// Clearly fictional placeholder profile used only with sample data.
export const SAMPLE_SETTINGS = {
  yourName: 'Sample Tutor', businessName: 'Sample Tutoring (demo)', email: 'tutor@example.com', phone: '',
  address: '1 Example Street\nExampletown EX1 1AA', bankAccountName: 'SAMPLE TUTOR', bankSortCode: '00-00-00', bankAccountNumber: '00000000',
  guidewellEmail: 'invoices@example.com', lubaEmail: 'hours@example.com', guidewellRef: 'DEMO-000', onboarded: true,
};

export const hasSampleData = () => state.students.some(s => s.sample) || state.sessions.some(s => s.source === 'sample') || state.tasks.some(t => t.sample) || state.expenses.some(e => e.sample);

export async function clearSampleData() {
  const sampleStudentIds = new Set(state.students.filter(s => s.sample).map(s => s.id));
  const drop = {
    students: state.students.filter(s => s.sample),
    sessions: state.sessions.filter(s => s.source === 'sample' || sampleStudentIds.has(s.studentId)),
    tasks: state.tasks.filter(t => t.sample),
    expenses: state.expenses.filter(e => e.sample),
  };
  for (const [coll, list] of Object.entries(drop)) {
    const ids = new Set(list.map(x => x.id));
    state[coll] = state[coll].filter(x => !ids.has(x.id));
    await Promise.all(list.map(x => db.del(coll, x.id)));
  }
  const now = new Date().toISOString();
  state.tasks.filter(t => sampleStudentIds.has(t.studentId)).forEach(t => { t.studentId = null; t.updatedAt = now; db.put('tasks', t); });
  if (state.settings.sampleSettingsApplied) {
    const patch = { sampleSettingsApplied: false };
    for (const [k, v] of Object.entries(SAMPLE_SETTINGS)) if (k !== 'onboarded' && state.settings[k] === v) patch[k] = DEFAULT_SETTINGS[k];
    saveSettings(patch);
  }
  emit();
  return Object.values(drop).reduce((a, l) => a + l.length, 0);
}
