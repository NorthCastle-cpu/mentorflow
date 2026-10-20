// Unit tests: Guidewell invoice (data, PDF, .docx), billing rounding, Direct payment request email.
// Run: node tests/invoice.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsPDF } from 'jspdf';
import { roundToQuarter, billedHours, roundTo5, ordinal, fmtLongDate, gbp2, gbpShort, gbpGrand, fmtQty, joinNatural, isBilled } from '../src/js/billing.js';
import { buildGuidewellInvoice, suggestInvoiceNumber, defaultInvoiceDate, invoiceMissingSettings, invoiceFilename } from '../src/js/invoice.js';
import { renderInvoicePdf, columnWidths, pdfSafe } from '../src/js/invoice-pdf.js';
import { invoiceDocx, crc32 } from '../src/js/docx.js';
import { paymentRequest, fillTemplate, fmtAmount, mailtoUrl, DEFAULT_PAYMENT_TEMPLATE, BANK_PLACEHOLDER } from '../src/js/payreq.js';
import * as F from './fixtures/september-2026.mjs';
import * as db from '../src/js/db.js';
const quiet = console.warn; console.warn = () => {}; await db.getAll('students'); console.warn = quiet; // in-memory IndexedDB fallback
const store = await import('../src/js/store.js');
const { eventSummary } = await import('../src/js/ics.js');

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const tmp = mkdtempSync(join(tmpdir(), 'mf-inv-'));
const sept = () => buildGuidewellInvoice({ month: F.MONTH, students: F.students, sessions: F.sessions, settings: F.settings, record: F.record });
const r2 = (x) => Math.round(x * 100) / 100;

await t('billing rounds each session to the NEAREST 15 minutes (50 → 0.75 h, 55 → 1 h)', () => {
  assert.equal(billedHours({ duration: 50 }), 0.75);
  assert.equal(billedHours({ duration: 55 }), 1);
  for (const [m, q] of [[60, 60], [45, 45], [52, 45], [53, 60], [65, 60], [68, 75], [130, 135], [7, 0], [8, 15], [0, 0]]) assert.equal(roundToQuarter(m), q, `${m} min`);
  assert.equal(roundTo5(57), 55); assert.equal(roundTo5(58), 60); assert.equal(roundTo5(1), 5);
  assert.ok(isBilled({ status: 'no_show' }) && isBilled({ status: 'late_cancel' }) && isBilled({ status: 'completed' }));
  assert.ok(!isBilled({ status: 'cancelled' }) && !isBilled({ status: 'scheduled' }) && !isBilled({ status: 'completed', noBill: true }));
});

await t('formats match Sarah’s invoices', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  assert.equal(fmtLongDate('2026-09-02'), '2nd September 2026');
  assert.equal(gbp2(1125), '£1125.00'); assert.equal(gbpShort(75), '£75'); assert.equal(gbpShort(62.5), '£62.50'); assert.equal(gbpShort(0), '£0');
  assert.equal(gbpGrand(4617.08), '£4,617.08'); assert.equal(gbpGrand(12345678.9), '£12,345,678.90'); assert.equal(gbpGrand(98.33), '£98.33');
  assert.equal(fmtQty(60.25), '60.25'); assert.equal(fmtQty(15), '15'); assert.equal(fmtQty(350 / 60 + 1.75), '7.58');
});

await t('September 2026 recreation: section and grand totals (fictional names, real hours/rates)', () => {
  const inv = sept();
  // Expected values computed independently from the chat's figures:
  const priv = { hours: 68.25, total: r2(68.25 * 75) };                                  // £5,118.75
  const schools = r2(4 * 75 + 2.5 * 65 + 1 * 20);                                         // Northfield course + Sunday Bespoke course + Admin time = £482.50
  const lessonAdmin = r2(70 * 5 / 60 * 20);                                               // 70 lessons × 5 min @ £20 = £116.67
  const admin = r2(lessonAdmin + 1 * 25 + 0.25 * 20 + 0.5 * 20);                          // + Winchester £25 + Daphne £5 + emails £10 = £156.67
  const grand = r2(priv.total + schools + admin);                                          // £5,757.92
  assert.equal(priv.total, 5118.75); assert.equal(schools, 482.5); assert.equal(lessonAdmin, 116.67); assert.equal(admin, 156.67); assert.equal(grand, 5757.92);
  const [P, S, A] = inv.sections;
  assert.deepEqual(inv.sections.map(s => s.title), ['Private Lessons', 'Schools Courses', 'Admin']);
  assert.equal(P.hours, priv.hours); assert.equal(P.total, priv.total); assert.ok(P.rows.every(r => r.rate === 75));
  assert.equal(S.total, schools); assert.equal(A.total, admin); assert.equal(inv.grand, grand);
  assert.deepEqual(inv.totals, [{ type: 'Private Lessons', total: 5118.75 }, { type: 'Schools Courses', total: 482.5 }, { type: 'Admin', total: 156.67 }]);
  assert.equal(inv.autoLessonCount, 70, 'no-show + late cancel count as lessons; cancelled/scheduled/don’t-bill do not');
  const la = A.rows[A.rows.length - 1];
  assert.deepEqual([la.description, la.hoursLabel, la.total, la.dates], ['Lesson admin', '350/60', 116.67, '-'], 'plain "Lesson admin", no formula text, last');
  assert.deepEqual(A.rows.map(r => r.description), ['Intro call with prospective student Daphne', 'Winchester Safeguarding Training', 'lots of student emails', 'Lesson admin']);
  assert.equal(A.rows[0].dates, '3rd');
  assert.deepEqual(S.rows.map(r => [r.dates, r.description, r.rate, r.hours, r.total]), [
    ['6th, 13th, 20th, 27th', 'Northfield SAT Course', 75, 4, 300], ['7th, 14th', 'Sunday Bespoke SAT Course - Group Q', 65, 2.5, 162.5], ['-', 'Admin time', 20, 1, 20]]);
  const ben = P.rows.filter(r => r.description.startsWith('Ben Example'));
  assert.deepEqual(ben.map(r => r.description).sort(), ['Ben Example - SAT', 'Ben Example - Test Consultation'], 'grouped by student + subject');
  assert.equal(P.rows.find(r => r.description === 'Cleo Sample - ACT').hours, 14.25, '130 min billed as 2.25 h');
  assert.ok(!P.rows.some(r => /Allegra|Luba/.test(r.description)), 'only Guidewell students');
  assert.equal(inv.number, 67); assert.equal(inv.dateLabel, '1st October 2026');
  assert.equal(inv.intro, 'Invoice for services provided in the month of September 2026.');
});

await t('Schools Courses only shown when non-empty; lesson count override; travel column', () => {
  const students = F.students.filter(s => !s.schoolCourse);
  const sessions = F.sessions.map(s => s.id === F.sessions[0].id ? { ...s, travel: 12.5 } : s);
  const inv = buildGuidewellInvoice({ month: F.MONTH, students, sessions, settings: F.settings, record: { lines: [{ id: 'x', section: 'admin', description: 'Call', qty: 1, rate: 20 }], lessonCount: 10 } });
  assert.deepEqual(inv.sections.map(s => s.key), ['private', 'admin']);
  const la = inv.sections[1].rows.at(-1); assert.equal(la.hoursLabel, '50/60'); assert.equal(la.total, 16.67);
  assert.equal(inv.sections[0].travel, 12.5); assert.equal(inv.sections[0].total, r2(inv.sections[0].subtotal + 12.5));
});

await t('invoice number: last issued + 1, default #68 for October 2026; date = 1st of next month', () => {
  assert.equal(suggestInvoiceNumber('2026-10', {}), 68);
  assert.equal(suggestInvoiceNumber('2026-04', {}), 62, 'April 2026 was #62 in the chat');
  assert.equal(suggestInvoiceNumber('2026-11', { '2026-10': { number: 70 } }), 71);
  assert.equal(suggestInvoiceNumber('2026-11', { '2026-09': { number: 67 }, '2026-12': { number: 99 } }), 68, 'only earlier months count');
  assert.equal(defaultInvoiceDate('2026-10'), '2026-11-01'); assert.equal(defaultInvoiceDate('2026-12'), '2027-01-01');
  const inv = buildGuidewellInvoice({ month: '2026-10', students: [], sessions: [], settings: {}, record: { number: 80, date: '2026-11-02' } });
  assert.equal(inv.number, 80); assert.equal(inv.dateLabel, '2nd November 2026');
  assert.equal(buildGuidewellInvoice({ month: '2026-10', students: [], sessions: [], settings: {} }).number, 68);
  assert.equal(invoiceFilename(inv), 'Invoice 80 - October 2026');
});

await t('Settings: no bank-detail fields; invoice footer + payment template use a [your bank details here] placeholder', () => {
  const D = store.DEFAULT_SETTINGS;
  for (const k of ['bankAccountName', 'bankSortCode', 'bankAccountNumber']) assert.ok(!(k in D), k + ' removed');
  assert.ok(D.invoiceFooter.includes(BANK_PLACEHOLDER)); assert.ok(D.paymentEmailTemplate.includes(BANK_PLACEHOLDER));
  assert.ok(!/\d{2}-\d{2}-\d{2}|\b\d{8}\b/.test(D.invoiceFooter + D.paymentEmailTemplate), 'no bank numbers in defaults');
  assert.deepEqual(invoiceMissingSettings(F.settings), []);
  const miss = invoiceMissingSettings({ ...D }); assert.ok(miss.length === 4 && /bank details/.test(miss[3]));
  for (const k of ['bankAccountName', 'bankSortCode', 'bankAccountNumber']) assert.ok(!(k in store.SAMPLE_SETTINGS));
});

await t('PDF: real layout, wording and totals (first page has header + Private Lessons)', () => {
  const inv = sept(); const doc = renderInvoicePdf(jsPDF, inv);
  const file = join(tmp, 'inv.pdf'); writeFileSync(file, Buffer.from(doc.output('arraybuffer')));
  const txt = execFileSync('pdftotext', ['-layout', file, '-']).toString();
  const p1 = execFileSync('pdftotext', ['-f', '1', '-l', '1', '-layout', file, '-']).toString();
  for (const s of ['Invoice to:', 'Example Agency Ltd', 'Company no.: 00000000', 'Invoice from: Sample Tutor', '1 Example Street, Exampletown EX1 1AA', 'Invoice #: 67', 'Invoice date: 1st October 2026', 'Invoice for services provided in the month of September 2026.', 'Private Lessons:', 'Date(s)', 'Sub-total'])
    assert.ok(p1.includes(s), 'page 1 has ' + s);
  for (const s of ['Schools Courses:', 'Admin:', 'Lesson admin', '350/60', '£116.67', 'TOTALS:', '£5118.75', '£482.50', '£156.67', '£5,757.92', 'Please pay within 15 days from the date of this invoice.', 'Account name: SAMPLE TUTOR', 'Reference: Tutor Invoice'])
    assert.ok(txt.includes(s), 'pdf has ' + s);
  assert.ok(!/70 lessons|× 5|x 5 min/.test(txt), 'no formula text');
  assert.ok((txt.match(/^\s*Invoice\s*$/gm) || []).length >= 2, '"Invoice" heading on every page');
  const fonts = execFileSync('pdffonts', [file]).toString(); assert.ok(/Helvetica/.test(fonts));
  // Columns are tight: numeric columns are narrow, Description gets the space.
  const w = columnWidths(doc, inv, 495.28); assert.ok(w[1] > 150 && w[2] < 45 && w[5] < 50, JSON.stringify(w.map(Math.round)));
  assert.equal(pdfSafe('Renée’s – Łukasz'), 'Renée’s – Lukasz');
});

await t('.docx editable copy: valid zip, opens as WordprocessingML with the same totals', () => {
  const inv = sept(); const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const bytes = invoiceDocx(inv, columnWidths(doc, inv, 495.28)); const file = join(tmp, 'inv.docx'); writeFileSync(file, bytes);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const out = execFileSync('python3', ['-c', `import zipfile,sys,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
x=z.read('word/document.xml').decode(); m.parseString(x)
import re; print(' '.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', x)))`, file]).toString();
  for (const s of ['Invoice', 'Invoice #:', '67', 'Private Lessons:', 'Schools Courses:', 'Lesson admin', '350/60', '£5,757.92', 'Account name:', 'SAMPLE TUTOR']) assert.ok(out.includes(s), 'docx has ' + s);
});

// ---------- Direct payment request ----------
const allegra = { id: 'd1', name: 'Allegra Testcase', subject: 'Essay Coaching', invoiceMethod: 'direct', rate: 150, parentName: 'Carol Testcase', parentEmail: 'carol@example.com' };
const july = (day, duration, extra = {}) => ({ id: 'j' + day + duration, studentId: 'd1', date: `2026-07-${String(day).padStart(2, '0')}`, start: '10:00', duration, status: 'completed', ...extra });
// 6 × 60 + 50 + 50 (→ 45 each) + 55 (→ 60) + 30 = 9 h; a cancelled and a don't-bill session are ignored.
const julySessions = [1, 2, 3, 4, 5, 6].map(d => july(d, 60)).concat([july(7, 50), july(8, 50), july(9, 55), july(10, 30), july(11, 60, { status: 'cancelled' }), july(12, 60, { noBill: true })]);
const bankTemplate = DEFAULT_PAYMENT_TEMPLATE.replace(BANK_PLACEHOLDER, 'SAMPLE TUTOR\n00-00-00\n00000000');

await t('payment email follows the exact template (example: Carol / £1350 / Allegra’s 9 hours of Essay Coaching in July)', () => {
  const r = paymentRequest({ month: '2026-07', student: allegra, sessions: julySessions, settings: { paymentEmailTemplate: bankTemplate } });
  assert.equal(r.hours, 9); assert.equal(r.amount, 1350); assert.equal(r.to, 'carol@example.com'); assert.deepEqual(r.missing, []);
  assert.equal(r.body, `Hi Carol,

I’m just reaching out to request payment of £1350 for Allegra’s 9 hours of Essay Coaching in July, at your earliest convenience. 

My bank details are:
SAMPLE TUTOR
00-00-00
00000000

Please let me know if you have any questions, thanks. 

Kindest regards,
Sarah`);
  const url = mailtoUrl(r); assert.ok(url.startsWith('mailto:carol@example.com?subject='));
  assert.equal(decodeURIComponent(url.split('&body=')[1]), r.body);
});

await t('payment email: default template keeps the bank placeholder; 1 hour; decimals; several subjects; missing parent', () => {
  const r0 = paymentRequest({ month: '2026-07', student: allegra, sessions: julySessions, settings: {} });
  assert.ok(r0.body.includes('My bank details are:\n[your bank details here]\n')); assert.ok(r0.hasBankPlaceholder);
  const one = paymentRequest({ month: '2026-07', student: allegra, sessions: [july(1, 55)], settings: {} });
  assert.match(one.body, /£150 for Allegra’s 1 hour of Essay Coaching in July,/);
  const mixed = paymentRequest({ month: '2026-07', student: { ...allegra, rate: 50 }, sessions: [july(1, 60), july(2, 50, { subject: 'SAT' }), july(3, 20, { rate: 45 })], settings: {} });
  // 1 h + 0.75 h at £50 + 0.25 h at £45 = £98.75 for 2 hours
  assert.match(mixed.body, /payment of £98\.75 for Allegra’s 2 hours of Essay Coaching and SAT in July,/);
  assert.equal(fmtAmount(1350), '1350'); assert.equal(fmtAmount(1234.5), '1234.50'); assert.equal(fmtAmount(12345), '12345');
  assert.equal(joinNatural(['A', 'B', 'C']), 'A, B and C');
  const noParent = paymentRequest({ month: '2026-07', student: { ...allegra, parentName: '', parentEmail: '' }, sessions: julySessions, settings: {} });
  assert.deepEqual(noParent.missing, ['parent first name', 'parent email']);
  const filled = paymentRequest({ month: '2026-07', student: { ...allegra, parentName: '' }, sessions: julySessions, settings: {}, parentFirstName: 'Dana' });
  assert.match(filled.body, /^Hi Dana,/);
  assert.equal(fillTemplate('{Unknown} {Month} {hours} hours', { Month: 'July', hours: '1' }), '{Unknown} July 1 hour');
  assert.equal(paymentRequest({ month: '2026-08', student: allegra, sessions: julySessions, settings: {} }).count, 0);
});

// ---------- store integration (in-memory IndexedDB) ----------
await t('store: Money uses the same rounding, Guidewell default £75, don’t-bill excluded, invoice record syncs', async () => {
  const g = store.saveStudent({ name: 'Agency Pupil', invoiceMethod: 'guidewell', rate: null, active: true });
  const d = store.saveStudent({ name: 'Direct Pupil', invoiceMethod: 'direct', rate: 40, active: true });
  const s1 = store.saveSession({ studentId: d.id, date: '2026-10-05', start: '10:00', duration: 50, status: 'completed' });
  store.saveSession({ studentId: d.id, date: '2026-10-06', start: '10:00', duration: 60, status: 'completed', noBill: true });
  store.saveSession({ studentId: g.id, date: '2026-10-07', start: '10:00', duration: 60, status: 'no_show' });
  assert.equal(store.sessionValue(s1), 30, '50 min billed as 45 min at £40');
  const st = store.monthStats('2026-10'); assert.equal(st.actual, 30 + 75); assert.equal(st.actualMins, 45 + 60);
  store.saveInvoiceRecord('2026-10', { number: 68, lines: [{ id: 'a', section: 'admin', description: 'Call', qty: 0.5, rate: 20 }] });
  const rec = await db.get('meta', 'gwinv-2026-10'); assert.equal(rec.number, 68); assert.equal(rec.lines.length, 1);
  assert.ok((await db.getOutbox()).some(e => e.key === 'meta/gwinv-2026-10'), 'queued for private sync');
  assert.equal(store.exportBackup().invoices['2026-10'].number, 68);
  assert.equal(eventSummary({ studentId: g.id, subject: 'Mock exam review' }, store.studentById), 'Agency Pupil – Mock exam review');
  assert.equal(eventSummary({ studentId: d.id }, (id) => ({ ...store.studentById(id), subject: 'Maths', label: 'OLD LABEL' })), 'Direct Pupil – Maths');
});

console.log(`\n${n} invoice/payment test groups passed`);
