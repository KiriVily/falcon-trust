// Browser check: the real index.html in Chrome, Telegram stubbed, worker running in-process on in-memory SQLite.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeEnv, initData, U, OWNER, tgLog, worker } from './harness.mjs';

const html = fs.readFileSync('../../index.html');
const env = makeEnv();
await env.RL.put('cfg:wh', '1');
const SHOTS = '../out/shots'; fs.mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const errors = [];

async function open(user, width, { oldServer = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width > 900 ? 800 : 860, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.setRequestInterception(true);
  page.on('request', async rq => {
    const url = rq.url();
    try {
      if (url.startsWith('https://kirivily.github.io/falcon-trust')) return rq.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      if (url.includes('telegram.org/js/telegram-web-app.js')) {
        const stub = user ? `window.Telegram={WebApp:{initData:${JSON.stringify(initData(user))},initDataUnsafe:{user:${JSON.stringify(user)}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},isVersionAtLeast:()=>false,HapticFeedback:{selectionChanged(){},notificationOccurred(){}}}};` : '';
        return rq.respond({ status: 200, contentType: 'application/javascript', body: stub });
      }
      if (url.startsWith('https://falcon-trust.kirasilow.workers.dev')) {
        const init = { method: rq.method(), headers: rq.headers() };
        if (rq.method() === 'POST') init.body = Buffer.from(rq.postData() || '', 'utf8');
        const res = await worker.fetch(new Request(url, init), env);
        let body = await res.text();
        if (oldServer && rq.method() === 'POST' && url.endsWith('/api')) { const j = JSON.parse(body); delete j.access; delete j.blocked; delete j.owner; body = JSON.stringify(j); }
        return rq.respond({ status: res.status, headers: Object.fromEntries(res.headers), body });
      }
      return rq.continue();
    } catch (e) { errors.push('intercept: ' + e); rq.abort(); }
  });
  await page.goto('https://kirivily.github.io/falcon-trust/', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  return page;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, ad: document.querySelector('#ad').scrollWidth - document.querySelector('#ad').clientWidth }));
  assert.ok(o.doc <= 0 && o.ad <= 0, label + ' horizontal overflow ' + JSON.stringify(o));
};
const toCab = async page => { await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; (document.querySelector('#acb:not([hidden])') || document.querySelector('#cbx')).scrollIntoView({ block: 'center' }); }); await wait(1200); };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const text = (page, sel) => page.$eval(sel, e => e.innerText);

const u1 = U(2001, 'Иван Петров', 'ivan_petrov'), owner = U(OWNER, 'Кирилл', 'owner_k'), u2 = U(2002, 'Анна', 'anna_mgr');

// 0. old server (no access support): nothing new is shown
let p = await open(u1, 412, { oldServer: true });
assert.equal(await p.$eval('#acb', e => e.hidden), true);
await p.close();
// 0b. plain browser, no Telegram: card hidden, demo as before
p = await open(null, 412);
assert.equal(await p.$eval('#acb', e => e.hidden), true);
assert.match(await text(p, '#ctag'), /Демо/);
await p.close();

// 1. client without access: form -> pending
for (const w of [360, 1280]) { p = await open(u1, w); await toCab(p); await noOverflow(p, 'cab-empty-' + w); await shot(p, `1-client-no-access-${w}`); await p.close(); }
p = await open(u1, 412); await toCab(p);
assert.match(await text(p, '#acb'), /Подключите кабинет клиента/);
await shot(p, '1-client-no-access-412');
await p.type('#ac_n', 'abc'); await p.click('#acf button'); await wait(200);
assert.match(await text(p, '#ts'), /только цифры/);
await p.$eval('#ac_n', e => e.value = ''); await p.type('#ac_n', '916'); await p.type('#ac_m', 'ООО Ромашка');
await p.click('#acf button'); await wait(500);
assert.match(await text(p, '#acb'), /№ 916 отправлен/);
assert.equal(await p.$('#acf'), null);
await noOverflow(p, 'pending'); await shot(p, '2-client-pending-412');
await p.close();
assert.ok(tgLog.some(x => x.method === 'sendMessage' && /916/.test(x.body.text)), 'admins notified');

// 2. owner: panel -> access tab -> confirm, add admin, link by id
for (const w of [412, 360, 1280]) {
  p = await open(owner, w); await toCab(p);
  assert.equal(await p.$eval('#cad', e => e.hidden), false);
  await p.click('#cad'); await wait(700);
  assert.equal(await p.$eval('#adtb', e => e.hidden), false);
  await p.click('#adtb [data-v=a]'); await wait(600);
  if (w === 412) {
    assert.match(await text(p, '#adtb'), /Доступы · 1/);
    assert.match(await text(p, '#ada'), /Иван Петров · @ivan_petrov · ID 2001/);
    assert.equal(await p.$eval('#adn', e => e.hidden), true);
    await noOverflow(p, 'acc-pending'); await shot(p, '3-admin-access-pending-412');
    await p.click('#ada [data-a=ok]'); await wait(600);
    assert.match(await text(p, '#ada'), /Новых запросов нет/);
    await p.type('#ac_a', '2002'); await p.click('#ada [data-a=adm]'); await wait(600);
    await p.type('#ac_u', '3009'); await p.type('#ac_c', '920'); await p.click('#ada [data-a=add]'); await wait(600);
    assert.match(await text(p, '#ada'), /№ 920/);
    await p.click('#ada [data-a=blk][data-u="3009"]'); await wait(600);
    assert.match(await text(p, '#ada'), /Заблокированные/i);
  }
  await noOverflow(p, 'acc-' + w);
  await p.evaluate(() => document.querySelector('#ad').scrollTop = 0); await wait(200);
  await shot(p, `4-admin-access-${w}`);
  await p.evaluate(() => document.querySelector('#ad').scrollTop = 99999); await wait(200);
  await shot(p, `4-admin-access-${w}-bottom`);
  // orders tab still works, form hides tabs, back restores
  await p.click('#adtb [data-v=o]'); await wait(200);
  assert.equal(await p.$eval('#adl', e => e.hidden), false); assert.equal(await p.$eval('#adn', e => e.hidden), false);
  await p.click('#adn'); await wait(200);
  assert.equal(await p.$eval('#adtb', e => e.hidden), true); assert.equal(await p.$eval('#adf', e => e.hidden), false);
  await p.click('#adb'); await wait(200);
  assert.equal(await p.$eval('#adtb', e => e.hidden), false);
  await p.close();
}

// 3. client now sees the cabinet
p = await open(u1, 412); await toCab(p);
assert.match(await text(p, '#acb'), /Кабинет клиента: № 916/);
await shot(p, '5-client-active-412');
await p.click('#acm'); await wait(200); assert.ok(await p.$('#acf'));
await p.close();

// 4. in-app admin (not owner): sees panel, no admin management
p = await open(u2, 412); await toCab(p);
await p.click('#cad'); await wait(600); await p.click('#adtb [data-v=a]'); await wait(600);
assert.doesNotMatch(await text(p, '#ada'), /Администраторы/i);
assert.match(await text(p, '#ada'), /Подключённые кабинеты/i);
await p.close();

// 5. blocked user
await env.DB.prepare('UPDATE users SET blocked = 1 WHERE tg_id = 2001').run();
p = await open(u1, 412); await toCab(p);
assert.match(await text(p, '#acb'), /ограничен/); await shot(p, '6-client-blocked-412');
await p.close();
await env.DB.prepare('UPDATE users SET blocked = 0 WHERE tg_id = 2001').run();

// 6. photo dropped with the mouse is really sent with the request
p = await open(u1, 1280);
await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['abc'], 'drop.png', { type: 'image/png' })); document.querySelector('#dz').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
assert.match(await text(p, '#dt'), /drop\.png/);
await p.type('#bn', 'Чехлы'); await p.type('#bq', '5'); await p.$eval('#bt', e => e.value = '@ivan_petrov');
await p.evaluate(() => { window.fetch = async (u, o) => { const f = o.body.get('photo'); window.__sent = f ? f.name + ':' + f.size : 'none'; return new Response(JSON.stringify({ ok: true, photo: 'sent' }), { headers: { 'Content-Type': 'application/json' } }); }; });
await p.$eval('#bf', f => f.requestSubmit()); await wait(600);
assert.equal(await p.evaluate(() => window.__sent), 'drop.png:3');
assert.match(await text(p, '#dt'), /Перетащите/);
await p.close();

await browser.close();
assert.deepEqual(errors, []);
console.log('ALL BROWSER CHECKS PASSED');
