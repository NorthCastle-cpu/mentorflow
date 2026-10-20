export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
export const money = (n) => gbp.format(+n || 0);
export const money0 = (n) => gbp0.format(+n || 0);
export const round2 = (n) => Math.round((+n || 0) * 100) / 100;

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const todayStr = () => ymd(new Date());
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (ymStr, n) => { const [y, m] = ymStr.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return ym(d); };
export const monthDays = (ymStr) => { const [y, m] = ymStr.split('-').map(Number); return new Date(y, m, 0).getDate(); };

export const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => s ? parseYmd(s).toLocaleDateString('en-GB', opts) : '';
export const fmtDateLong = (s) => fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtMonth = (ymStr, opts = { month: 'long', year: 'numeric' }) => { const [y, m] = ymStr.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', opts); };
export const fmtHours = (mins) => { const h = mins / 60; return (Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')) + 'h'; };
export const timeToMins = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const minsToTime = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const endTime = (start, dur) => minsToTime(timeToMins(start) + (+dur || 0));

export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
  }
}

export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
