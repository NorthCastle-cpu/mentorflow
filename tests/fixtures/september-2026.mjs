// Fictional recreation of the September 2026 Guidewell invoice (same hours and rates as Sarah's real one,
// invented names). Used by tests/invoice.test.mjs and the invoice e2e screenshot.
export const MONTH = '2026-09';
let n = 0; const sid = () => 'sess-' + (++n);
export const students = [
  { id: 'g1', name: 'Ada Fictional', subject: 'Essay Coaching', invoiceMethod: 'guidewell', rate: null, active: true },
  { id: 'g2', name: 'Ben Example', subject: 'SAT', invoiceMethod: 'guidewell', rate: null, active: true },
  { id: 'g3', name: 'Cleo Sample', subject: 'ACT', invoiceMethod: 'guidewell', rate: null, active: true },
  { id: 'g4', name: 'Dev Placeholder', subject: 'Essay Coaching', invoiceMethod: 'guidewell', rate: null, active: true },
  { id: 'g5', name: 'Eve Madeup', subject: 'TMUA', invoiceMethod: 'guidewell', rate: null, active: true },
  { id: 'c1', name: 'Northfield SAT Course', subject: '', invoiceMethod: 'guidewell', schoolCourse: true, rate: null, active: true },
  { id: 'c2', name: 'Sunday Bespoke SAT Course', subject: 'Group Q', invoiceMethod: 'guidewell', schoolCourse: true, rate: 65, active: true },
  { id: 'd1', name: 'Allegra Testcase', subject: 'Essay Coaching', invoiceMethod: 'direct', rate: 150, parentName: 'Carol Testcase', parentEmail: 'carol@example.com', active: true },
  { id: 'l1', name: 'Luba Kid', subject: 'Maths', invoiceMethod: 'luba', rate: 40, active: true },
];
const d = (day) => `${MONTH}-${String(day).padStart(2, '0')}`;
const S = (studentId, day, duration, status = 'completed', extra = {}) => ({ id: sid(), studentId, date: d(day), start: '16:00', duration, status, ...extra });
export const sessions = [];
// Private lessons: 64 billed lessons = 68.25 h at the default £75/h.
// 60 × 60 min, of which one is a 55-min lesson (rounds to 1 h), one a no-show and one a late cancel (both billed).
const priv = ['g1', 'g2', 'g3', 'g4', 'g5'];
for (let i = 0; i < 60; i++) {
  const dur = i === 7 ? 55 : 60;
  const status = i === 3 ? 'no_show' : i === 11 ? 'late_cancel' : 'completed';
  sessions.push(S(priv[i % 5], 1 + (i % 28), dur, status));
}
// Ben's second subject this month (a separate line on the invoice).
sessions.push(S('g2', 9, 120, 'completed', { subject: 'Test Consultation' }), S('g2', 16, 120, 'completed', { subject: 'Test Consultation' }));
sessions.push(S('g1', 20, 120), S('g3', 21, 130)); // 130 min rounds to 135 min (2.25 h)
// Not billed: cancelled, scheduled, and a "don't bill" override.
sessions.push(S('g1', 22, 60, 'cancelled'), S('g2', 30, 60, 'scheduled'), S('g4', 23, 60, 'completed', { noBill: true }));
// Schools courses: Northfield 4 × 1 h at £75; Sunday Bespoke 2 × 75 min = 2.5 h at £65 (course rate).
for (const day of [6, 13, 20, 27]) sessions.push(S('c1', day, 60));
sessions.push(S('c2', 7, 75), S('c2', 14, 75));
// Other channels (must not appear on the Guidewell invoice).
// Direct student: 60 + 60 + 50 (→ 45) + 60 min = 3.75 h at £150 = £562.50.
sessions.push(S('d1', 2, 60), S('d1', 9, 60), S('d1', 16, 50), S('d1', 23, 60), S('l1', 3, 60));

export const record = {
  id: 'gwinv-2026-09', number: 67, date: '2026-10-01',
  lines: [
    { id: 'l1', section: 'schools', date: '', description: 'Admin time', qty: 1, rate: 20 },
    { id: 'l2', section: 'admin', date: '', description: 'Winchester Safeguarding Training', qty: 1, rate: 25 },
    { id: 'l3', section: 'admin', date: '2026-09-03', description: 'Intro call with prospective student Daphne', qty: 0.25, rate: 20 },
    { id: 'l4', section: 'admin', date: '', description: 'lots of student emails', qty: 0.5, rate: 20 },
  ],
};
export const settings = {
  yourName: 'Sample Tutor', address: '1 Example Street\nExampletown EX1 1AA', phone: '01234 567890', email: 'tutor@example.com',
  guidewellBillTo: 'Example Agency Ltd\nCompany no.: 00000000', guidewellRate: 75, adminRate: 20, lessonAdminMins: 5, defaultRate: 40,
  invoiceFooter: 'Please pay within 15 days from the date of this invoice.\nPlease pay by bank transfer to:\nAccount name: SAMPLE TUTOR\nAccount number: 00000000\nSort code: 00-00-00\nReference: Tutor Invoice',
};
