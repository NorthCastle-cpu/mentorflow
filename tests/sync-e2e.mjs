// Browser sync test: the real built app (dist/ at http://localhost:8080/mentorflow/) talking to the real Worker + D1
// (Miniflare). Playwright forwards /mentorflow/api/* to the Worker, adding a Cloudflare Access JWT for "signed in"
// devices, or answering like Access does (302 to the login page) for a signed-out / expired session.
// Usage: node tests/sync-e2e.mjs [chromium|webkit|all]
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { startWorker, jwt } from './helpers/worker-env.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/mentorflow/';
const which = process.argv[2] || 'all';
let pass = 0, fail = 0;
async function step(name, fn) { try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '—', e.message.split('\n')[0]); } }

async function run(type, launcher) {
  console.log(`\n[${type}] sync`);
  const w = await startWorker(); const token = await jwt();
  const browser = await launcher.launch();
  const mkDevice = async ({ signedIn }) => {
    // Playwright's WebKit does not route requests that pass through a service worker, so WebKit runs without the SW
    // (the SW's /api bypass is covered by the Chromium run and by tests/e2e.mjs offline checks).
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'en-GB', timezoneId: 'Europe/London', serviceWorkers: type === 'webkit' ? 'block' : 'allow' });
    const state = { signedIn, calls: [] };
    await ctx.route(/\/mentorflow\/api\//, async (route) => {
      const req = route.request(); const u = new URL(req.url()); const path = u.pathname.replace(/^\/mentorflow/, '') + u.search;
      state.calls.push(`${req.method()} ${path}`);
      // Playwright's WebKit cannot fulfill 3xx responses, so there a signed-out session answers 401 (also handled).
      if (!state.signedIn) return type === 'webkit' ? route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Please sign in."}' }) : route.fulfill({ status: 302, headers: { Location: 'https://mentorflow.cloudflareaccess.com/cdn-cgi/access/login/x' } });
      const headers = { ...req.headers(), 'cf-access-jwt-assertion': token }; delete headers.origin;
      const res = await w.mf.dispatchFetch('https://mentorflow.example.workers.dev' + path, { method: req.method(), headers, body: req.postData() || undefined, redirect: 'manual' });
      let loc = res.headers.get('Location'); if (loc) loc = BASE + loc.replace(/^https:\/\/[^/]+\//, '');
      if (loc && type === 'webkit') return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(loc)})</script>` });
      return route.fulfill({ status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', ...(loc ? { Location: loc } : {}) }, body: Buffer.from(await res.arrayBuffer()) });
    });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    return { ctx, page, state, errors };
  };
  const count = async (store) => (await w.db.prepare('SELECT COUNT(*) AS n FROM records WHERE store = ?1 AND deleted = 0').bind(store).first()).n;
  const syncNow = (page) => page.evaluate(() => window.__mentorflowSync.runSync('test'));

  const ipad = await mkDevice({ signedIn: false });
  await step('signed out / expired Access session → "Sign in to sync" banner and button, nothing sent', async () => {
    await ipad.page.goto(BASE); await ipad.page.click('[data-action=sample-data]');
    await ipad.page.waitForSelector('[data-testid=sync-login-banner]');
    await ipad.page.goto(BASE + '#/more'); await ipad.page.waitForSelector('[data-testid=sync-login]');
    assert.match(await ipad.page.locator('[data-testid=sync-status]').innerText(), /Not signed in/);
    assert.equal(await count('sessions'), 0);
  });
  await step('"Sign in to sync" navigates to ./api/login (not swallowed by the service worker), comes back signed in', async () => {
    if (type !== 'webkit') await ipad.page.evaluate(() => navigator.serviceWorker?.ready);
    ipad.state.signedIn = true;
    await Promise.all([ipad.page.waitForURL(/#\/more$/), ipad.page.click('[data-testid=sync-login]')]);
    assert.ok(ipad.state.calls.includes('GET /api/login'));
    try { await ipad.page.waitForFunction(() => window.__mentorflowSync?.syncState.status === 'ok', null, { timeout: 15000 }); }
    catch (e) { console.log('    debug:', ipad.page.url(), await ipad.page.evaluate(() => JSON.stringify(window.__mentorflowSync?.syncState)).catch(x => x.message), ipad.state.calls.join(', ')); throw e; }
  });
  await step('all local data (students, sessions, tasks, expenses, settings) reaches D1', async () => {
    const n = await ipad.page.evaluate(() => window.__mentorflow.state.sessions.length);
    assert.equal(await count('sessions'), n); assert.equal(await count('students'), 5); assert.ok(await count('tasks') >= 10); assert.ok(await count('expenses') >= 6);
    assert.ok(await count('settings') >= 5, 'settings fields synced');
  });
  const pc = await mkDevice({ signedIn: true });
  await step('second device pulls everything on first open', async () => {
    await pc.page.goto(BASE);
    await pc.page.waitForFunction(() => window.__mentorflowSync?.syncState.status === 'ok' && window.__mentorflow.state.students.length === 5, null, { timeout: 15000 });
    const [a, b] = await Promise.all([ipad, pc].map(d => d.page.evaluate(() => window.__mentorflow.state.sessions.length)));
    assert.equal(a, b);
    assert.equal(await pc.page.evaluate(() => window.__mentorflow.state.settings.yourName), 'Sample Tutor');
  });
  await step('edit + delete on one device show up on the other (tombstones)', async () => {
    await ipad.page.evaluate(async () => {
      const st = await import('./js/store.js'); const s = st.state.sessions[0]; window.__del = st.state.sessions[1].id;
      st.saveSession({ ...s, notes: 'Edited on iPad' }); st.deleteSession(window.__del); window.__edited = s.id;
    });
    await syncNow(ipad.page); await syncNow(pc.page);
    const ids = await ipad.page.evaluate(() => ({ e: window.__edited, d: window.__del }));
    const r = await pc.page.evaluate((ids) => ({ notes: window.__mentorflow.state.sessions.find(s => s.id === ids.e)?.notes, deleted: !window.__mentorflow.state.sessions.some(s => s.id === ids.d) }), ids);
    assert.equal(r.notes, 'Edited on iPad'); assert.equal(r.deleted, true);
    const row = await w.db.prepare("SELECT deleted FROM records WHERE store='sessions' AND id=?1").bind(ids.d).first(); assert.equal(row.deleted, 1);
  });
  await step('a setting changed on the PC syncs to the iPad; the Notion token does not', async () => {
    await pc.page.evaluate(async () => { const st = await import('./js/store.js'); st.saveSettings({ monthlyTarget: 3210, notionToken: 'secret_xyz' }); });
    await syncNow(pc.page); await syncNow(ipad.page);
    const s = await ipad.page.evaluate(() => window.__mentorflow.state.settings);
    assert.equal(s.monthlyTarget, 3210); assert.notEqual(s.notionToken, 'secret_xyz');
    const all = JSON.stringify((await w.db.prepare('SELECT data FROM records').all()).results); assert.ok(!all.includes('secret_xyz'));
  });
  await step('session expires later → status flips to "Sign in to sync", local edits stay queued and sync after sign-in', async () => {
    ipad.state.signedIn = false;
    await ipad.page.evaluate(async () => { const st = await import('./js/store.js'); st.saveTask({ title: 'Made while signed out', type: 'mine', status: 'todo' }); });
    await syncNow(ipad.page);
    assert.equal(await ipad.page.evaluate(() => window.__mentorflowSync.syncState.status), 'needs-login');
    ipad.state.signedIn = true; await syncNow(ipad.page);
    const row = await w.db.prepare("SELECT COUNT(*) AS n FROM records WHERE store='tasks' AND data LIKE '%Made while signed out%'").first(); assert.equal(row.n, 1);
  });
  await step('no page errors', async () => { assert.deepEqual([...ipad.errors, ...pc.errors], []); });
  await browser.close(); await w.dispose();
}
for (const [name, l] of Object.entries({ chromium, webkit })) if (which === 'all' || which === name) await run(name, l);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
