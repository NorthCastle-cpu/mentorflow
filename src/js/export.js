// Month-end exports. Everything is generated on-device; nothing is uploaded.
import { state, sessionsInMonth, studentById, sessionValue, sessionRate, sessionMethod, billableByStudent, SESSION_STATUS, INVOICE_METHODS, saveInvoiceRecord } from './store.js';
import { toCsv, download, fmtMonth, endTime, round2 } from './util.js';
import { billedMins } from './billing.js';
import { buildGuidewellInvoice, invoiceFilename } from './invoice.js';
import { renderInvoicePdf, columnWidths } from './invoice-pdf.js';
import { invoiceDocx } from './docx.js';
import { paymentRequest, directSummary } from './payreq.js';
export { mailtoUrl } from './payreq.js';

export function sessionsCsv(month) {
  const rows = [['Date', 'Start', 'End', 'Duration (mins)', 'Student', 'Subject', 'Invoice method', 'Status', 'Rate (GBP/h)', 'Value (GBP)', 'Notes']];
  for (const s of sessionsInMonth(month)) {
    const st = studentById(s.studentId);
    const billable = SESSION_STATUS[s.status]?.billable;
    rows.push([s.date, s.start, endTime(s.start, s.duration), s.duration, st?.name || '', s.subject || st?.subject || '', INVOICE_METHODS[sessionMethod(s)]?.label || '', SESSION_STATUS[s.status]?.label || s.status, sessionRate(s).toFixed(2), billable && !s.noBill ? sessionValue(s).toFixed(2) : '0.00', s.notes || '']);
  }
  return toCsv(rows);
}
export function downloadSessionsCsv(month) { download(`mentorflow-sessions-${month}.csv`, sessionsCsv(month), 'text/csv'); }

export function lubaHoursCsv(month) {
  const rows = [['Tutor', state.settings.yourName || ''], ['Month', fmtMonth(month)], [], ['Student', 'Date', 'Start', 'End', 'Hours', 'Rate (GBP/h)', 'Amount (GBP)', 'Notes']];
  let totalH = 0, total = 0;
  for (const g of billableByStudent(month, 'luba')) {
    for (const s of g.sessions) {
      const h = round2(billedMins(s) / 60), v = sessionValue(s);
      totalH += h; total += v;
      rows.push([g.student?.name || '', s.date, s.start, endTime(s.start, s.duration), h.toFixed(2), sessionRate(s).toFixed(2), v.toFixed(2), s.status === 'late_cancel' ? 'Late cancellation (charged)' : (s.notes || '')]);
    }
  }
  rows.push([], ['TOTAL', '', '', '', round2(totalH).toFixed(2), '', round2(total).toFixed(2), '']);
  return toCsv(rows);
}
export function downloadLubaCsv(month) { download(`luba-jones-hours-${month}.csv`, lubaHoursCsv(month), 'text/csv'); }

// ---------- Direct (parent) payment request email ----------
/** Direct students with billed lessons in the month, with their payment-request drafts. */
export function directRequests(month) {
  return state.students.filter(st => st.invoiceMethod === 'direct')
    .map(st => ({ student: st, req: paymentRequest({ month, student: st, sessions: state.sessions, settings: state.settings }) }))
    .filter(x => x.req.count > 0).sort((a, b) => a.student.name.localeCompare(b.student.name));
}
export const paymentRequestFor = (month, studentId, overrides = {}) => { const st = studentById(studentId); return st ? paymentRequest({ month, student: st, sessions: state.sessions, settings: state.settings, ...overrides }) : null; };
export { directSummary };

// ---------- Guidewell invoice ----------
export const guidewellInvoice = (month) => buildGuidewellInvoice({ month, students: state.students, sessions: state.sessions, settings: state.settings, record: state.invoices[month] || {}, history: state.invoices });

let jsPdfPromise = null;
export function loadJsPdf() {
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

/** Remember the number/date that went out for this month (so next month suggests number + 1). */
function markIssued(month, inv) { saveInvoiceRecord(month, { number: inv.number, date: inv.date, issuedAt: new Date().toISOString() }); }

/** iPad/iPhone: share sheet (Mail, Files, AirDrop…). Elsewhere, or if sharing isn't possible: download. */
export async function shareOrDownload(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; console.warn('Share failed, downloading instead', e); }
  download(filename, blob); return 'downloaded';
}

export async function guidewellPdfBlob(month) {
  const { jsPDF } = await loadJsPdf();
  const inv = guidewellInvoice(month);
  const doc = renderInvoicePdf(jsPDF, inv);
  return { inv, doc, blob: doc.output('blob'), filename: invoiceFilename(inv) + '.pdf' };
}
export async function guidewellPdf(month, { share = true } = {}) {
  const r = await guidewellPdfBlob(month);
  markIssued(month, r.inv);
  const how = share ? await shareOrDownload(r.blob, r.filename, `Invoice ${r.inv.number}`) : (download(r.filename, r.blob), 'downloaded');
  return { ...r, how };
}
export async function guidewellDocx(month, { share = true } = {}) {
  const { jsPDF } = await loadJsPdf();
  const inv = guidewellInvoice(month);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const bytes = invoiceDocx(inv, columnWidths(doc, inv, 595.28 - 100));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const filename = invoiceFilename(inv) + '.docx';
  markIssued(month, inv);
  const how = share ? await shareOrDownload(blob, filename, `Invoice ${inv.number} (editable)`) : (download(filename, blob), 'downloaded');
  return { inv, blob, filename, how };
}
