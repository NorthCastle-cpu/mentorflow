// E2E: Guidewell invoice sheet → PDF (first page screenshot) + .docx, Direct payment request email preview,
// session length stepper. Fictional data only (tests/fixtures/september-2026.mjs).
// Usage: node tests/invoice-e2e.mjs [chromium|webkit|all]   (expects http://localhost:8080/mentorflow/ to serve dist/)
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as F from './fixtures/september-2026.mjs';
const BASE = process.env.BASE_URL || 'http://localhost:8080/mentorflow/';
const which = process.argv[2] || 'all';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname; mkdirSync(SHOTS, { recursive: true });
const results = []; const shots = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('  ✓', name); }
  catch (e) { results.push(['FAIL', name]); console.log('  ✗', name, '—', e.message.split('\n').slice(0, 6).join(' | ')); }
}
const BANK = 'SAMPLE TUTOR\n00-00-00\n00000000';

async function run(type, launcher) {
  console.log(`\n[${type}] invoice + payment request`);
  const browser = await launcher.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2, locale: 'en-GB', timezoneId: 'Europe/London' });
  if (type === 'webkit') await ctx.route('**/sw.js', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const sheet = page.locator('.sheet');
  await page.goto(BASE); await page.waitForSelector('text=Welcome to MentorFlow');
  await page.evaluate(async ({ F, BANK }) => {
    const st = await import('./js/store.js'); const { setUi } = await import('./js/uistate.js'); const { DEFAULT_PAYMENT_TEMPLATE, BANK_PLACEHOLDER } = await import('./js/payreq.js');
    for (const s of F.students) st.saveStudent(s);
    st.addSessionsBulk(F.sessions);
    st.saveSettings({ ...F.settings, onboarded: true, paymentEmailTemplate: DEFAULT_PAYMENT_TEMPLATE.replace(BANK_PLACEHOLDER, BANK) });
    st.saveInvoiceRecord(F.MONTH, { lines: F.record.lines }); // number/date are left to the suggestion (#67, 1st October)
    setUi({ moneyMonth: F.MONTH });
  }, { F: { students: F.students, sessions: F.sessions, settings: F.settings, record: F.record, MONTH: F.MONTH }, BANK });

  await step('Money → Guidewell invoice sheet: month, suggested #67, extra lines, preview totals', async () => {
    await page.goto(BASE + '#/money'); await page.waitForSelector('text=Month-end checklist · September 2026');
    await page.click('[data-testid=guidewell-invoice]'); await sheet.locator('[data-testid=invoice-sheet]').waitFor();
    assert.equal(await sheet.locator('[data-testid=invoice-month]').inputValue(), '2026-09');
    assert.equal(await sheet.locator('[data-testid=invoice-number]').inputValue(), '67');
    assert.equal(await sheet.locator('[data-testid=invoice-date]').inputValue(), '2026-10-01');
    assert.equal(await sheet.locator('.inv-line').count(), 4);
    assert.equal(await sheet.locator('[data-testid=invoice-grand]').innerText(), 'Total £5,757.92');
    // edit a line → preview updates, then put it back
    const qty = sheet.locator('.inv-line').nth(3).locator('[data-f=qty]');
    await qty.fill('1'); await qty.dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('[data-testid=invoice-grand]').textContent === 'Total £5,767.92');
    await qty.fill('0.5'); await qty.dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('[data-testid=invoice-grand]').textContent === 'Total £5,757.92');
    const f = `${SHOTS}${type}-guidewell-invoice-sheet.png`; await sheet.screenshot({ path: f }); shots.push(f);
    const f2 = `${SHOTS}${type}-guidewell-invoice-preview.png`; await sheet.locator('[data-testid=invoice-preview]').screenshot({ path: f2 }); shots.push(f2);
  });
  await step('Create PDF: downloads on desktop, stores the issued number; first page screenshot', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.locator('[data-testid=invoice-pdf]').click()]);
    assert.equal(dl.suggestedFilename().replace(/_/g, ' '), 'Invoice 67 - September 2026.pdf'); // WebKit shows spaces as _
    const pdf = `${SHOTS}${type}-guidewell-invoice.pdf`; copyFileSync(await dl.path(), pdf);
    const txt = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
    for (const s of ['Invoice #: 67', 'Invoice date: 1st October 2026', 'Private Lessons:', 'Schools Courses:', 'Lesson admin', '£5118.75', '£482.50', '£156.67', '£5,757.92', 'Sort code: 00-00-00']) assert.ok(txt.includes(s), s);
    execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, `${SHOTS}${type}-guidewell-invoice-pdf-page1`]);
    shots.push(`${SHOTS}${type}-guidewell-invoice-pdf-page1.png`);
    await page.waitForFunction((m) => window.__mentorflow.state.invoices[m]?.number === 67 && !!window.__mentorflow.state.invoices[m]?.issuedAt, F.MONTH);
    // next month now suggests #68
    await sheet.locator('[data-testid=invoice-month]').fill('2026-10'); await sheet.locator('[data-testid=invoice-month]').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('[data-testid=invoice-number]').value === '68');
    await sheet.locator('[data-testid=invoice-month]').fill('2026-09'); await sheet.locator('[data-testid=invoice-month]').dispatchEvent('change');
  });
  await step('Editable copy (.docx) downloads and is a valid Word document', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.locator('[data-testid=invoice-docx]').click()]);
    assert.equal(dl.suggestedFilename().replace(/_/g, ' '), 'Invoice 67 - September 2026.docx');
    const file = `${SHOTS}${type}-guidewell-invoice.docx`; copyFileSync(await dl.path(), file);
    const out = execFileSync('python3', ['-c', "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read('word/document.xml').decode())", file]).toString();
    assert.ok(out.includes('£5,757.92') && out.includes('Lesson admin'));
    await page.keyboard.press('Escape'); await page.waitForSelector('.sheet', { state: 'detached' });
  });
  await step('Direct students listed with Request payment; preview + mailto use the exact template', async () => {
    const row = page.locator('[data-testid=direct-d1]'); await row.waitFor();
    assert.match(await row.innerText(), /4 lessons · 3\.75h · £562\.5/);
    await row.locator('button[data-action=payment-request]').click(); await sheet.locator('[data-testid=payreq-sheet]').waitFor();
    const expected = `Hi Carol,\n\nI’m just reaching out to request payment of £562.50 for Allegra’s 3.75 hours of Essay Coaching in September, at your earliest convenience. \n\nMy bank details are:\n${BANK}\n\nPlease let me know if you have any questions, thanks. \n\nKindest regards,\nSarah`;
    assert.equal(await sheet.locator('[data-testid=payreq-body]').inputValue(), expected);
    assert.equal(await sheet.locator('[data-testid=payreq-preview] pre').innerText(), expected);
    const href = await sheet.locator('[data-testid=payreq-mail]').getAttribute('href');
    assert.ok(href.startsWith('mailto:carol@example.com?subject=')); assert.equal(decodeURIComponent(href.split('&body=')[1]), expected);
    await page.addStyleTag({ content: '#toast-root{display:none!important}' });
    const f = `${SHOTS}${type}-payment-request-email-preview.png`; await sheet.screenshot({ path: f }); shots.push(f);
    // editing before opening Mail updates the draft
    await sheet.locator('[data-testid=payreq-body]').fill(expected.replace('Kindest regards', 'Many thanks'));
    assert.ok(decodeURIComponent((await sheet.locator('[data-testid=payreq-mail]').getAttribute('href')).split('&body=')[1]).includes('Many thanks'));
    await page.keyboard.press('Escape'); await page.waitForSelector('.sheet', { state: 'detached' });
  });
  await step('Session length steps in 5 minutes; Topic/subject and Don’t bill fields', async () => {
    await page.click('#view-actions button[data-action=guidewell-invoice]'); await sheet.locator('[data-testid=invoice-sheet]').waitFor(); await page.keyboard.press('Escape'); await page.waitForSelector('.sheet', { state: 'detached' });
    await page.goto(BASE + '#/today'); await page.click('.today-head button:has-text("Log session")');
    await sheet.locator('select[name=studentId]').selectOption({ label: 'Ada Fictional · Essay Coaching' });
    const dur = sheet.locator('[data-testid=session-duration]'); await dur.fill('60');
    await sheet.locator('[data-x="dur+"]').click(); await sheet.locator('[data-x="dur+"]').click(); await sheet.locator('[data-x="dur-"]').click();
    assert.equal(await dur.inputValue(), '65');
    await dur.fill('52'); await dur.dispatchEvent('change'); assert.equal(await dur.inputValue(), '50');
    assert.match(await sheet.locator('[data-x=value]').innerText(), /billed as 0\.75 h/);
    await sheet.locator('[data-testid=session-subject]').fill('Personal statement');
    await sheet.locator('[data-testid=session-nobill]').check();
    await sheet.locator('button[type=submit]').click(); await page.waitForSelector('.sheet', { state: 'detached' });
    const s = await page.evaluate(() => window.__mentorflow.state.sessions.find(x => x.subject === 'Personal statement'));
    assert.equal(s.duration, 50); assert.equal(s.noBill, true);
  });
  await step('Settings: no bank-details card; invoice footer + payment template are editable', async () => {
    await page.goto(BASE + '#/more'); await page.waitForSelector('#guidewell-invoice-settings');
    assert.equal(await page.locator('input[name=bankAccountName], input[name=bankSortCode], input[name=bankAccountNumber]').count(), 0);
    assert.equal(await page.locator('h3:text-is("Bank details")').count(), 0);
    assert.ok((await page.locator('[data-testid=setting-payment-template]').inputValue()).includes(BANK));
    const f = `${SHOTS}${type}-settings-invoice-and-email.png`; await page.locator('#guidewell-invoice-settings').screenshot({ path: f }); shots.push(f);
  });
  await step('no uncaught page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
}

if (which === 'chromium' || which === 'all') await run('chromium', chromium);
if (which === 'webkit' || which === 'all') await run('webkit', webkit);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`); console.log('Screenshots:\n' + shots.map(s => '  ' + s).join('\n'));
process.exit(failed ? 1 : 0);
