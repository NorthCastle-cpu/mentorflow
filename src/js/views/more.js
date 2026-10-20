import { state, SCHEMA_VERSION, hasSampleData } from '../store.js';
import { esc } from '../util.js';
import { icon } from '../ui.js';
import { isPersistentStorage } from '../db.js';
import { PROVIDERS, syncState } from '../sync.js';
import { syncStatusHtml } from '../sync-ui.js';

export const title = 'More';
export const APP_VERSION = '1.2.0';
const f = (name, label, { type = 'text', rows = 3, hint = '', ...o } = {}) => `<label class="field"><span>${esc(label)}</span>${type === 'textarea' ? `<textarea name="${name}" rows="${rows}" data-setting ${o.attrs || ''}>${esc(state.settings[name])}</textarea>` : `<input name="${name}" type="${type}" value="${esc(state.settings[name])}" data-setting ${o.attrs || ''}>`}${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;

export const SHORTCUTS = [['⌘K / Ctrl+K or /', 'Search everything'], ['n', 'Log a session'], ['a', 'Add a student'], ['t', 'New task'], ['e', 'New expense'], ['i', 'Quick Import'], ['1 – 7', 'Today, Students, Sessions, Tasks, Money, Expenses, More'], ['[ and ]', 'Previous / next month'], ['?', 'Show shortcuts'], ['Esc', 'Close sheet']];

export function render() {
  const S = state.settings;
  const counts = `${state.students.length} students · ${state.sessions.length} sessions · ${state.tasks.length} tasks · ${state.expenses.length} expenses`;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return { html: `<div class="settings">
  <section class="card"><header class="card-head"><h3>Your details</h3><small class="muted">Used on invoices and emails</small></header><div class="form grid2">
    ${f('yourName', 'Your name', { hint: 'Shown after “Invoice from:”' })}${f('businessName', 'Business name (optional)')}${f('email', 'Email', { type: 'email' })}${f('phone', 'Phone', { type: 'tel' })}
    <div class="span2">${f('address', 'Address', { type: 'textarea' })}</div></div></section>
  <section class="card"><header class="card-head"><h3>Rates & targets</h3></header><div class="form grid3">
    ${f('defaultRate', 'Default rate (£/h)', { type: 'number', attrs: 'step="0.01" min="0" inputmode="decimal"' })}${f('defaultDuration', 'Default length (mins)', { type: 'number', attrs: 'step="5" min="5"' })}${f('monthlyTarget', 'Monthly income target (£)', { type: 'number', attrs: 'step="50" min="0"' })}
    ${f('guidewellEmail', 'Guidewell invoice email', { type: 'email' })}${f('lubaEmail', 'Luba Jones email', { type: 'email' })}</div></section>
  <section class="card" id="guidewell-invoice-settings"><header class="card-head"><h3>Guidewell invoice</h3><small class="muted">Private – syncs only to your own MentorFlow cloud</small></header><div class="form">
    <div class="grid3">${f('guidewellRate', 'Private lesson rate (£/h)', { type: 'number', attrs: 'step="0.01" min="0" inputmode="decimal"', hint: 'Used unless the student or session has its own rate' })}${f('adminRate', 'Admin rate (£/h)', { type: 'number', attrs: 'step="0.01" min="0" inputmode="decimal"' })}${f('lessonAdminMins', 'Lesson admin per lesson (mins)', { type: 'number', attrs: 'step="1" min="0"' })}</div>
    ${f('guidewellBillTo', 'Invoice to (Guidewell billing details)', { type: 'textarea', rows: 3, attrs: 'placeholder="Company name\nCompany no.: …"', hint: 'One line each, exactly as it should appear under “Invoice to:”' })}
    ${f('invoiceFooter', 'Invoice footer / payment details', { type: 'textarea', rows: 6, attrs: 'data-testid="setting-invoice-footer"', hint: 'Free text at the bottom of the invoice. Replace “[your bank details here]” with your account name, account number and sort code (one per line, e.g. “Sort code: 12-34-56” – the part after the colon is shown in bold).' })}
    <div class="btn-row"><button class="btn" data-action="guidewell-invoice">${icon('file')} Open Guidewell invoice</button></div></div></section>
  <section class="card" id="payment-email-settings"><header class="card-head"><h3>Payment request email</h3><small class="muted">For Direct (parent) students</small></header><div class="form">
    ${f('paymentEmailSubject', 'Subject', {})}
    ${f('paymentEmailTemplate', 'Email template', { type: 'textarea', rows: 14, attrs: 'data-testid="setting-payment-template"', hint: 'Placeholders: {ParentFirstName} {amount} {StudentFirstName} {hours} {Subject} {Month} {Year}. “{hours} hours” becomes “1 hour” automatically. Replace “[your bank details here]” with your bank details once.' })}
    <div class="btn-row"><button class="btn small ghost" data-action="reset-payment-template">Reset to the original template</button></div></div></section>
  <section class="card"><header class="card-head"><h3>Appearance</h3></header>
    <div class="seg" role="radiogroup">${[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<label><input type="radio" name="theme" value="${k}" data-setting ${S.theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></section>
  <section class="card" id="data"><header class="card-head"><h3>Data & backup</h3><small class="muted">${counts}</small></header>
    <p class="muted small">${icon('info')} ${syncState.mode === 'cloudflare' ? 'Your data lives on this device and syncs to your private MentorFlow cloud (see Sync below)' : 'Your data lives only on this device'}${isPersistentStorage() ? '' : ' <b class="overdue">(temporary storage – private browsing?)</b>'}. <b>Back up now</b> opens the share sheet on iPad – choose <b>Save to Files</b> → iCloud Drive. To restore, pick that file with <b>Restore from backup</b>.${S.lastBackupAt ? ` Last backup: ${esc(new Date(S.lastBackupAt).toLocaleString('en-GB'))}.` : ' <b>No backup yet.</b>'}</p>
    <div class="btn-grid">
      <button class="btn primary" data-action="backup-export">${icon('download')} Back up now</button>
      <label class="btn">${icon('upload')} Restore from backup<input type="file" accept="application/json,.json" data-change="backup-import" hidden></label>
      <button class="btn" data-action="export-all-csv">${icon('file')} All sessions CSV</button>
      ${hasSampleData() ? `<button class="btn" data-action="clear-sample">${icon('close')} Clear sample data</button>` : `<button class="btn" data-action="sample-data">${icon('sparkle')} Load sample data</button>`}
      <button class="btn danger" data-action="erase-all">${icon('trash')} Erase all data</button>
    </div></section>
  <section class="card" id="calendar"><header class="card-head"><h3>Calendar</h3><button class="link-btn" data-action="calendar-help">${icon('info')} How it works</button></header>
    <label class="check"><input type="checkbox" name="calendarAlarm" data-setting ${S.calendarAlarm ? 'checked' : ''} data-testid="calendar-alarm"> Add a 30-minute reminder to exported lessons</label>
    <p class="muted small">Off by default – TimeTree already reminds you. ${S.lastCalendarExportAt ? `Last added to Calendar: ${esc(new Date(S.lastCalendarExportAt).toLocaleString('en-GB'))}.` : 'Nothing added to Calendar yet.'}</p>
    <div class="btn-row"><button class="btn" data-action="calendar-export-upcoming" data-testid="calendar-export-upcoming">${icon('calCheck')} Export all upcoming lessons to Calendar</button></div></section>
  <section class="card" id="sync"><header class="card-head"><h3>Sync</h3></header>
    <label class="field"><span>Sync provider</span><select name="syncProvider" data-setting>${Object.entries(PROVIDERS).map(([k, P]) => { const p = new P(); const sel = k === (S.syncProvider === 'notion' ? 'notion' : S.syncProvider === 'off' || !syncState.serverPresent ? 'off' : 'cloudflare'); const ok = k === 'cloudflare' ? !!syncState.serverPresent : p.available; return `<option value="${k}" ${sel ? 'selected' : ''} ${ok ? '' : 'disabled'}>${esc(p.label)}</option>`; }).join('')}</select></label>
    ${syncStatusHtml()}</section>
  <section class="card"><header class="card-head"><h3>Install on iPad</h3></header>
    <p class="small">${standalone ? '✅ Running as an installed app.' : 'Open this page in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>. MentorFlow then opens full-screen and works offline.'}</p>
    <p class="small muted">On Windows, use Edge or Chrome → ⋯ → <b>Apps → Install this site as an app</b>.</p></section>
  <section class="card"><header class="card-head"><h3>Keyboard shortcuts</h3></header><dl class="dl kbd-list">${SHORTCUTS.map(([k, d]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(d)}</dd>`).join('')}</dl></section>
  <p class="muted small center">MentorFlow ${APP_VERSION} · data schema v${SCHEMA_VERSION} · offline-first PWA</p>
  </div>` };
}
