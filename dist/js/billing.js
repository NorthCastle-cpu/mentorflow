// Pure billing helpers shared by the Guidewell invoice, parent payment emails and Money totals.
// No DOM / IndexedDB access here, so it is unit-testable in Node.

/** Session statuses that are billed (no-shows and late cancellations are charged). */
export const BILLED_STATUSES = new Set(['completed', 'late_cancel', 'no_show']);
export const isBilled = (s) => BILLED_STATUSES.has(s?.status) && !s?.noBill;

/** Billing rounds every session's length to the NEAREST 15 minutes (50 min → 45, 55 min → 60). */
export const roundToQuarter = (mins) => Math.round((+mins || 0) / 15) * 15;
export const billedMins = (s) => roundToQuarter(s?.duration);
export const billedHours = (s) => billedMins(s) / 60;
/** Lesson lengths are entered in 5-minute steps. */
export const roundTo5 = (mins) => Math.max(5, Math.round((+mins || 0) / 5) * 5);

export const round2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (ym) => MONTH_NAMES[+ym.slice(5, 7) - 1];
export const monthLong = (ym) => `${monthName(ym)} ${ym.slice(0, 4)}`;
export function monthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
export function nextMonth(ym) { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; }

export function ordinal(n) {
  n = +n; const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}
/** "2026-10-01" → "1st October 2026" (the format on Sarah's invoices). */
export const fmtLongDate = (ymd) => ymd ? `${ordinal(+ymd.slice(8, 10))} ${monthName(ymd.slice(0, 7))} ${ymd.slice(0, 4)}` : '';

/** Quantities: 15, 5.75, 0.25, 5.58 (max 2 decimals, no trailing zeros). */
export const fmtQty = (h) => String(round2(h));
/** £1125.00 (as on the invoice lines: always 2 decimals, no thousands separator). */
export const gbp2 = (n) => '£' + round2(n).toFixed(2);
/** £75 / £62.50 (rates and the Travel column). */
export const gbpShort = (n) => { const v = round2(n); return '£' + (Number.isInteger(v) ? String(v) : v.toFixed(2)); };
/** £4,617.08 (grand total, with thousands separator). */
export const gbpGrand = (n) => { const [i, d] = round2(n).toFixed(2).split('.'); return '£' + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + d; };

/** Join a list naturally: "A", "A and B", "A, B and C". */
export function joinNatural(list) {
  const xs = list.filter(Boolean);
  if (xs.length <= 1) return xs[0] || '';
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
