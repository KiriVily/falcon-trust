import assert from 'node:assert/strict';
import { makeEnv, api, press, U, OWNER, tgLog, failChats, worker, initData } from './harness.mjs';

const env = makeEnv();
const owner = U(OWNER, 'Boss'), u1 = U(2001, 'Ivan'), u2 = U(2002, 'Anna'), u3 = U(2003);
const lastAns = () => [...tgLog].reverse().find(x => x.method === 'answerCallbackQuery').body.text;
let r;

// status
r = await (await worker.fetch(new Request('https://w.test/'), env)).json();
assert.equal(r.v, 3); assert.equal(r.db, true);

// auth: bad / stale initData
assert.equal((await api(env, 'user=%7B%22id%22%3A1000%7D&hash=00', 'me')).status, 401);
assert.equal((await api(env, initData(owner, 90000), 'me')).status, 401);

// new user: no access, not admin
r = await api(env, u1, 'me');
assert.deepEqual([r.ok, r.admin, r.owner, r.blocked, r.access, r.orders], [true, false, false, false, [], []]);

// a client number alone gives nothing: the request is pending until staff confirms
assert.equal((await api(env, u1, 'access_req', { client: 'abc' })).status, 400);
await env.RL.put('cfg:wh', '1');
tgLog.length = 0;
r = await api(env, u1, 'access_req', { client: '№ 916', note: 'ООО Ромашка' });
assert.deepEqual(r.access, [{ client: '916', status: 'pending' }]);
const sent = tgLog.filter(x => x.method === 'sendMessage');
assert.equal(sent.length, 2);
assert.deepEqual(sent[0].body.reply_markup.inline_keyboard.map(row => row[0].callback_data), ['ac:ok:1', 'ac:no:1']);
assert.match(sent[0].body.text, /916/); assert.match(sent[0].body.text, /ID 2001/);
assert.equal((await api(env, u1, 'access_req', { client: '916' })).status, 400);
assert.equal((await api(env, u1, 'access_req', { client: '917' })).status, 429);

// admin actions are closed for ordinary users
for (const a of ['list', 'acc_list', 'acc_set', 'acc_del', 'acc_add', 'user_block', 'user_role', 'save', 'del'])
  assert.equal((await api(env, u1, a, { id: 1, tg_id: 2001, client: '916', status: 'active', admin: true })).status, 403, a);
assert.equal((await api(env, u1, 'me')).access[0].status, 'pending');

// Telegram buttons: a stranger cannot confirm, the owner can
await press(env, u1, 'ac:ok:1');
assert.equal((await api(env, u1, 'me')).access[0].status, 'pending');
r = await api(env, owner, 'acc_list');
assert.equal(r.owner, true); assert.equal(r.access.length, 1); assert.equal(r.access[0].name, 'Ivan'); assert.equal(r.access[0].tg_id, '2001');
tgLog.length = 0;
await press(env, owner, 'ac:ok:1');
assert.deepEqual((await api(env, u1, 'me')).access, [{ client: '916', status: 'active' }]);
assert.ok(tgLog.some(x => x.method === 'sendMessage' && x.body.chat_id === 2001 && /916/.test(x.body.text)));
assert.ok(tgLog.some(x => x.method === 'editMessageReplyMarkup'));
await press(env, owner, 'ac:no:1');
assert.match(lastAns(), /\u0443\u0436\u0435 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d/);
assert.equal((await api(env, u1, 'me')).access[0].status, 'active');

// request without a number: cannot be confirmed from Telegram, only from the panel with a number
await new Promise(z => setTimeout(z, 5));
r = await api(env, u3, 'access_req', {});
assert.deepEqual(r.access, [{ client: '', status: 'pending' }]);
await press(env, owner, 'ac:ok:2');
assert.equal((await api(env, u3, 'me')).access[0].status, 'pending');
assert.equal((await api(env, owner, 'acc_set', { id: 2, status: 'active', client: '' })).status, 400);
r = await api(env, owner, 'acc_set', { id: 2, status: 'active', client: '920' });
assert.equal(r.ok, true); assert.equal(r.notified, true);
assert.deepEqual((await api(env, u3, 'me')).access, [{ client: '920', status: 'active' }]);

// owner adds an admin by Telegram ID; the admin manages access but cannot make admins
assert.equal((await api(env, u2, 'me')).admin, false);
assert.equal((await api(env, owner, 'user_role', { tg_id: '2002', admin: true })).ok, true);
r = await api(env, u2, 'me'); assert.deepEqual([r.admin, r.owner], [true, false]);
assert.equal((await api(env, u2, 'user_role', { tg_id: 2001, admin: true })).status, 403);
assert.equal((await api(env, u2, 'user_block', { tg_id: OWNER, blocked: true })).status, 400);
assert.equal((await api(env, u2, 'acc_list')).admins[0].tg_id, '2002');
tgLog.length = 0;
await press(env, u2, 'take');
assert.ok(tgLog.some(x => x.method === 'editMessageReplyMarkup'), 'in-app admin can use request buttons');

// link by Telegram ID (user never opened the bot -> notification fails, link still created)
failChats.add('3009');
r = await api(env, u2, 'acc_add', { tg_id: '3009', client: '916' });
assert.deepEqual([r.ok, r.notified], [true, false]);
assert.equal((await api(env, u2, 'acc_add', { tg_id: '3009', client: '916' })).status, 400);
// one user, several cabinets
assert.equal((await api(env, u2, 'acc_add', { tg_id: 2001, client: '920' })).ok, true);
assert.deepEqual((await api(env, u1, 'me')).access.map(a => a.client + a.status), ['916active', '920active']);
assert.equal((await api(env, owner, 'acc_set', { id: 1, status: 'active', client: '920' })).status, 400, 'duplicate cabinet');

// block: user loses the cabinet; unblock restores
assert.equal((await api(env, u2, 'user_block', { tg_id: 2001, blocked: true })).ok, true);
r = await api(env, u1, 'me'); assert.deepEqual([r.blocked, r.access, r.admin], [true, [], false]);
assert.equal((await api(env, u1, 'access_req', { client: '5' })).status, 403);
assert.equal((await api(env, owner, 'acc_list')).blocked[0].tg_id, '2001');
await api(env, u2, 'user_block', { tg_id: 2001, blocked: false });
assert.equal((await api(env, u1, 'me')).access.length, 2);

// reject / remove
r = await api(env, owner, 'acc_set', { id: 1, status: 'rejected' });
assert.equal(r.ok, true);
assert.equal((await api(env, u1, 'me')).access[0].status, 'rejected');
await api(env, owner, 'acc_del', { id: 1 });
assert.deepEqual((await api(env, u1, 'me')).access, [{ client: '920', status: 'active' }]);

// a blocked admin loses the panel; only the owner can block an admin
await api(env, owner, 'user_role', { tg_id: 2003, admin: true });
assert.equal((await api(env, u3, 'user_block', { tg_id: 2002, blocked: true })).status, 403);
await api(env, owner, 'user_block', { tg_id: 2002, blocked: true });
assert.equal((await api(env, u2, 'me')).admin, false);
assert.equal((await api(env, u2, 'acc_list')).status, 403);
tgLog.length = 0; await press(env, u2, 'take');
assert.ok(!tgLog.some(x => x.method === 'editMessageReplyMarkup'));
await api(env, owner, 'user_role', { tg_id: 2002, admin: false });

// existing features still work: orders and request submission
r = await api(env, owner, 'save', { order: { title: 'Чехлы', wh: 'Иу', route: 'Через Казахстан', places: 3, kg: 12.5, stage: 2, client_id: '2001' }, notify: true });
assert.equal(r.order.num, 'FT-0001'); assert.equal(r.notified, true);
r = await api(env, u1, 'me'); assert.equal(r.orders.length, 1); assert.equal(r.orders[0].stage, 2);
assert.equal((await api(env, owner, 'list')).orders.length, 1);
const fd = new FormData(); fd.append('initData', initData(u1)); fd.append('kind', 'quick'); fd.append('contact', '@ivan_test'); fd.append('type', 'Вопрос'); fd.append('msg', 'привет');
fd.append('photo', new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
r = await (await worker.fetch(new Request('https://w.test/', { method: 'POST', body: fd }), env)).json();
assert.deepEqual(r, { ok: true, photo: 'sent' });

// worker without DB binding keeps answering
const noDb = { ...env, DB: undefined };
r = await api(noDb, owner, 'me'); assert.deepEqual([r.ok, r.db, r.admin], [true, false, true]);
console.log('ALL WORKER TESTS PASSED');
