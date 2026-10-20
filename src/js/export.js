// Month-end exports. Everything is generated on-device; nothing is uploaded.
import { state, sessionsInMonth, studentById, studentName, sessionValue, sessionRate, sessionMethod, billableByStudent, SESSION_STATUS, INVOICE_METHODS, nextInvoiceNumber } from './store.js';
import { toCsv, download, money, fmtMonth, fmtDate, endTime, fmtHours, round2, slug, todayStr, addDays, parseYmd, ymd, esc } from './util.js';

export function sessionsCsv(month) {
  const rows = [['Date', 'Start', 'End', 'Duration (mins)', 'Student', 'Subject', 'Invoice method', 'Status', 'Rate (GBP/h)', 'Value (GBP)', 'Notes']];
  for (const s of sessionsInMonth(month)) {
    const st = studentById(s.studentId);
    const billable = SESSION_STATUS[s.status]?.billable;
    rows.push([s.date, s.start, endTime(s.start, s.duration), s.duration, st?.name || '', st?.subject || '', INVOICE_METHODS[sessionMethod(s)]?.label || '', SESSION_STATUS[s.status]?.label || s.status, sessionRate(s).toFixed(2), billable ? sessionValue(s).toFixed(2) : '0.00', s.notes || '']);
  }
  return toCsv(rows);
}
export function downloadSessionsCsv(month) { download(`mentorflow-sessions-${month}.csv`, sessionsCsv(month), 'text/csv'); }

export function lubaHoursCsv(month) {
  const rows = [['Tutor', state.settings.yourName || ''], ['Month', fmtMonth(month)], [], ['Student', 'Date', 'Start', 'End', 'Hours', 'Rate (GBP/h)', 'Amount (GBP)', 'Notes']];
  let totalH = 0, total = 0;
  for (const g of billableByStudent(month, 'luba')) {
    for (const s of g.sessions) {
      const h = round2(s.duration / 60), v = sessionValue(s);
      totalH += h; total += v;
      rows.push([g.student?.name || '', s.date, s.start, endTime(s.start, s.duration), h.toFixed(2), sessionRate(s).toFixed(2), v.toFixed(2), s.status === 'late_cancel' ? 'Late cancellation (charged)' : (s.notes || '')]);
    }
  }
  rows.push([], ['TOTAL', '', '', '', round2(totalH).toFixed(2), '', round2(total).toFixed(2), '']);
  return toCsv(rows);
}
export function downloadLubaCsv(month) { download(`luba-jones-hours-${month}.csv`, lubaHoursCsv(month), 'text/csv'); }

// ---------- Direct (parent) email ----------
export function parentEmail(month, studentId) {
  const g = billableByStudent(month, 'direct').find(x => x.student?.id === studentId);
  const st = studentById(studentId);
  const S = state.settings;
  const lines = g ? g.sessions.map(s => `• ${fmtDate(s.date)} ${s.start}–${endTime(s.start, s.duration)} (${fmtHours(s.duration)})${s.status === 'late_cancel' ? ' – late cancellation' : ''}: ${money(sessionValue(s))}`) : [];
  const total = g ? g.total : 0;
  const due = ymd(addDays(new Date(), +S.paymentTermsDays || 14));
  const ref = `${(st?.name || 'Tuition').split(' ')[0]} ${fmtMonth(month, { month: 'short', year: 'numeric' })}`;
  const subject = `${st?.name || 'Tuition'} – sessions for ${fmtMonth(month)}`;
  const body = [
    `Hi ${st?.parentName ? st.parentName.split(' ')[0] : 'there'},`, '',
    `Here is a summary of ${st?.name ? st.name.split(' ')[0] + "'s" : 'the'} sessions for ${fmtMonth(month)}:`, '',
    ...lines, '',
    `Total: ${money(total)} (${g ? fmtHours(g.mins) : '0h'} at ${money(st?.rate ?? S.defaultRate)}/hour)`, '',
    `Please pay by bank transfer by ${fmtDate(due, { day: 'numeric', month: 'long', year: 'numeric' })}:`,
    `Account name: ${S.bankAccountName || '—'}`, `Sort code: ${S.bankSortCode || '—'}`, `Account number: ${S.bankAccountNumber || '—'}`, `Reference: ${ref}`, '',
    'Many thanks,', S.yourName || '',
  ].join('\n');
  return { to: st?.parentEmail || '', subject, body, total, count: g?.sessions.length || 0 };
}
export const mailtoUrl = ({ to, subject, body }) => `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// ---------- Guidewell invoice ----------
export function guidewellInvoiceData(month, invoiceNo) {
  const S = state.settings;
  const groups = billableByStudent(month, 'guidewell');
  const lines = [];
  for (const g of groups) for (const s of g.sessions) lines.push({ date: s.date, student: g.student?.name || '', desc: `${g.student?.subject || 'Tuition'}${s.status === 'late_cancel' ? ' (late cancellation)' : ''}`, hours: round2(s.duration / 60), rate: sessionRate(s), amount: sessionValue(s) });
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.student.localeCompare(b.student));
  const total = round2(lines.reduce((a, l) => a + l.amount, 0));
  const hours = round2(lines.reduce((a, l) => a + l.hours, 0));
  const issued = todayStr();
  const due = ymd(addDays(parseYmd(issued), +S.paymentTermsDays || 14));
  return { invoiceNo: invoiceNo || nextInvoiceNumber(false), month, issued, due, lines, total, hours, from: S, to: { name: 'Guidewell', email: S.guidewellEmail, ref: S.guidewellRef } };
}

let jsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (!jsPdfPromise) jsPdfPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    sc.onload = () => window.jspdf ? resolve(window.jspdf) : reject(new Error('jsPDF failed to initialise'));
    sc.onerror = () => { jsPdfPromise = null; reject(new Error('Could not load jsPDF')); };
    document.head.appendChild(sc);
  });
  return jsPdfPromise;
}

export async function guidewellPdf(month, { consumeNumber = true } = {}) {
  const { jsPDF } = await loadJsPdf();
  const inv = guidewellInvoiceData(month, nextInvoiceNumber(consumeNumber));
  const S = inv.from;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18; let y = 20;
  const teal = [13, 148, 136];
  doc.setFillColor(...teal); doc.rect(0, 0, W, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...teal); doc.text('INVOICE', M, y + 6);
  doc.setFontSize(10); doc.setTextColor(40); doc.setFont('helvetica', 'normal');
  const rightX = W - M;
  [[`Invoice no: ${inv.invoiceNo}`], [`Issued: ${fmtDate(inv.issued, { day: 'numeric', month: 'long', year: 'numeric' })}`], [`Due: ${fmtDate(inv.due, { day: 'numeric', month: 'long', year: 'numeric' })}`], [`Period: ${fmtMonth(month)}`]]
    .forEach(([t], i) => doc.text(t, rightX, y + i * 5, { align: 'right' }));
  y += 26;
  doc.setFont('helvetica', 'bold'); doc.text('From', M, y); doc.text('Bill to', 110, y);
  doc.setFont('helvetica', 'normal');
  const fromLines = [S.businessName || S.yourName, S.businessName && S.yourName ? S.yourName : null, ...(S.address || '').split('\n'), S.email, S.phone].filter(Boolean);
  const toLines = ['Guidewell', inv.to.email, inv.to.ref ? `Tutor ref: ${inv.to.ref}` : null].filter(Boolean);
  fromLines.forEach((t, i) => doc.text(String(t), M, y + 5 + i * 5));
  toLines.forEach((t, i) => doc.text(String(t), 110, y + 5 + i * 5));
  y += 8 + Math.max(fromLines.length, toLines.length) * 5 + 4;
  const cols = [M, M + 24, M + 66, 132, 152, rightX];
  const header = () => {
    doc.setFillColor(240, 253, 250); doc.rect(M, y - 5, W - 2 * M, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Date', cols[0] + 1, y); doc.text('Student', cols[1], y); doc.text('Description', cols[2], y);
    doc.text('Hours', cols[3] + 12, y, { align: 'right' }); doc.text('Rate', cols[4] + 14, y, { align: 'right' }); doc.text('Amount', cols[5] - 1, y, { align: 'right' });
    doc.setFont('helvetica', 'normal'); y += 8;
  };
  header();
  for (const l of inv.lines) {
    if (y > 265) { doc.addPage(); y = 20; header(); }
    doc.text(fmtDate(l.date, { day: '2-digit', month: 'short', year: '2-digit' }), cols[0] + 1, y);
    doc.text(doc.splitTextToSize(l.student, 40)[0], cols[1], y);
    doc.text(doc.splitTextToSize(l.desc, 44)[0], cols[2], y);
    doc.text(l.hours.toFixed(2), cols[3] + 12, y, { align: 'right' });
    doc.text(money(l.rate), cols[4] + 14, y, { align: 'right' });
    doc.text(money(l.amount), cols[5] - 1, y, { align: 'right' });
    doc.setDrawColor(230); doc.line(M, y + 2.5, rightX, y + 2.5);
    y += 7;
  }
  if (!inv.lines.length) { doc.setTextColor(120); doc.text('No billable Guidewell sessions this month.', M + 1, y); doc.setTextColor(40); y += 7; }
  y += 3;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(`Total hours: ${inv.hours.toFixed(2)}`, cols[2], y);
  doc.text(`Total due: ${money(inv.total)}`, rightX - 1, y, { align: 'right' });
  y += 14;
  doc.setFontSize(10); doc.text('Payment details', M, y); doc.setFont('helvetica', 'normal');
  [`Account name: ${S.bankAccountName || '—'}`, `Sort code: ${S.bankSortCode || '—'}`, `Account number: ${S.bankAccountNumber || '—'}`, `Reference: ${inv.invoiceNo}`, `Payment terms: ${S.paymentTermsDays || 14} days`]
    .forEach((t, i) => doc.text(t, M, y + 6 + i * 5));
  doc.setFontSize(8); doc.setTextColor(140); doc.text('Generated with MentorFlow', W / 2, 290, { align: 'center' });
  const blob = doc.output('blob');
  const filename = `guidewell-invoice-${month}-${inv.invoiceNo}.pdf`;
  download(filename, blob);
  return { filename, invoice: inv, size: blob.size };
}

// Printable HTML fallback (works anywhere: Share → Print → Save as PDF on iPad).
export function guidewellPrintableHtml(month) {
  const inv = guidewellInvoiceData(month);
  const S = inv.from;
  const rows = inv.lines.map(l => `<tr><td>${esc(fmtDate(l.date, { day: '2-digit', month: 'short', year: 'numeric' }))}</td><td>${esc(l.student)}</td><td>${esc(l.desc)}</td><td class="r">${l.hours.toFixed(2)}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`).join('') || '<tr><td colspan="6">No billable Guidewell sessions this month.</td></tr>';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(inv.invoiceNo)}</title>
<style>body{font:14px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:800px;margin:24px auto;padding:0 20px}h1{color:#0d9488;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left}th{background:#f0fdfa}.r{text-align:right}.grid{display:flex;justify-content:space-between;gap:24px;margin:20px 0}.tot{font-weight:700;font-size:16px;text-align:right}.bar{height:6px;background:#0d9488;margin:-24px -20px 20px}.no-print{margin:16px 0}@media print{.no-print{display:none}body{margin:0}}</style></head>
<body><div class="bar"></div><div class="grid"><h1>INVOICE</h1><div class="r">Invoice no: ${esc(inv.invoiceNo)}<br>Issued: ${esc(fmtDate(inv.issued, { day: 'numeric', month: 'long', year: 'numeric' }))}<br>Due: ${esc(fmtDate(inv.due, { day: 'numeric', month: 'long', year: 'numeric' }))}<br>Period: ${esc(fmtMonth(month))}</div></div>
<div class="grid"><div><b>From</b><br>${esc(S.businessName || S.yourName)}<br>${esc(S.address || '').replace(/\n/g, '<br>')}<br>${esc(S.email)}</div><div><b>Bill to</b><br>Guidewell<br>${esc(inv.to.email || '')}${inv.to.ref ? '<br>Tutor ref: ' + esc(inv.to.ref) : ''}</div></div>
<table><thead><tr><th>Date</th><th>Student</th><th>Description</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<p class="tot">Total hours: ${inv.hours.toFixed(2)} &nbsp; · &nbsp; Total due: ${money(inv.total)}</p>
<p><b>Payment details</b><br>Account name: ${esc(S.bankAccountName || '—')}<br>Sort code: ${esc(S.bankSortCode || '—')}<br>Account number: ${esc(S.bankAccountNumber || '—')}<br>Reference: ${esc(inv.invoiceNo)}</p>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div></body></html>`;
}

export function openPrintableInvoice(month) {
  const html = guidewellPrintableHtml(month);
  const w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400); return true; }
  download(`guidewell-invoice-${month}.html`, html, 'text/html');
  return false;
}
