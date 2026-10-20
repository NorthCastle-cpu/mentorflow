// Guidewell monthly invoice: pure data builder (no DOM). Layout follows Sarah's own invoices:
// "Private Lessons", optional "Schools Courses", "Admin" tables with columns
// Date(s) | Description | Rate | Hours | Sub-total | Travel | Total, then a TOTALS table and a payment footer.
import { isBilled, billedHours, round2, ordinal, fmtLongDate, monthLong, monthsBetween, nextMonth } from './billing.js';

export const INVOICE_SEED = { month: '2026-09', number: 67 }; // September 2026 was invoice #67
export const DEFAULT_GUIDEWELL_RATE = 75;
export const DEFAULT_ADMIN_RATE = 20;
export const DEFAULT_LESSON_ADMIN_MINS = 5;
export const SECTION_TITLES = { private: 'Private Lessons', schools: 'Schools Courses', admin: 'Admin' };
export const invoiceRecordId = (month) => 'gwinv-' + month;

/** Suggested invoice number: last issued number before this month + 1; with no history, count on from #67 (Sep 2026). */
export function suggestInvoiceNumber(month, history = {}) {
  const prior = Object.entries(history).filter(([m, r]) => m < month && r && +r.number > 0).sort((a, b) => a[0].localeCompare(b[0]));
  if (prior.length) return +prior[prior.length - 1][1].number + 1;
  return Math.max(1, INVOICE_SEED.number + monthsBetween(INVOICE_SEED.month, month));
}
export const defaultInvoiceDate = (month) => nextMonth(month) + '-01';

const num = (v, d) => (v === '' || v == null || isNaN(+v)) ? d : +v;
const rowTotals = (r) => { r.subtotal = round2(r.rate * r.hours); r.travel = round2(r.travel || 0); r.total = round2(r.subtotal + r.travel); return r; };

/**
 * @param {{month:string, students:Array, sessions:Array, settings:object, record?:object, history?:object}} p
 *   record  = the stored per-month invoice record { number, date, lessonCount, lines:[{section,date,description,qty,rate}] }
 *   history = { 'YYYY-MM': record } for invoice-number suggestions
 */
export function buildGuidewellInvoice({ month, students = [], sessions = [], settings = {}, record = {}, history = {} }) {
  const S = settings; const byId = new Map(students.map(s => [s.id, s]));
  const defRate = num(S.guidewellRate, DEFAULT_GUIDEWELL_RATE);
  const adminRate = num(S.adminRate, DEFAULT_ADMIN_RATE);
  const groups = new Map(); let lessons = 0;
  for (const s of sessions) {
    if (!s.date?.startsWith(month)) continue;
    const st = byId.get(s.studentId);
    if (!st || st.invoiceMethod !== 'guidewell' || !isBilled(s)) continue;
    const subject = (s.subject || st.subject || '').trim();
    const rate = num(s.rate, num(st.rate, defRate));
    const section = st.schoolCourse ? 'schools' : 'private';
    const key = [section, st.id, subject.toLowerCase(), rate].join('|');
    if (!groups.has(key)) groups.set(key, { section, studentId: st.id, name: st.name, subject, rate, days: new Set(), first: s.date, hours: 0, travel: 0, sessions: 0 });
    const g = groups.get(key);
    g.days.add(+s.date.slice(8, 10)); if (s.date < g.first) g.first = s.date;
    g.hours += billedHours(s); g.travel += num(s.travel, 0); g.sessions++; lessons++;
  }
  const sessionRow = (g) => rowTotals({ kind: 'sessions', dates: [...g.days].sort((a, b) => a - b).map(ordinal).join(', '), description: g.subject ? `${g.name} - ${g.subject}` : g.name, rate: g.rate, hours: round2(g.hours), travel: g.travel, first: g.first, sessions: g.sessions });
  const lineRow = (l) => rowTotals({ kind: 'line', id: l.id, dates: l.date ? ordinal(+l.date.slice(8, 10)) : '-', date: l.date || '', description: l.description || '', rate: num(l.rate, adminRate), hours: num(l.qty, 0), travel: 0 });
  const bySessions = (a, b) => a.first.localeCompare(b.first) || a.description.localeCompare(b.description);
  const lines = (record.lines || []).filter(l => l && (l.description || +l.qty));
  const rows = { private: [], schools: [], admin: [] };
  for (const g of groups.values()) rows[g.section].push(sessionRow(g));
  rows.private.sort(bySessions); rows.schools.sort(bySessions);
  rows.schools.push(...lines.filter(l => l.section === 'schools').map(lineRow));
  const admin = lines.filter(l => l.section !== 'schools').map(lineRow);
  rows.admin.push(...admin.filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date)), ...admin.filter(r => !r.date));
  const lessonCount = num(record.lessonCount, lessons);
  const adminMins = num(S.lessonAdminMins, DEFAULT_LESSON_ADMIN_MINS);
  if (lessonCount > 0 && adminMins > 0) rows.admin.push(rowTotals({ kind: 'lesson-admin', dates: '-', description: 'Lesson admin', rate: adminRate, hours: lessonCount * adminMins / 60, hoursLabel: `${lessonCount * adminMins}/60`, travel: 0, lessons: lessonCount }));
  const sections = ['private', 'schools', 'admin'].filter(k => k === 'private' || rows[k].length).map(k => {
    const r = rows[k]; const sum = (f) => round2(r.reduce((a, x) => a + x[f], 0));
    return { key: k, title: SECTION_TITLES[k], rows: r, hours: sum('hours'), subtotal: sum('subtotal'), travel: sum('travel'), total: sum('total') };
  });
  const grand = round2(sections.reduce((a, s) => a + s.total, 0));
  const number = num(record.number, suggestInvoiceNumber(month, history));
  const date = record.date || defaultInvoiceDate(month);
  return {
    month, monthLabel: monthLong(month), number, date, dateLabel: fmtLongDate(date),
    autoLessonCount: lessons, lessonCount, sections, grand,
    totals: sections.map(s => ({ type: s.title, total: s.total })),
    to: String(S.guidewellBillTo || '').split('\n').map(x => x.trim()).filter(Boolean),
    from: { name: S.yourName || '', business: S.businessName || '', address: String(S.address || '').split('\n').map(x => x.trim()).filter(Boolean).join(', '), phone: S.phone || '', email: S.email || '' },
    intro: `Invoice for services provided in the month of ${monthLong(month)}.`,
    footer: String(S.invoiceFooter ?? '').replace(/\r/g, '').split('\n'),
  };
}

/** Which Settings the invoice still needs (shown as a warning in the app). */
export function invoiceMissingSettings(S = {}) {
  const miss = [];
  if (!S.yourName) miss.push('Your name');
  if (!S.address) miss.push('Address');
  if (!String(S.guidewellBillTo || '').trim()) miss.push('Guidewell billing details (Invoice to)');
  if (!String(S.invoiceFooter || '').trim() || /\[your bank details here\]/i.test(S.invoiceFooter)) miss.push('Invoice footer / payment details (replace “[your bank details here]”)');
  return miss;
}
export const invoiceFilename = (inv) => `Invoice ${inv.number} - ${inv.monthLabel}`.replace(/[\\/:*?"<>|]/g, '');
