// Sheets for the Guidewell invoice (month picker, number/date, extra lines editor, preview, PDF/.docx)
// and the Direct-parent payment request email (preview, edit, Open in Mail, Copy).
import { state, saveInvoiceRecord, saveStudent, setChecklist, subscribe } from './store.js';
import { openSheet, closeSheet, sheetHeader, toast, icon } from './ui.js';
import { esc, copyText, uid, ym } from './util.js';
import { guidewellInvoice, guidewellPdf, guidewellDocx, paymentRequestFor, mailtoUrl } from './export.js';
import { invoiceMissingSettings, defaultInvoiceDate } from './invoice.js';
import { fmtQty, gbp2, gbpShort, gbpGrand, firstName } from './billing.js';
import { BANK_PLACEHOLDER } from './payreq.js';

const rowHtml = (cells, cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td class="${i >= 2 ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`;
function previewHtml(inv) {
  const secs = inv.sections.map(sec => `<h4 class="sub">${esc(sec.title)}</h4><div class="table-wrap"><table class="tbl inv-tbl"><thead><tr><th>Date(s)</th><th>Description</th><th class="r">Rate</th><th class="r">Hours</th><th class="r">Sub-total</th><th class="r">Travel</th><th class="r">Total</th></tr></thead><tbody>
    ${sec.rows.length ? sec.rows.map(r => rowHtml([r.dates, r.description, gbpShort(r.rate), r.hoursLabel || fmtQty(r.hours), gbp2(r.subtotal), gbpShort(r.travel), gbp2(r.total)])).join('') : '<tr><td colspan="7" class="muted">No Guidewell lessons this month</td></tr>'}
    ${rowHtml(['', 'TOTAL', '', fmtQty(sec.hours), gbp2(sec.subtotal), gbp2(sec.travel), gbp2(sec.total)], 'tot')}</tbody></table></div>`).join('');
  return `${secs}<div class="inv-grand"><span>${inv.totals.map(t => `${esc(t.type)} ${gbp2(t.total)}`).join(' · ')}</span><b data-testid="invoice-grand">Total ${gbpGrand(inv.grand)}</b></div>`;
}

const lineRow = (l) => `<div class="inv-line" data-id="${esc(l.id)}">
  <select data-f="section" aria-label="Section"><option value="admin" ${l.section !== 'schools' ? 'selected' : ''}>Admin</option><option value="schools" ${l.section === 'schools' ? 'selected' : ''}>Schools Courses</option></select>
  <input type="date" data-f="date" value="${esc(l.date || '')}" aria-label="Date (optional)">
  <input data-f="description" value="${esc(l.description || '')}" placeholder="Description" aria-label="Description">
  <input type="number" data-f="qty" value="${esc(l.qty ?? '')}" step="0.25" min="0" inputmode="decimal" placeholder="Hours / count" aria-label="Hours or count">
  <input type="number" data-f="rate" value="${esc(l.rate ?? '')}" step="0.01" min="0" inputmode="decimal" placeholder="£ rate" aria-label="Rate">
  <button type="button" class="icon-btn" data-x="del-line" aria-label="Remove line">${icon('trash')}</button></div>`;

export function guidewellInvoiceSheet(startMonth = ym(new Date())) {
  let month = startMonth;
  const sheet = openSheet(`${sheetHeader('Guidewell invoice')}<div class="sheet-body form inv-sheet" data-testid="invoice-sheet"></div>
    <footer class="sheet-foot"><button class="btn" data-x="docx" data-testid="invoice-docx">${icon('edit')} Editable copy (.docx)</button><span class="grow"></span><button class="btn primary" data-x="pdf" data-testid="invoice-pdf">${icon('file')} Create PDF</button></footer>`, { wide: true, onClose: () => unsub() });
  const body = sheet.querySelector('.sheet-body');
  const rec = () => state.invoices[month] || {};
  const draw = () => {
    const inv = guidewellInvoice(month); const r = rec(); const miss = invoiceMissingSettings(state.settings);
    body.innerHTML = `
      ${miss.length ? `<div class="banner warn">${icon('alert')}<div><b>Fill in your invoice details in More → Guidewell invoice</b><small>Missing: ${esc(miss.join(', '))}</small></div><a class="btn small" href="#/more" data-x="go-more">Open</a></div>` : ''}
      <div class="row3"><label class="field"><span>Month</span><input type="month" data-x="month" value="${month}" data-testid="invoice-month"></label>
      <label class="field"><span>Invoice number</span><input type="number" min="1" step="1" data-x="number" value="${esc(inv.number)}" data-testid="invoice-number"><small class="muted">${r.number ? (r.issuedAt ? 'Issued' : 'Saved') : `Suggested (last + 1)`}</small></label>
      <label class="field"><span>Invoice date</span><input type="date" data-x="date" value="${esc(inv.date)}" data-testid="invoice-date"><small class="muted">${esc(inv.dateLabel)}</small></label></div>
      <div class="row2"><label class="field"><span>Lessons for “Lesson admin” (× ${esc(state.settings.lessonAdminMins ?? 5)} min)</span><input type="number" min="0" step="1" data-x="lessons" value="${esc(r.lessonCount ?? '')}" placeholder="${inv.autoLessonCount} (from your sessions)"></label>
      <div class="field"><span>Defaults</span><small class="muted">Private lessons £${esc(state.settings.guidewellRate ?? 75)}/h unless the student or session has its own rate · admin £${esc(state.settings.adminRate ?? 20)}/h · sessions round to the nearest 15 min · mark a student as a <b>school course</b> to list it under Schools Courses · tick <b>Don’t bill</b> on a session to leave it out.</small></div></div>
      <section class="inv-lines"><h4 class="sub">Extra lines this month</h4><p class="muted small">Admin (calls, training, emails) and Schools Courses admin time. Hours or count × rate. Leave the date empty for “-”.</p>
        <div data-x="lines">${(r.lines || []).map(lineRow).join('') || '<p class="muted small">No extra lines yet.</p>'}</div>
        <div class="btn-row"><button type="button" class="btn small" data-x="add-admin">${icon('plus')} Admin line</button><button type="button" class="btn small" data-x="add-schools">${icon('plus')} Schools Courses admin time</button></div></section>
      <section class="inv-preview" data-testid="invoice-preview"></section>`;
    drawPreview();
  };
  const drawPreview = () => {
    const inv = guidewellInvoice(month);
    body.querySelector('.inv-preview').innerHTML = `<h4 class="sub">Preview · Invoice #${esc(inv.number)} · ${esc(inv.monthLabel)}</h4>${previewHtml(inv)}`;
    const ds = body.querySelector('[data-x=date] + small'); if (ds) ds.textContent = inv.dateLabel;
  };
  let busy = false;
  const unsub = subscribe(() => { if (busy) return; if (!body.contains(document.activeElement)) draw(); else drawPreview(); });
  draw();
  const save = (patch) => { busy = true; try { saveInvoiceRecord(month, patch); } finally { busy = false; } };
  const saveLines = (fn) => { const lines = (rec().lines || []).map(l => ({ ...l })); fn(lines); save({ lines }); };
  body.addEventListener('change', (e) => {
    const el = e.target; const x = el.dataset.x;
    if (x === 'month') { if (/^\d{4}-\d{2}$/.test(el.value)) { month = el.value; draw(); } return; }
    if (x === 'number') { save({ number: el.value === '' ? null : +el.value }); drawPreview(); return; }
    if (x === 'date') { save({ date: el.value || defaultInvoiceDate(month) }); drawPreview(); return; }
    if (x === 'lessons') { save({ lessonCount: el.value === '' ? null : +el.value }); drawPreview(); return; }
    const row = el.closest('.inv-line'); const f = el.dataset.f;
    if (row && f) { saveLines(lines => { const l = lines.find(y => y.id === row.dataset.id); if (l) l[f] = (f === 'qty' || f === 'rate') ? (el.value === '' ? null : +el.value) : el.value; }); drawPreview(); }
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return; const x = b.dataset.x;
    if (x === 'add-admin' || x === 'add-schools') { saveLines(lines => lines.push({ id: uid(), section: x === 'add-admin' ? 'admin' : 'schools', date: '', description: x === 'add-schools' ? 'Admin time' : '', qty: null, rate: +(state.settings.adminRate ?? 20) })); draw(); body.querySelector('.inv-line:last-child [data-f=description]')?.focus(); }
    if (x === 'del-line') { const id = b.closest('.inv-line').dataset.id; saveLines(lines => lines.splice(lines.findIndex(l => l.id === id), 1)); draw(); }
    if (x === 'go-more') closeSheet();
  });
  const run = async (btn, fn, what) => {
    btn.disabled = true;
    try { const r = await fn(month); setChecklist(month, 'gw-invoice', true); if (r.how !== 'cancelled') toast(`Invoice ${r.inv.number} ${what} ${r.how === 'shared' ? 'shared' : 'downloaded'}`, { type: 'ok' }); draw(); }
    catch (e) { console.error(e); toast('Could not create the invoice: ' + e.message, { type: 'warn', ms: 4500 }); }
    finally { btn.disabled = false; }
  };
  sheet.querySelector('[data-x=pdf]').addEventListener('click', (e) => run(e.currentTarget, guidewellPdf, 'PDF'));
  sheet.querySelector('[data-x=docx]').addEventListener('click', (e) => run(e.currentTarget, guidewellDocx, '.docx'));
  return sheet;
}

// ---------- Direct parent payment request ----------
export function paymentRequestSheet(month, studentId) {
  const st = state.students.find(s => s.id === studentId); if (!st) return;
  const req = paymentRequestFor(month, studentId);
  const sheet = openSheet(`${sheetHeader('Request payment')}<div class="sheet-body form" data-testid="payreq-sheet">
    <p class="muted small">${esc(st.name)} · ${req.count} lesson${req.count === 1 ? '' : 's'} · ${esc(req.values.hours)} h (each rounded to the nearest 15 min) · <b>£${esc(req.values.amount)}</b>. MentorFlow only prepares the email — you press Send in Mail.</p>
    ${req.missing.length ? `<div class="banner warn" data-testid="payreq-missing">${icon('alert')}<div><b>Please add the ${esc(req.missing.join(' and '))}</b><small>It is saved to ${esc(st.name)}’s details for next time.</small></div></div>` : ''}
    ${req.hasBankPlaceholder ? `<div class="banner warn">${icon('alert')}<div><b>Replace “${esc(BANK_PLACEHOLDER)}”</b><small>Put your bank details into the email template once in More → Payment request email.</small></div></div>` : ''}
    <div class="row2"><label class="field"><span>Parent first name</span><input name="parentFirst" value="${esc(req.values.ParentFirstName)}" ${req.values.ParentFirstName ? '' : 'autofocus'} required data-testid="payreq-parent"></label>
    <label class="field"><span>To (parent email)</span><input name="to" type="email" inputmode="email" value="${esc(req.to)}" required data-testid="payreq-to"></label></div>
    <label class="field"><span>Subject</span><input name="subject" value="${esc(req.subject)}" data-testid="payreq-subject"></label>
    <label class="field"><span>Email (edit before opening Mail)</span><textarea name="body" rows="14" data-testid="payreq-body">${esc(req.body)}</textarea></label>
    <div class="email-preview" data-testid="payreq-preview"><div class="ep-head"><span><b>To:</b> <span data-p="to"></span></span><span><b>Subject:</b> <span data-p="subject"></span></span></div><pre data-p="body"></pre></div>
  </div><footer class="sheet-foot"><button class="btn" data-x="copy" data-testid="payreq-copy">${icon('copy')} Copy email</button><span class="grow"></span><a class="btn primary" data-x="mail" data-testid="payreq-mail" href="#">${icon('mail')} Open in Mail</a></footer>`, { wide: true });
  const f = (n) => sheet.querySelector(`[name=${n}]`);
  let bodyEdited = false;
  const update = () => {
    const to = f('to').value.trim(); const subject = f('subject').value; const body = f('body').value;
    sheet.querySelector('[data-p=to]').textContent = to || '—'; sheet.querySelector('[data-p=subject]').textContent = subject; sheet.querySelector('[data-p=body]').textContent = body;
    const a = sheet.querySelector('[data-x=mail]'); a.href = mailtoUrl({ to, subject, body }); a.classList.toggle('disabled', !to);
  };
  f('body').addEventListener('input', () => { bodyEdited = true; update(); });
  f('subject').addEventListener('input', update); f('to').addEventListener('input', update);
  f('parentFirst').addEventListener('input', () => {
    if (bodyEdited) return update();
    const r = paymentRequestFor(month, studentId, { parentFirstName: f('parentFirst').value }); f('body').value = r.body; update();
  });
  const persist = () => {
    const first = f('parentFirst').value.trim(); const email = f('to').value.trim(); const cur = state.students.find(s => s.id === studentId); if (!cur) return;
    const patch = {};
    if (first && firstName(cur.parentName) !== first) patch.parentName = cur.parentName && cur.parentName.split(/\s+/).length > 1 ? [first, ...cur.parentName.trim().split(/\s+/).slice(1)].join(' ') : first;
    if (email && email !== cur.parentEmail) patch.parentEmail = email;
    if (Object.keys(patch).length) saveStudent({ ...cur, ...patch });
  };
  f('parentFirst').addEventListener('change', persist); f('to').addEventListener('change', persist);
  sheet.querySelector('[data-x=mail]').addEventListener('click', (e) => {
    if (!f('to').value.trim() || !f('parentFirst').value.trim()) { e.preventDefault(); toast('Please add the parent’s first name and email first', { type: 'warn' }); (f('parentFirst').value.trim() ? f('to') : f('parentFirst')).focus(); return; }
    persist(); setChecklist(month, 'dr-sent-' + studentId, true); // let the mailto: link open Mail
  });
  sheet.querySelector('[data-x=copy]').addEventListener('click', async () => {
    const ok = await copyText(`To: ${f('to').value.trim()}\nSubject: ${f('subject').value}\n\n${f('body').value}`);
    toast(ok ? 'Email copied' : 'Copy failed', { type: ok ? 'ok' : 'warn' });
  });
  update();
  return sheet;
}
