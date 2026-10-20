import { state, expensesInMonth, EXPENSE_CATEGORIES } from '../store.js';
import { esc, money, fmtDate, fmtMonth } from '../util.js';
import { icon, emptyState, chip } from '../ui.js';
import { ui } from '../uistate.js';
import { monthNav } from './sessions.js';

export const title = 'Expenses';
export function render() {
  const month = ui.expMonth;
  const list = expensesInMonth(month).sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((a, e) => a + +e.amount, 0);
  const byCat = {}; list.forEach(e => byCat[e.category] = (byCat[e.category] || 0) + +e.amount);
  const max = Math.max(1, ...Object.values(byCat));
  const yearStart = month.slice(0, 4);
  const ytd = state.expenses.length ? Array.from({ length: +month.slice(5) }, (_, i) => `${yearStart}-${String(i + 1).padStart(2, '0')}`).reduce((a, m) => a + expensesInMonth(m).reduce((x, e) => x + +e.amount, 0), 0) : 0;
  const body = list.length ? `<div class="cols">
    <section class="card"><header class="card-head"><h3>${esc(fmtMonth(month))}</h3><b>${money(total)}</b></header><div class="list">${list.map(e => `<button class="row-item expense" data-action="edit-expense" data-id="${e.id}"><span class="who"><b>${esc(e.description || e.category)}</b><small>${esc(fmtDate(e._recurringInstance ? month + e.date.slice(7) : e.date))} · ${esc(e.category)}${e.recurring ? ' · monthly' : ''}</small></span><span class="val"><b>${money(e.amount)}</b></span></button>`).join('')}</div></section>
    <section class="card"><header class="card-head"><h3>By category</h3></header><div class="cat-bars">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="cat-bar"><span>${esc(c)}</span><div class="bar"><i style="width:${v / max * 100}%"></i></div><b>${money(v)}</b></div>`).join('')}</div>
      <p class="muted small">Year to date (${yearStart}): <b>${money(ytd)}</b></p></section></div>`
    : `<div class="card">${emptyState('expenses', 'No expenses this month', 'Track travel, books and subscriptions so your net income is accurate.', `<button class="btn primary small" data-action="new-expense">${icon('plus')} Add expense</button>`)}</div>`;
  return { html: `<div class="view-tools">${monthNav('expMonth', month)}</div>${body}`, actions: `<button class="btn" data-action="export-expenses" data-month="${month}">${icon('download')}<span class="hide-sm"> CSV</span></button><button class="btn primary" data-action="new-expense">${icon('plus')}<span class="hide-sm"> Expense</span></button>` };
}
