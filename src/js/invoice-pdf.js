// Guidewell invoice → PDF with jsPDF (works offline: jsPDF is vendored and precached).
// Mirrors Sarah's Pages invoices (Arial/Helvetica, grey header rows, "Invoice" heading on every page),
// with every font 2pt larger and table columns sized to their content.
import { fmtQty, gbp2, gbpShort, gbpGrand } from './billing.js';

export const FONT = { title: 30, body: 12, table: 11 };
const A4 = { w: 595.28, h: 841.89 }; const M = 50; const PAD = 4; const PADV = 4;
const COLS = ['Date(s)', 'Description', 'Rate', 'Hours', 'Sub-total', 'Travel', 'Total'];

// Standard PDF fonts only cover Windows-1252; map anything else to a close equivalent.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const NO_DECOMP = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h', '−': '-', '\u2011': '-' };
export function pdfSafe(s) {
  return String(s ?? '').replace(/[^\n\x20-\x7e\xa0-\xff]/g, (c) => {
    if (CP1252_EXTRA.includes(c)) return c;
    if (NO_DECOMP[c]) return NO_DECOMP[c];
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x20-\x7e\xa0-\xff]+$/.test(base) ? base : '?';
  });
}

export function rowCells(r) { return [r.dates, r.description, gbpShort(r.rate), r.hoursLabel || fmtQty(r.hours), gbp2(r.subtotal), gbpShort(r.travel), gbp2(r.total)]; }
export function totalCells(sec) { return ['', 'TOTAL', '', fmtQty(sec.hours), gbp2(sec.subtotal), gbp2(sec.travel), gbp2(sec.total)]; }

/** Column widths shared by all tables: numeric columns fit their widest value, Date(s) wraps, Description takes the rest. */
export function columnWidths(doc, inv, width) {
  const w = (t, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(FONT.table); return doc.getTextWidth(pdfSafe(t)); };
  const widths = COLS.map(h => w(h, true) + 2 * PAD);
  for (const sec of inv.sections) {
    for (const r of sec.rows) rowCells(r).forEach((c, i) => { if (i >= 2) widths[i] = Math.max(widths[i], w(c) + 2 * PAD); });
    totalCells(sec).forEach((c, i) => { if (i >= 2) widths[i] = Math.max(widths[i], w(c, true) + 2 * PAD); });
  }
  widths[0] = Math.max(widths[0], w('22nd, 23rd, 24th,') + 2 * PAD);
  widths[1] = width - widths.reduce((a, x, i) => (i === 1 ? a : a + x), 0);
  return widths;
}

export function renderInvoicePdf(jsPDF, inv) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: `Invoice ${inv.number} - ${inv.monthLabel}`, creator: 'MentorFlow' });
  const W = A4.w - 2 * M; const bottom = A4.h - M;
  const lh = (size) => size * 1.22;
  const font = (bold, size) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); };
  const text = (t, x, y, o) => doc.text(pdfSafe(t), x, y, o);
  let y;
  const pageTop = () => { font(true, FONT.title); doc.setTextColor(0); text('Invoice', M, M + FONT.title * 0.75); y = M + FONT.title * 1.1; };
  const ensure = (h) => { if (y + h > bottom) { doc.addPage(); pageTop(); y += 14; } };
  pageTop();

  // ----- header blocks -----
  const B = FONT.body, L = lh(B);
  let ly = y + 14, ry = y + 14;
  font(true, B); text('Invoice to:', M, ly); ly += L;
  font(false, B); for (const t of inv.to) { text(t, M, ly); ly += L; }
  const right = (label, value) => {
    const xR = A4.w - M; font(false, B); const vw = value ? doc.getTextWidth(pdfSafe(value)) : 0; const gap = value && label ? doc.getTextWidth(' ') * 1.6 : 0;
    if (value) text(value, xR, ry, { align: 'right' });
    if (label) { font(true, B); text(label, xR - vw - gap, ry, { align: 'right' }); }
    ry += L;
  };
  right('Invoice from:', inv.from.name);
  for (const t of [inv.from.business, inv.from.address, inv.from.phone, inv.from.email]) if (t) right('', t);
  right('Invoice #:', String(inv.number));
  right('Invoice date:', inv.dateLabel);
  y = Math.max(ly, ry) + L * 0.6;
  font(false, B); text(inv.intro, M, y); y += L * 1.6;

  // ----- tables -----
  const widths = columnWidths(doc, inv, W);
  const xs = widths.reduce((a, w, i) => (a.push(a[i] + w), a), [M]);
  const TL = lh(FONT.table);
  const drawRow = (cells, { bold = false, fill = null, align = [] } = {}) => {
    font(bold, FONT.table);
    const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfSafe(c), widths[i] - 2 * PAD));
    const h = Math.max(...wrapped.map(l => l.length)) * TL + 2 * PADV;
    ensure(h);
    if (fill) { doc.setFillColor(...fill); doc.rect(M, y, W, h, 'F'); }
    doc.setDrawColor(150); doc.setLineWidth(0.5);
    wrapped.forEach((lines, i) => {
      doc.rect(xs[i], y, widths[i], h);
      lines.forEach((t, j) => { const ty = y + PADV + TL * j + FONT.table * 0.85; if (align[i] === 'right') doc.text(t, xs[i + 1] - PAD, ty, { align: 'right' }); else doc.text(t, xs[i] + PAD, ty); });
    });
    y += h;
  };
  for (const sec of inv.sections) {
    ensure(L + 3 * TL + 4 * PADV);
    font(true, B); text(sec.title + ':', M, y); y += L * 0.6;
    drawRow(COLS, { bold: true, fill: [217, 217, 217] });
    if (!sec.rows.length) drawRow(['', 'No Guidewell lessons this month', '', '', '', '', '']);
    for (const r of sec.rows) drawRow(rowCells(r));
    drawRow(totalCells(sec), { bold: true, fill: [217, 217, 217], align: [null, 'right'] });
    y += L * 1.4;
  }

  // ----- TOTALS -----
  font(false, FONT.table);
  const tw = [Math.max(150, ...inv.totals.map(t => doc.getTextWidth(pdfSafe(t.type)) + 2 * PAD + 30)), 0];
  font(true, FONT.table); tw[1] = Math.max(120, doc.getTextWidth(gbpGrand(inv.grand)) + 2 * PAD + 40);
  const trow = (a, b, { bold = false, fill = null } = {}) => {
    const h = TL + 2 * PADV; ensure(h); font(bold, FONT.table);
    if (fill) { doc.setFillColor(...fill); doc.rect(M, y, tw[0] + tw[1], h, 'F'); }
    doc.setDrawColor(150); doc.rect(M, y, tw[0], h); doc.rect(M + tw[0], y, tw[1], h);
    text(a, M + PAD, y + PADV + FONT.table * 0.85); text(b, M + tw[0] + PAD, y + PADV + FONT.table * 0.85); y += h;
  };
  ensure(L + 4 * (TL + 2 * PADV));
  font(true, B); text('TOTALS:', M, y); y += L * 0.6;
  trow('Type', 'Total', { bold: true, fill: [217, 217, 217] });
  for (const t of inv.totals) trow(t.type, gbp2(t.total));
  trow('TOTAL', gbpGrand(inv.grand), { bold: true, fill: [217, 217, 217] });
  y += L * 1.4;

  // ----- footer / payment details (free text from Settings; "Label: value" shows the value in bold) -----
  for (const raw of inv.footer) {
    const lines = raw.trim() ? [raw] : [''];
    for (const line of lines) {
      ensure(L);
      const m = line.match(/^([^:]{1,40}:)\s*(.+)$/);
      if (m && !/^please\b/i.test(line)) { font(false, B); text(m[1] + ' ', M, y); const x = M + doc.getTextWidth(pdfSafe(m[1] + ' ')); font(true, B); text(m[2], x, y); }
      else { font(false, B); for (const part of doc.splitTextToSize(pdfSafe(line), W)) { ensure(L); doc.text(part, M, y); y += L; } continue; }
      y += L;
    }
  }
  return doc;
}
