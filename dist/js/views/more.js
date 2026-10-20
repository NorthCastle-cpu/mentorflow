import { state, SCHEMA_VERSION, hasSampleData } from '../store.js';
import { esc } from '../util.js';
import { icon } from '../ui.js';
import { isPersistentStorage } from '../db.js';
import { PROVIDERS } from '../sync.js';

export const title = 'More';
export const APP_VERSION = '1.0.0';
const f = (name, label, { type = 'text', ...o } = {}) => `<label class="field"><span>${esc(label)}</span>${type === 'textarea' ? `<textarea name="${name}" rows="3" data-setting>${esc(state.settings[name])}</textarea>` : `<input name="${name}" type="${type}" value="${esc(state.settings[name])}" data-setting ${o.attrs || ''}>`}</label>`;

export const SHORTCUTS = [['⌘K / Ctrl+K or /', 'Search everything'], ['n', 'Log a session'], ['a', 'Add a student'], ['t', 'New task'], ['e', 'New expense'], ['i', 'Quick Import'], ['1 – 7', 'Today, Students, Sessions, Tasks, Money, Expenses, More'], ['[ and ]', 'Previous / next month'], ['?', 'Show shortcuts'], ['Esc', 'Close sheet']];

export function render() {
  const S = state.settings;
  const counts = `${state.students.length} students · ${state.sessions.length} sessions · ${state.tasks.length} tasks · ${state.expenses.length} expenses`;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return { html: `<div class="settings">
  <section class="card"><header class="card-head"><h3>Your details</h3><small class="muted">Used on invoices and emails</small></header><div class="form grid2">
    ${f('yourName', 'Your name')}${f('businessName', 'Business name (optional)')}${f('email', 'Email', { type: 'email' })}${f('phone', 'Phone', { type: 'tel' })}
    <div class="span2">${f('address', 'Address', { type: 'textarea' })}</div></div></section>
  <section class="card"><header class="card-head"><h3>Bank details</h3><small class="muted">Shown in parent emails and invoices</small></header><div class="form grid3">
    ${f('bankAccountName', 'Account name')}${f('bankSortCode', 'Sort code', { attrs: 'inputmode="numeric" placeholder="12-34-56"' })}${f('bankAccountNumber', 'Account number', { attrs: 'inputmode="numeric"' })}</div></section>
  <section class="card"><header class="card-head"><h3>Rates, targets & invoicing</h3></header><div class="form grid3">
    ${f('defaultRate', 'Default rate (£/h)', { type: 'number', attrs: 'step="0.01" min="0" inputmode="decimal"' })}${f('defaultDuration', 'Default length (mins)', { type: 'number', attrs: 'step="5" min="5"' })}${f('monthlyTarget', 'Monthly income target (£)', { type: 'number', attrs: 'step="50" min="0"' })}
    ${f('guidewellEmail', 'Guidewell invoice email', { type: 'email' })}${f('guidewellRef', 'Guidewell tutor ref')}${f('lubaEmail', 'Luba Jones email', { type: 'email' })}
    ${f('invoicePrefix', 'Invoice number prefix')}${f('nextInvoiceNumber', 'Next invoice number', { type: 'number', attrs: 'min="1" step="1"' })}${f('paymentTermsDays', 'Payment terms (days)', { type: 'number', attrs: 'min="0" step="1"' })}</div></section>
  <section class="card"><header class="card-head"><h3>Appearance</h3></header>
    <div class="seg" role="radiogroup">${[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<label><input type="radio" name="theme" value="${k}" data-setting ${S.theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></section>
  <section class="card" id="data"><header class="card-head"><h3>Data & backup</h3><small class="muted">${counts}</small></header>
    <p class="muted small">${icon('info')} Your data lives only on this device${isPersistentStorage() ? '' : ' <b class="overdue">(temporary storage – private browsing?)</b>'}. <b>Back up now</b> opens the share sheet on iPad – choose <b>Save to Files</b> → iCloud Drive. To restore, pick that file with <b>Restore from backup</b>.${S.lastBackupAt ? ` Last backup: ${esc(new Date(S.lastBackupAt).toLocaleString('en-GB'))}.` : ' <b>No backup yet.</b>'}</p>
    <div class="btn-grid">
      <button class="btn primary" data-action="backup-export">${icon('download')} Back up now</button>
      <label class="btn">${icon('upload')} Restore from backup<input type="file" accept="application/json,.json" data-change="backup-import" hidden></label>
      <button class="btn" data-action="export-all-csv">${icon('file')} All sessions CSV</button>
      ${hasSampleData() ? `<button class="btn" data-action="clear-sample">${icon('close')} Clear sample data</button>` : `<button class="btn" data-action="sample-data">${icon('sparkle')} Load sample data</button>`}
      <button class="btn danger" data-action="erase-all">${icon('trash')} Erase all data</button>
    </div></section>
  <section class="card"><header class="card-head"><h3>Sync</h3></header>
    <label class="field"><span>Sync provider</span><select name="syncProvider" data-setting>${Object.entries(PROVIDERS).map(([k, P]) => { const p = new P(); return `<option value="${k}" ${S.syncProvider === k ? 'selected' : ''} ${p.available ? '' : 'disabled'}>${esc(p.label)}</option>`; }).join('')}</select></label>
    <p class="muted small">Notion sync is planned. Until then MentorFlow is local-only: use JSON backup to move data between iPad and PC.</p></section>
  <section class="card"><header class="card-head"><h3>Install on iPad</h3></header>
    <p class="small">${standalone ? '✅ Running as an installed app.' : 'Open this page in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>. MentorFlow then opens full-screen and works offline.'}</p>
    <p class="small muted">On Windows, use Edge or Chrome → ⋯ → <b>Apps → Install this site as an app</b>.</p></section>
  <section class="card"><header class="card-head"><h3>Keyboard shortcuts</h3></header><dl class="dl kbd-list">${SHORTCUTS.map(([k, d]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(d)}</dd>`).join('')}</dl></section>
  <p class="muted small center">MentorFlow ${APP_VERSION} · data schema v${SCHEMA_VERSION} · offline-first PWA</p>
  </div>` };
}
