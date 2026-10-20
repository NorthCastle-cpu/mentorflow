import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error') errs.push(m.text())});
await p.goto('http://localhost:8080/mentorflow/'); await p.waitForTimeout(1500);
console.log(await p.locator('#view').innerText().then(t=>t.slice(0,300)));
await p.click('text=Try with sample data'); await p.waitForTimeout(800);
for (const r of ['today','students','sessions','tasks','money','expenses','more']) { await p.goto('http://localhost:8080/mentorflow/#/'+r); await p.waitForTimeout(400); console.log(r, (await p.locator('#view').innerText()).slice(0,80).replace(/\n/g,' | ')); }
console.log('ERRORS', errs); await b.close();
