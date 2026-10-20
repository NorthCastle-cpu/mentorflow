import { state, monthStats, billableByStudent, INVOICE_METHODS, SESSION_STATUS, sessionsInMonth, sessionMethod, nextInvoiceNumber } from '../store.js';
import { esc, money, fmtMonth, ym, addMonths, fmtHours, todayStr } from '../util.js';
import { icon, emptyState, avatar, chip } from '../ui.js';
import { ui } from '../uistate.js';
import { barChart, donut } from '../charts.js';
import { monthNav } from './sessions.js';
import { labelHex } from '../forms.js';
import { parentEmail, mailtoUrl } from '../export.js';

export const title = 'Money';

const ck = (month, key, label, extra = '', auto = null) => {
  const on = auto ?? !!state.checklists[month]?.[key];
  return `<div class="ck-row ${on ? 'on' : ''}"><label class="tick"><input type="checkbox" data-change="checklist" data-month="${month}" data-key="${key}" ${on ? 'checked' : ''} ${auto !== null ? 'disabled' : ''}><i></i></label><span class="ck-label">${label}</span>${extra}</div>`;
};

export function render() {
  const month = ui.moneyMonth;
  const st = monthStats(month);
  const isCurrent = month === ym(new Date());
  const pct = st.target ? Math.min(100, Math.round(st.actual / st.target * 100)) : 0;
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const chartData = months.map(m => { const s = monthStats(m); return { label: fmtMonth(m, { month: 'short' }), current: m === month, values: { actual: s.actual, forecast: s.forecast, expenses: s.expenses } }; });
  const chart = barChart(chartData, { series: [{ key: 'actual', label: 'Actual', color: 'var(--accent)' }, { key: 'forecast', label: 'Forecast', color: 'var(--accent)', dashed: true }, { key: 'expenses', label: 'Expenses', color: '#f97316' }] });
  const pie = donut(Object.values(INVOICE_METHODS).map(m => ({ label: m.label, value: st.byMethod[m.key].actual, color: m.color })), { label: 'actual' });
  const unmarked = st.sessions.filter(s => s.status === 'scheduled' && s.date < todayStr());
  const methodRows = Object.values(INVOICE_METHODS).map(m => { const b = st.byMethod[m.key]; return `<tr><td><i class="dot" style="background:${m.color}"></i>${esc(m.label)}</td><td class="r">${b.count}</td><td class="r">${fmtHours(b.mins)}</td><td class="r">${money(b.actual)}</td><td class="r muted">${money(b.forecast)}</td></tr>`; }).join('');

  const allMarkedFor = (method) => !st.sessions.some(s => s.status === 'scheduled' && s.date < todayStr() && sessionMethod(s) === method);
  const gw = billableByStudent(month, 'guidewell'); const gwTotal = gw.reduce((a, g) => a + g.total, 0);
  const lj = billableByStudent(month, 'luba'); const ljTotal = lj.reduce((a, g) => a + g.total, 0); const ljMins = lj.reduce((a, g) => a + g.mins, 0);
  const dr = billableByStudent(month, 'direct');
  const S = state.settings;
  const gwMail = mailtoUrl({ to: S.guidewellEmail, subject: `Invoice ${fmtMonth(month)} – ${S.yourName || ''}`.trim(), body: `Hello,\n\nPlease find attached my invoice for ${fmtMonth(month)} (${money(gwTotal)}).\n\nKind regards,\n${S.yourName || ''}` });
  const ljMail = mailtoUrl({ to: S.lubaEmail, subject: `Hours for ${fmtMonth(month)} – ${S.yourName || ''}`.trim(), body: `Hi Luba,\n\nPlease find attached my hours for ${fmtMonth(month)}: ${fmtHours(ljMins)}, ${money(ljTotal)} in total.\n\nThanks,\n${S.yourName || ''}` });

  const checklist = `<section class="card checklist"><header class="card-head"><h3>Month-end checklist · ${esc(fmtMonth(month))}</h3></header>
    <div class="ck-group" style="--m:${INVOICE_METHODS.guidewell.color}"><h4><i class="dot"></i>Guidewell <span class="muted">${gw.length} student${gw.length === 1 ? '' : 's'} · ${money(gwTotal)}</span></h4>
      ${ck(month, 'gw-marked', 'All Guidewell sessions marked', '', allMarkedFor('guidewell'))}
      ${ck(month, 'gw-invoice', 'Create PDF invoice', `<span class="ck-act"><button class="btn small" data-action="guidewell-pdf" data-month="${month}">${icon('file')} PDF</button><button class="btn small ghost" data-action="guidewell-print" data-month="${month}">Printable</button></span>`)}
      ${ck(month, 'gw-sent', 'Email invoice to Guidewell', `<span class="ck-act"><a class="btn small ghost" href="${esc(gwMail)}">${icon('mail')} Email</a></span>`)}
      ${ck(month, 'gw-paid', 'Payment received')}</div>
    <div class="ck-group" style="--m:${INVOICE_METHODS.luba.color}"><h4><i class="dot"></i>Luba Jones <span class="muted">${fmtHours(ljMins)} · ${money(ljTotal)}</span></h4>
      ${ck(month, 'lj-marked', 'All Luba Jones sessions marked', '', allMarkedFor('luba'))}
      ${ck(month, 'lj-csv', 'Export hours CSV', `<span class="ck-act"><button class="btn small" data-action="luba-csv" data-month="${month}">${icon('download')} CSV</button></span>`)}
      ${ck(month, 'lj-sent', 'Send hours to Luba Jones', `<span class="ck-act"><a class="btn small ghost" href="${esc(ljMail)}">${icon('mail')} Email</a></span>`)}
      ${ck(month, 'lj-paid', 'Payment received')}</div>
    <div class="ck-group" style="--m:${INVOICE_METHODS.direct.color}"><h4><i class="dot"></i>Direct (parents) <span class="muted">${money(dr.reduce((a, g) => a + g.total, 0))}</span></h4>
      ${dr.length ? dr.map(g => { const e = parentEmail(month, g.student.id); return `<div class="ck-parent"><div class="ck-parent-head">${avatar(g.student.name, labelHex(g.student.labelColor))}<div><b>${esc(g.student.name)}</b><small class="muted">${g.sessions.length} sessions · ${fmtHours(g.mins)} · ${money(g.total)}${g.student.parentEmail ? '' : ' · <span class="overdue">no parent email</span>'}</small></div>
        <span class="ck-act"><a class="btn small" href="${esc(mailtoUrl(e))}" data-action="mark-sent" data-month="${month}" data-key="dr-sent-${g.student.id}">${icon('mail')} Email</a><button class="btn small ghost" data-action="copy-parent" data-month="${month}" data-id="${g.student.id}">${icon('copy')} Copy</button></span></div>
        ${ck(month, 'dr-sent-' + g.student.id, 'Summary sent')}${ck(month, 'dr-paid-' + g.student.id, 'Paid')}</div>`; }).join('') : '<p class="muted small">No billable direct sessions this month.</p>'}</div>
  </section>`;

  return { html: `<div class="view-tools">${monthNav('moneyMonth', month)}</div>
    ${unmarked.length ? `<div class="banner warn">${icon('alert')}<div><b>${unmarked.length} past session${unmarked.length === 1 ? '' : 's'} still “scheduled”</b><small>They count in the forecast but not in actuals.</small></div><button class="btn small" data-action="mark-past-complete" data-month="${month}">Mark completed</button></div>` : ''}
    <div class="kpis">
      <div class="kpi accent"><small>Actual income</small><b data-testid="money-actual">${money(st.actual)}</b><small>${st.completedCount} completed · ${fmtHours(st.actualMins)}</small></div>
      <div class="kpi"><small>${isCurrent ? 'Forecast (incl. scheduled)' : 'Forecast'}</small><b data-testid="money-forecast">${money(st.forecast)}</b><small>${st.scheduledCount} scheduled</small></div>
      <div class="kpi"><small>Expenses</small><b data-testid="money-expenses">${money(st.expenses)}</b><small><a href="#/expenses">View expenses</a></small></div>
      <div class="kpi"><small>Net (actual − expenses)</small><b data-testid="money-net">${money(st.net)}</b><small>Forecast net ${money(st.netForecast)}</small></div>
    </div>
    ${st.target ? `<div class="card target"><div class="target-row"><span>Monthly target</span><b>${pct}% of ${money(st.target)}</b></div><div class="bar big"><i style="width:${pct}%"></i><em style="left:${Math.min(100, st.target ? st.forecast / st.target * 100 : 0)}%" title="Forecast"></em></div></div>` : ''}
    <div class="cols money-cols">
      <div class="stack">
        <section class="card"><header class="card-head"><h3>Last 6 months</h3></header>${chart}</section>
        <section class="card"><header class="card-head"><h3>By invoice method</h3></header>${pie}
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Method</th><th class="r">Sessions</th><th class="r">Hours</th><th class="r">Actual</th><th class="r">Forecast</th></tr></thead><tbody>${methodRows}</tbody></table></div></section>
      </div>
      ${checklist}
    </div>`, actions: `<button class="btn" data-action="export-csv" data-month="${month}">${icon('download')}<span class="hide-sm"> Sessions CSV</span></button>` };
}
