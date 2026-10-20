// End-to-end tests against the built site served from a subpath (mimics GitHub Pages /mentorflow/).
// Usage: node tests/e2e.mjs [chromium|webkit|all]   (expects http://localhost:8080/mentorflow/ to serve dist/)
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:8080/mentorflow/';
const which = process.argv[2] || 'all';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname; mkdirSync(SHOTS, { recursive: true });
const results = [];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('  ✓', name); }
  catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]); console.log('  ✗', name, '—', e.message.split('\n')[0]);
    if (process.env.DEBUG_FAIL && globalThis.__page) { try { const f = `${SHOTS}FAIL-${name.replace(/\W+/g, '_')}.png`; await globalThis.__page.screenshot({ path: f }); console.log('    debug:', f, await globalThis.__page.evaluate(() => JSON.stringify({ hash: location.hash, sheets: document.querySelectorAll('.sheet').length, n: window.__mentorflow?.state.sessions.length, active: document.activeElement?.outerHTML.slice(0, 80) }))); } catch {} }
  }
}

async function functional(type, launcher) {
  console.log(`\n[${type}] functional`);
  const browser = await launcher.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1180, height: 820 }, locale: 'en-GB', timezoneId: 'Europe/London' });
  const page = await ctx.newPage(); globalThis.__page = page;
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const today = new Date(); const T = ymd(today); const month = T.slice(0, 7);
  const sheet = page.locator('.sheet');

  await step('app loads from subpath with welcome screen', async () => {
    await page.goto(BASE); await page.waitForSelector('text=Welcome to MentorFlow');
    const man = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    assert.equal(man.scope, './'); assert.equal(man.start_url, './#/today');
  });
  await step('add a student (direct billing)', async () => {
    await page.click('text=Add your first student');
    await sheet.locator('input[name=name]').fill('Test Student One');
    await sheet.locator('input[name=subject]').fill('Maths');
    await sheet.locator('label.seg-opt:has(input[value=direct])').click();
    await sheet.locator('input[name=rate]').fill('40');
    await sheet.locator('input[name=parentEmail]').fill('parent@example.com');
    await sheet.locator('button[type=submit]').click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.goto(BASE + '#/students'); await page.waitForSelector('text=Test Student One');
  });
  await step('log a completed session today', async () => {
    await page.goto(BASE + '#/today'); await page.click('.today-head button:has-text("Log session")');
    await sheet.locator('select[name=studentId]').selectOption({ label: 'Test Student One · Maths' });
    await sheet.locator('input[name=start]').fill('09:00');
    await sheet.locator('label:has(input[name=status][value=completed])').click();
    await sheet.locator('button[type=submit]').click();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForSelector('.session.completed');
  });
  // Quick import: one past day (completed) + one future day (scheduled), plus a junk line.
  const past = new Date(today); past.setDate(today.getDate() === 1 ? 1 : today.getDate() - 1);
  const future = new Date(today.getFullYear(), today.getMonth() + 1, 0); // last day of month
  const sameDay = past.getDate() === today.getDate();
  await step('quick import parses, matches and imports', async () => {
    await page.goto(BASE + '#/sessions'); await page.click('#view-actions button:has-text("Quick Import")');
    const txt = `${past.getDate()} ${MONTHS[past.getMonth()]}\n${sameDay ? '07:00 - 08:00' : '16:00 - 17:00'} Test Student One\n${future.getDate()} ${MONTHS[future.getMonth()]} 4pm-5pm Test Student One\nhello world`;
    await sheet.locator('#qi-text').fill(txt);
    await sheet.locator('button:has-text("Preview")').click();
    await sheet.locator('.qi-summary').waitFor();
    assert.match(await sheet.locator('.qi-summary').innerText(), /2 events found · 2 matched/);
    const btn = sheet.locator('button:has-text("Import 2 sessions")');
    await btn.click(); await page.waitForSelector('.sheet', { state: 'detached' });
    const n = await page.evaluate(() => window.__mentorflow.state.sessions.length); assert.equal(n, 3);
  });
  await step('calendar shows sessions & TimeTree tip', async () => {
    await page.goto(BASE + '#/sessions'); await page.waitForSelector('.cal-grid');
    assert.ok(await page.locator('.cal-cell.has').count() >= 1);
    await page.click('.banner.tip button:has-text("How it works")'); await sheet.locator('text=TimeTree label tip').waitFor(); await page.keyboard.press('Escape');
  });
  await step('Money totals: actual £80, forecast £120', async () => {
    await page.goto(BASE + '#/money');
    // today (completed) + imported past day (completed) = 2 × £40; forecast adds the scheduled one at month end
    // (on the last day of a month the "future" session is today, so it is excluded from these assumptions)
    assert.equal(await page.locator('[data-testid=money-actual]').innerText(), '£80.00');
    if (ymd(future) > T) assert.equal(await page.locator('[data-testid=money-forecast]').innerText(), '£120.00');
    await page.waitForSelector('.ck-parent:has-text("Test Student One")');
  });
  await step('export sessions CSV', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#view-actions button:has-text("Sessions CSV")')]);
    assert.equal(dl.suggestedFilename(), `mentorflow-sessions-${month}.csv`);
    const csv = readFileSync(await dl.path(), 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    assert.match(lines[0], /^Date,Start,End,Duration/); assert.equal(lines.length, 4);
    assert.ok(csv.includes('Test Student One') && csv.includes('40.00'));
  });
  await step('direct parent email: mailto + clipboard text with bank details', async () => {
    const href = await page.locator('.ck-parent a:has-text("Email")').getAttribute('href');
    assert.ok(href.startsWith('mailto:parent%40example.com?subject='));
    assert.ok(decodeURIComponent(href).includes('Sort code'));
    const text = await page.evaluate(async (m) => { const mod = await import('./js/export.js'); const s = window.__mentorflow.state.students[0]; return mod.parentEmail(m, s.id).body; }, month);
    assert.match(text, /Total: £80\.00/);
  });
  await step('Guidewell PDF invoice generates (jsPDF, vendored)', async () => {
    await page.evaluate(async (T) => { const st = await import('./js/store.js'); const s = st.saveStudent({ name: 'Agency Pupil', invoiceMethod: 'guidewell', rate: 30, active: true }); st.saveSession({ studentId: s.id, date: T, start: '12:00', duration: 90, status: 'completed' }); }, T);
    await page.goto(BASE + '#/money');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action=guidewell-pdf]')]);
    const buf = readFileSync(await dl.path());
    assert.equal(buf.subarray(0, 4).toString(), '%PDF'); assert.ok(buf.length > 2000, 'pdf size ' + buf.length);
    assert.match(dl.suggestedFilename(), /^guidewell-invoice-\d{4}-\d{2}-MF-0001\.pdf$/);
  });
  await step('Luba Jones hours CSV downloads', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action=luba-csv]')]);
    assert.match(readFileSync(await dl.path(), 'utf8'), /Student,Date,Start,End,Hours/);
  });
  await step('tasks: add homework, kanban move', async () => {
    await page.goto(BASE + '#/tasks'); await page.click('button[data-board=homework]');
    await page.click('#view-actions button[data-action=new-task]');
    await sheet.locator('input[name=title]').fill('Fractions sheet');
    await sheet.locator('select[name=studentId]').selectOption({ label: 'Test Student One' });
    await sheet.locator('button[type=submit]').click(); await page.waitForSelector('.sheet', { state: 'detached' });
    await page.click('.k-card:has-text("Fractions sheet") [data-action=move-task]');
    await page.waitForSelector('section[data-drop=doing] .k-card:has-text("Fractions sheet")');
  });
  await step('expenses: add expense, Money net updates', async () => {
    await page.goto(BASE + '#/expenses'); await page.click('#view-actions button[data-action=new-expense]');
    await sheet.locator('input[name=amount]').fill('12.50'); await sheet.locator('input[name=description]').fill('Workbook');
    await sheet.locator('button[type=submit]').click(); await page.waitForSelector('.sheet', { state: 'detached' });
    await page.goto(BASE + '#/money'); assert.equal(await page.locator('[data-testid=money-expenses]').innerText(), '£12.50');
  });
  await step('global search (Ctrl+K) finds student', async () => {
    await page.goto(BASE + '#/today'); await page.locator('body').click({ position: { x: 600, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+k'); await page.locator('#gs-input').fill('fractions');
    await page.waitForSelector('.gs-item:has-text("Fractions sheet")'); await page.keyboard.press('Escape');
  });
  await step('keyboard shortcut "3" opens Sessions', async () => {
    await page.locator('#view-title').click(); await page.keyboard.press('3'); await page.waitForFunction(() => location.hash === '#/sessions');
  });
  await step('reload: data persists in IndexedDB', async () => {
    await page.reload(); await page.goto(BASE + '#/students'); await page.waitForSelector('text=Test Student One');
    const c = await page.evaluate(() => { const s = window.__mentorflow.state; return [s.students.length, s.sessions.length, s.tasks.length, s.expenses.length]; });
    assert.deepEqual(c, [2, 4, 1, 1]);
  });
  await step('backup reminder shows when overdue and can be dismissed', async () => {
    await page.evaluate(async () => { const st = await import('./js/store.js'); st.saveSettings({ lastBackupAt: new Date(Date.now() - 40 * 864e5).toISOString(), backupReminderDismissedAt: null }); });
    await page.goto(BASE + '#/today'); await page.waitForSelector('[data-testid=backup-reminder]');
    await page.click('[data-action=dismiss-backup-reminder]'); await page.waitForSelector('[data-testid=backup-reminder]', { state: 'detached' });
  });
  let backupPath;
  await step('Back up now → JSON backup (download fallback)', async () => {
    await page.goto(BASE + '#/more');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action=backup-export]')]);
    backupPath = await dl.path(); const data = JSON.parse(readFileSync(backupPath, 'utf8'));
    assert.equal(data.app, 'MentorFlow'); assert.equal(data.sessions.length, 4);
    writeFileSync('/tmp/mf-backup.json', JSON.stringify(data));
  });
  await step('erase all, then restore from backup file (with confirmation)', async () => {
    await page.click('button[data-action=erase-all]'); await sheet.locator('button:has-text("Erase everything")').click();
    await page.waitForSelector('text=Welcome to MentorFlow');
    await page.goto(BASE + '#/more');
    await page.setInputFiles('input[data-change=backup-import]', '/tmp/mf-backup.json');
    await sheet.locator('text=Restore from backup?').waitFor();
    await sheet.locator('button:has-text("Replace my data")').click();
    await page.waitForFunction(() => window.__mentorflow.state.sessions.length === 4);
  });
  await step('sample data loads (fictional) and clears', async () => {
    await page.goto(BASE + '#/more'); await page.click('button[data-action=sample-data]');
    await page.waitForFunction(() => window.__mentorflow.state.students.length === 7);
    const names = await page.evaluate(() => window.__mentorflow.state.students.filter(s => s.sample).map(s => s.name).join());
    assert.match(names, /Sample Student A/);
    await page.goto(BASE + '#/more'); await page.click('button[data-action=clear-sample]'); await sheet.locator('button:has-text("Clear sample data")').click();
    await page.waitForFunction(() => window.__mentorflow.state.students.length === 2 && window.__mentorflow.state.sessions.length === 4);
  });
  if (type === 'chromium') await step('service worker installs and app works offline', async () => {
    await page.goto(BASE); await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.today-head');
    await page.goto(BASE + '#/money'); await page.waitForSelector('[data-testid=money-actual]');
    await ctx.setOffline(false);
  });
  await step('no uncaught page errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
}

async function screenshots(type, launcher) {
  console.log(`\n[${type}] screenshots`);
  const browser = await launcher.launch();
  const devices = [['ipad', { width: 1024, height: 1366 }, true], ['iphone', { width: 390, height: 844 }, true]];
  for (const [dev, viewport, touch] of devices) for (const scheme of ['light', 'dark']) {
    await step(`${dev} ${scheme} screenshots`, async () => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: touch, isMobile: type === 'chromium' && dev === 'iphone', locale: 'en-GB', timezoneId: 'Europe/London' });
      const page = await ctx.newPage(); await page.goto(BASE); await page.waitForSelector('text=Welcome to MentorFlow');
      await page.screenshot({ path: `${SHOTS}${type}-${dev}-${scheme}-0-welcome.png` });
      await page.click('[data-action=sample-data]'); await page.waitForFunction(() => window.__mentorflow.state.sessions.length > 10);
      const views = [['1-today', '#/today'], ['2-students', '#/students/' + await page.evaluate(() => window.__mentorflow.state.students.find(s => s.name === 'Sample Student A').id)], ['3-sessions', '#/sessions'], ['4-tasks', '#/tasks'], ['5-money', '#/money'], ['6-expenses', '#/expenses'], ['7-more', '#/more']];
      for (const [n, h] of views) { await page.goto(BASE + h); await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}${type}-${dev}-${scheme}-${n}.png`, fullPage: n === '5-money' }); }
      await page.goto(BASE + '#/sessions'); await page.click('#view-actions [data-action=quick-import]');
      await page.locator('#qi-text').fill('Mon 5 Oct\n16:00 - 17:00 Student A\n18:00-19:30 Student C\nTue 6 Oct 4:30pm-5:30pm Student D\n7 Oct 10am Mystery person'); await page.click('.sheet button:has-text("Preview")'); await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}${type}-${dev}-${scheme}-8-quick-import.png` });
      // Layout assertion: phone uses bottom tab bar, iPad uses sidebar.
      const tabbar = await page.locator('.tabbar').isVisible(); const sidebar = await page.locator('.sidebar').isVisible();
      assert.equal(tabbar, dev === 'iphone'); assert.equal(sidebar, dev === 'ipad');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(overflow <= 1, 'horizontal overflow ' + overflow);
      await ctx.close();
    });
  }
  await browser.close();
}

const engines = { chromium, webkit };
for (const [name, l] of Object.entries(engines)) {
  if (which !== 'all' && which !== name) continue;
  await functional(name, l);
  await screenshots(name, l);
}
const fails = results.filter(r => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
writeFileSync(new URL('../test-results.txt', import.meta.url), results.map(r => r.join(' | ')).join('\n') + '\n');
process.exit(fails.length ? 1 : 0);
