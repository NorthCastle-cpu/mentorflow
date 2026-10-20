// Direct-student payment request email (pure). Sarah presses Send herself; the app only opens a draft.
import { isBilled, billedHours, round2, monthName, monthLong, joinNatural, firstName } from './billing.js';

const num = (v, d) => (v === '' || v == null || isNaN(+v)) ? d : +v;
export const BANK_PLACEHOLDER = '[your bank details here]';
export const DEFAULT_PAYMENT_TEMPLATE = `Hi {ParentFirstName},

I’m just reaching out to request payment of £{amount} for {StudentFirstName}’s {hours} hours of {Subject} in {Month}, at your earliest convenience. 

My bank details are:
${BANK_PLACEHOLDER}

Please let me know if you have any questions, thanks. 

Kindest regards,
Sarah`;
export const DEFAULT_PAYMENT_SUBJECT = 'Payment for {StudentFirstName}’s {Subject} – {Month}';
export const PLACEHOLDERS = ['ParentFirstName', 'amount', 'StudentFirstName', 'hours', 'Subject', 'Month', 'Year'];

/** £1350 when whole, otherwise £1350.50 — no thousands separator. */
export const fmtAmount = (n) => { const v = round2(n); return Number.isInteger(v) ? String(v) : v.toFixed(2); };
export const fmtHoursPlain = (h) => String(round2(h));

/** Fill a template. "{hours} hours" becomes "1 hour" when hours = 1. Unknown placeholders are left as typed. */
export function fillTemplate(tpl, vals) {
  let t = String(tpl ?? '');
  if (+vals.hours === 1) t = t.replace(/\{hours\}(\s+)hours\b/g, '{hours}$1hour');
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in vals && vals[k] != null ? String(vals[k]) : m));
}

/** Billed totals for one Direct student in a month (each session rounded to the nearest 15 minutes). */
export function directSummary({ month, student, sessions = [], settings = {} }) {
  const list = sessions.filter(s => s.studentId === student.id && s.date?.startsWith(month) && isBilled(s)).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  let hours = 0, amount = 0; const subjects = [];
  for (const s of list) {
    const h = billedHours(s); const rate = num(s.rate, num(student.rate, num(settings.defaultRate, 0)));
    hours += h; amount += round2(rate * h) + (+s.travel || 0);
    const subj = (s.subject || student.subject || '').trim();
    if (subj && !subjects.some(x => x.toLowerCase() === subj.toLowerCase())) subjects.push(subj);
  }
  return { sessions: list, count: list.length, hours: round2(hours), amount: round2(amount), subjects };
}

export function paymentRequest({ month, student, sessions, settings = {}, parentFirstName, parentEmail }) {
  const sum = directSummary({ month, student, sessions, settings });
  const parentFirst = (parentFirstName ?? firstName(student.parentName)).trim();
  const to = (parentEmail ?? student.parentEmail ?? '').trim();
  const vals = { ParentFirstName: parentFirst, amount: fmtAmount(sum.amount), StudentFirstName: firstName(student.name), hours: fmtHoursPlain(sum.hours), Subject: joinNatural(sum.subjects) || 'tutoring', Month: monthName(month), Year: month.slice(0, 4), MonthYear: monthLong(month) };
  const body = fillTemplate(settings.paymentEmailTemplate || DEFAULT_PAYMENT_TEMPLATE, vals);
  const subject = fillTemplate(settings.paymentEmailSubject || DEFAULT_PAYMENT_SUBJECT, vals);
  const missing = [!parentFirst && 'parent first name', !to && 'parent email'].filter(Boolean);
  return { to, subject, body, ...sum, values: vals, missing, hasBankPlaceholder: body.includes(BANK_PLACEHOLDER) };
}

export const mailtoUrl = ({ to, subject, body }) => `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
