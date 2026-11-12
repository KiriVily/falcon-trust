// Falcon Trust worker v3 (client access: linking Telegram to a client number, confirmed by staff).
// Settings (Cloudflare -> Worker -> Settings):
//   BOT_TOKEN  - secret, bot token
//   CHAT_ID    - text, where requests are sent (comma-separated)
//   RL         - KV binding (anti-spam pause)
//   DB         - D1 binding (orders database) - needed for the admin panel
//   MANAGER    - text, optional: manager's Telegram, e.g. @falcon_manager
//   ADMIN_IDS  - text, optional: Telegram IDs of owners, comma-separated. If empty, IDs from CHAT_ID are used.
//                Owners can add more admins by Telegram ID inside the app (admin panel -> access).
const ORIGIN = 'https://kirivily.github.io';
const APP_URL = 'https://kirivily.github.io/falcon-trust/';
const WAIT = 30;
const ST = ['\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0430', '\u041e\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044f \u043d\u0430 \u0441\u043a\u043b\u0430\u0434\u0435', '\u041f\u0440\u0438\u043d\u044f\u0442 \u043d\u0430 \u0441\u043a\u043b\u0430\u0434\u0435', '\u0413\u043e\u0442\u043e\u0432 \u043a \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0435', '\u0412 \u043f\u0443\u0442\u0438', '\u041f\u0440\u0438\u0431\u044b\u043b', '\u0412\u044b\u0434\u0430\u043d'];
const WHS = ['\u0418\u0443', '\u0413\u0443\u0430\u043d\u0447\u0436\u043e\u0443', '\u0424\u043e\u0448\u0430\u043d\u044c'];
const RTS = ['\u0427\u0435\u0440\u0435\u0437 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d', '\u0427\u0435\u0440\u0435\u0437 \u0423\u0441\u0441\u0443\u0440\u0438\u0439\u0441\u043a', '\u0427\u0435\u0440\u0435\u0437 \u0411\u043b\u0430\u0433\u043e\u0432\u0435\u0449\u0435\u043d\u0441\u043a'];
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      if (path === '/tg') return await onTelegram(req, env);
      if (req.method === 'GET') {
        if (path === '/setup') return J(await setup(env, url));
        return J({ ok: true, service: 'Falcon Trust', v: 3, configured: !!(env.BOT_TOKEN && env.CHAT_ID && env.RL), db: !!env.DB, manager: manager(env) });
      }
      if (req.method !== 'POST') return J({ ok: false, error: '\u041c\u0435\u0442\u043e\u0434 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f' }, 405);
      const o = req.headers.get('Origin');
      if (o && o !== ORIGIN) return J({ ok: false, error: '\u0417\u0430\u043f\u0440\u0435\u0449\u0451\u043d\u043d\u044b\u0439 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a' }, 403);
      if (!env.BOT_TOKEN) return J({ ok: false, error: '\u0421\u0435\u0440\u0432\u0435\u0440 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d' }, 500);
      if (path === '/api') { const [res, st] = await onApi(req, env); return J(res, st || 200); }
      return await onRequest(req, env);
    } catch (e) {
      console.error(e && e.stack || e);
      if (path === '/tg') return new Response('ok');
      return J({ ok: false, error: '\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435' }, 500);
    }
  }
};

// ---------- request from the app -> Telegram
async function onRequest(req, env) {
  if (!env.CHAT_ID || !env.RL) return J({ ok: false, error: '\u0421\u0435\u0440\u0432\u0435\u0440 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d' }, 500);
  let fd;
  try { fd = await req.formData(); } catch { return J({ ok: false, error: '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441' }, 400); }
  const user = await checkInit(String(fd.get('initData') || ''), env.BOT_TOKEN);
  if (!user) return J({ ok: false, error: '\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 Telegram-\u0431\u043e\u0442\u0430' }, 401);

  const g = (k, n = 500) => String(fd.get(k) || '').trim().slice(0, n);
  const contact = normContact(g('contact', 100));
  if (!contact) return J({ ok: false, error: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 Telegram (@username) \u0438\u043b\u0438 \u0442\u0435\u043b\u0435\u0444\u043e\u043d +7' }, 400);
  const kind = g('kind', 10) === 'buy' ? 'buy' : 'quick';
  const rows = kind === 'buy'
    ? [['\u0422\u043e\u0432\u0430\u0440', g('name', 300)], ['\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e', g('qty', 20)], ['\u0420\u0430\u0437\u043c\u0435\u0440 / \u0446\u0432\u0435\u0442', g('opt', 300)], ['\u0416\u0435\u043b\u0430\u0435\u043c\u0430\u044f \u0446\u0435\u043d\u0430, \u20bd', g('price', 30)], ['\u0421\u0441\u044b\u043b\u043a\u0430', g('url', 1000)]]
    : [['\u0427\u0442\u043e \u043d\u0443\u0436\u043d\u043e', g('type', 100)], ['\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435', g('msg', 2500)]];
  if (kind === 'buy' && !g('name')) return J({ ok: false, error: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0442\u043e\u0432\u0430\u0440\u0430' }, 400);

  const key = 'u:' + user.id, now = Date.now();
  const last = Number(await env.RL.get(key)) || 0;
  if (now - last < WAIT * 1000) return J({ ok: false, error: 'wait', wait: Math.ceil((WAIT * 1000 - (now - last)) / 1000) }, 429);
  await env.RL.put(key, String(now), { expirationTtl: 60 });

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || '\u0411\u0435\u0437 \u0438\u043c\u0435\u043d\u0438';
  const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const text = [
    `\ud83e\udd85 <b>\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430 \u2014 ${kind === 'buy' ? '\u0432\u044b\u043a\u0443\u043f \u0442\u043e\u0432\u0430\u0440\u0430' : '\u0431\u044b\u0441\u0442\u0440\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430'}</b>`, '',
    ...rows.filter(r => r[1]).map(r => `<b>${r[0]}:</b> ${esc(r[1])}`),
    `<b>\u041a\u043e\u043d\u0442\u0430\u043a\u0442:</b> ${esc(contact)}`, '',
    `\ud83d\udc64 <a href="tg://user?id=${user.id}">${esc(name)}</a>${user.username ? ' (@' + esc(user.username) + ')' : ''} \u00b7 ID ${user.id}`,
    `\ud83d\udd52 ${time} (\u041c\u0421\u041a)`
  ].join('\n').slice(0, 4000);

  // buttons under the request
  const live = !!(await env.RL.get('cfg:wh')); // buttons that need answers work only after /setup
  const kb = [];
  if (live) kb.push([{ text: '\u2705 \u0412\u0437\u044f\u043b \u0432 \u0440\u0430\u0431\u043e\u0442\u0443', callback_data: 'take' }]);
  kb.push([{ text: '\ud83d\udcac \u041e\u0442\u0432\u0435\u0442\u0438\u0442\u044c \u043a\u043b\u0438\u0435\u043d\u0442\u0443', url: replyUrl(contact, user) }]);
  if (live && env.DB) kb.push([{ text: '\ud83d\udce6 \u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u043a\u0430\u0437', callback_data: 'mk:' + user.id }]);

  const photo = fd.get('photo');
  const gotFile = photo && typeof photo === 'object' && photo.size > 0;
  const hasPhoto = gotFile && photo.size <= 10 * 1024 * 1024 && String(photo.type).startsWith('image/');
  let sent = 0, photoOk = 0, photoTry = 0;
  for (const chat of String(env.CHAT_ID).split(',').map(s => s.trim()).filter(Boolean)) {
    const ok = await sendWithFallback(env, { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }, kb);
    if (ok) sent++;
    if (ok && hasPhoto) {
      photoTry++;
      const cap = '\u0424\u043e\u0442\u043e \u043a \u0437\u0430\u044f\u0432\u043a\u0435 \u043e\u0442 ' + name;
      const p = new FormData(); p.append('chat_id', chat); p.append('caption', cap); p.append('photo', photo, photo.name || 'photo.jpg');
      let rp = await fetch(api(env, 'sendPhoto'), { method: 'POST', body: p });
      if (!rp.ok) { const d = new FormData(); d.append('chat_id', chat); d.append('caption', cap); d.append('document', photo, photo.name || 'photo.jpg'); rp = await fetch(api(env, 'sendDocument'), { method: 'POST', body: d }); }
      if (rp.ok) photoOk++;
    }
  }
  if (!sent) { await env.RL.delete(key); return J({ ok: false, error: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435' }, 502); }
  const photoState = !gotFile ? 'none' : (photoOk ? 'sent' : 'failed');
  return J({ ok: true, photo: photoState });
}

// try with all buttons -> without the "reply" button (Telegram may block it by privacy) -> without buttons
async function sendWithFallback(env, body, kb) {
  const variants = [kb, kb.filter(r => !(r[0].url || '').startsWith('tg:')), []];
  for (const v of variants) {
    const r = await tg(env, 'sendMessage', v.length ? { ...body, reply_markup: { inline_keyboard: v } } : body);
    if (r.ok) return r;
  }
  return null;
}

function replyUrl(contact, user) {
  if (contact[0] === '@') return 'https://t.me/' + contact.slice(1);
  if (user.username) return 'https://t.me/' + user.username;
  return 'tg://user?id=' + user.id;
}

// ---------- button presses in Telegram (webhook)
async function onTelegram(req, env) {
  if (req.method !== 'POST' || !env.BOT_TOKEN) return new Response('ok');
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await hookSecret(env.BOT_TOKEN)) return new Response('forbidden', { status: 403 });
  let u; try { u = await req.json(); } catch { return new Response('ok'); }
  const q = u && u.callback_query;
  if (!q) return new Response('ok');
  const ans = (text, alert = false) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert });
  const data = String(q.data || '');
  const msg = q.message;
  if (data === 'noop' || !msg) { await ans(''); return new Response('ok'); }
  if (!(await staff(env, q.from && q.from.id))) { await ans('\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430'); return new Response('ok'); }
  const kb = (msg.reply_markup && msg.reply_markup.inline_keyboard) || [];
  const swap = (cb, btn) => tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: kb.map(row => row.map(b => b.callback_data === cb ? btn : b)) } });
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  if (data === 'take') {
    await swap('take', { text: `\u2705 \u0412 \u0440\u0430\u0431\u043e\u0442\u0435: ${(q.from.first_name || '\u0430\u0434\u043c\u0438\u043d').slice(0, 30)} \u00b7 ${when}`, callback_data: 'noop' });
    await ans('\u041e\u0442\u043c\u0435\u0447\u0435\u043d\u043e: \u0437\u0430\u044f\u0432\u043a\u0430 \u0432 \u0440\u0430\u0431\u043e\u0442\u0435');
  } else if (data.startsWith('mk:')) {
    if (!env.DB) { await ans('\u0411\u0430\u0437\u0430 \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0430', true); return new Response('ok'); }
    const guard = `mk:${msg.chat.id}:${msg.message_id}`;
    const had = env.RL && await env.RL.get(guard);
    if (had) { await ans('\u0417\u0430\u043a\u0430\u0437 \u043f\u043e \u044d\u0442\u043e\u0439 \u0437\u0430\u044f\u0432\u043a\u0435 \u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u043d: ' + num(had), true); return new Response('ok'); }
    const cid = /^\d{1,16}$/.test(data.slice(3)) ? Number(data.slice(3)) : null;
    const L = String(msg.text || '').split('\n');
    const val = k => { const l = L.find(x => x.startsWith(k + ':')); return l ? l.slice(k.length + 1).trim() : ''; };
    const title = (val('\u0422\u043e\u0432\u0430\u0440') || val('\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435') || val('\u0427\u0442\u043e \u043d\u0443\u0436\u043d\u043e') || '\u0417\u0430\u043a\u0430\u0437').slice(0, 200);
    const person = (L.find(x => x.startsWith('\ud83d\udc64')) || '').replace('\ud83d\udc64', '').replace(/\s*\u00b7\s*ID\s*\d+\s*$/, '').trim();
    const client = [person, val('\u041a\u043e\u043d\u0442\u0430\u043a\u0442')].filter(Boolean).join(' \u00b7 ').slice(0, 200);
    await initDb(env);
    const now = Date.now();
    const r = await env.DB.prepare('INSERT INTO orders (client_id, client, title, wh, route, places, kg, stage, note, history, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
      .bind(cid, client, title, '', '', null, null, '', JSON.stringify([[0, now]]), now, now).run();
    const id = r.meta.last_row_id;
    if (env.RL) await env.RL.put(guard, String(id), { expirationTtl: 60 * 60 * 24 * 30 });
    await swap(data, { text: `\ud83d\udce6 \u0417\u0430\u043a\u0430\u0437 ${num(id)} \u0441\u043e\u0437\u0434\u0430\u043d`, callback_data: 'noop' });
    await ans(`\u0421\u043e\u0437\u0434\u0430\u043d \u0437\u0430\u043a\u0430\u0437 ${num(id)}. \u0414\u0435\u0442\u0430\u043b\u0438 \u0438 \u044d\u0442\u0430\u043f\u044b \u2014 \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438: \u0413\u0440\u0443\u0437 \u2192 \u041f\u0430\u043d\u0435\u043b\u044c \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430`, true);
  } else if (data.startsWith('ac:')) {
    const m = /^ac:(ok|no):(\d{1,12})$/.exec(data);
    if (!m || !env.DB) { await ans(''); return new Response('ok'); }
    await initDb(env);
    const r = await decide(env, Number(m[2]), m[1] === 'ok' ? 'active' : 'rejected', q.from.id, null, true);
    if (!r.ok) { await ans(r.error, true); return new Response('ok'); }
    const label = (m[1] === 'ok' ? '\u2705 \u0414\u043e\u0441\u0442\u0443\u043f \u043e\u0442\u043a\u0440\u044b\u0442: \u2116' + r.client : '\u274c \u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e') + ' \u00b7 ' + (q.from.first_name || '\u0430\u0434\u043c\u0438\u043d').slice(0, 30) + ' \u00b7 ' + when;
    await tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'noop' }]] } });
    await ans(m[1] === 'ok' ? '\u0414\u043e\u0441\u0442\u0443\u043f \u043e\u0442\u043a\u0440\u044b\u0442' + (r.notified === false ? '. \u0421\u043e\u043e\u0431\u0449\u0438\u0442\u044c \u043a\u043b\u0438\u0435\u043d\u0442\u0443 \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c' : '') : '\u0417\u0430\u043f\u0440\u043e\u0441 \u043e\u0442\u043a\u043b\u043e\u043d\u0451\u043d');
  } else {
    await ans('');
  }
  return new Response('ok');
}

// ---------- one-time webhook setup: open https://<worker>/setup in a browser
async function setup(env, url) {
  if (!env.BOT_TOKEN) return { ok: false, error: '\u041d\u0435 \u0437\u0430\u0434\u0430\u043d BOT_TOKEN' };
  const hook = url.origin + '/tg';
  const info = await tg(env, 'getWebhookInfo', {});
  if (!info.ok) return { ok: false, error: 'Telegram \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 BOT_TOKEN' };
  const cur = (info.result && info.result.url) || '';
  if (cur && cur !== hook && url.searchParams.get('force') !== '1') {
    let host = ''; try { host = new URL(cur).host; } catch { }
    return { ok: false, error: '\u041a \u0431\u043e\u0442\u0443 \u0443\u0436\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0435\u0440\u0432\u0438\u0441 (' + host + '). \u042f \u0435\u0433\u043e \u043d\u0435 \u0442\u0440\u043e\u0433\u0430\u043b, \u0447\u0442\u043e\u0431\u044b \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u0441\u043b\u043e\u043c\u0430\u0442\u044c. \u041d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 \u043e\u0431 \u044d\u0442\u043e\u043c \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a\u0443.' };
  }
  const r = await tg(env, 'setWebhook', { url: hook, secret_token: await hookSecret(env.BOT_TOKEN), allowed_updates: ['callback_query'], drop_pending_updates: true });
  if (!r.ok) return { ok: false, error: 'Telegram \u043e\u0442\u043a\u0430\u0437\u0430\u043b: ' + (r.description || '\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430') };
  if (env.RL) await env.RL.put('cfg:wh', '1');
  return { ok: true, result: '\u0413\u043e\u0442\u043e\u0432\u043e! \u041a\u043d\u043e\u043f\u043a\u0438 \u043f\u043e\u0434 \u0437\u0430\u044f\u0432\u043a\u0430\u043c\u0438 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u044b.', database: env.DB ? '\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0430' : '\u041d\u0415 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0430', manager: manager(env) || '\u043d\u0435 \u0437\u0430\u0434\u0430\u043d' };
}

// ---------- app API (orders)
async function onApi(req, env) {
  let b; try { b = await req.json(); } catch { return [{ ok: false, error: '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441' }, 400]; }
  const user = await checkInit(String(b && b.initData || ''), env.BOT_TOKEN);
  if (!user) return [{ ok: false, error: '\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 Telegram-\u0431\u043e\u0442\u0430' }, 401];
  const owner = isAdmin(env, user.id);
  let adm = owner;
  const action = String(b.action || '');
  if (!env.DB) {
    if (action === 'me') return [{ ok: true, admin: adm, uid: user.id, db: false, orders: [] }];
    return [{ ok: false, error: '\u0411\u0430\u0437\u0430 \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0430 (\u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430 DB \u0432 Cloudflare)' }, 503];
  }
  await initDb(env);
  const DB = env.DB;
  const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const digits = v => String(v == null ? '' : v).replace(/[\s\u2116#]/g, '');
  const now0 = Date.now();
  const urow = await DB.prepare("INSERT INTO users (tg_id, name, username, role, blocked, created, seen) VALUES (?, ?, ?, '', 0, ?, ?) ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name, username = excluded.username, seen = excluded.seen RETURNING role, blocked")
    .bind(user.id, s([user.first_name, user.last_name].filter(Boolean).join(' '), 100), s(user.username, 40), now0, now0).first();
  const blocked = !owner && !!(urow && urow.blocked);
  adm = owner || (!blocked && !!urow && urow.role === 'admin');
  const myAccess = async () => ((await DB.prepare('SELECT client, status FROM access WHERE tg_id = ? ORDER BY created').bind(user.id).all()).results || []).map(a => ({ client: a.client, status: a.status }));
  if (blocked) {
    if (action === 'me') return [{ ok: true, admin: false, owner: false, uid: user.id, db: true, blocked: true, access: [], orders: [] }];
    return [{ ok: false, error: '\u0414\u043e\u0441\u0442\u0443\u043f \u043a \u043a\u0430\u0431\u0438\u043d\u0435\u0442\u0443 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d. \u041d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0443' }, 403];
  }

  if (action === 'access_req') {
    const client = digits(b.client);
    if (client && !/^\d{1,8}$/.test(client)) return [{ ok: false, error: '\u041d\u043e\u043c\u0435\u0440 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u0446\u0438\u0444\u0440\u044b' }, 400];
    const note = s(b.note, 300);
    const mine = (await DB.prepare('SELECT * FROM access WHERE tg_id = ?').bind(user.id).all()).results || [];
    const same = mine.find(a => a.client === client);
    if (same && same.status === 'active') return [{ ok: false, error: '\u042d\u0442\u043e\u0442 \u043a\u0430\u0431\u0438\u043d\u0435\u0442 \u0443 \u0432\u0430\u0441 \u0443\u0436\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d' }, 400];
    if (same && same.status === 'pending') return [{ ok: false, error: '\u0417\u0430\u043f\u0440\u043e\u0441 \u0443\u0436\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u2014 \u0436\u0434\u0451\u043c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430' }, 400];
    if (mine.some(a => now0 - a.created < 60000)) return [{ ok: false, error: '\u041f\u043e\u0434\u043e\u0436\u0434\u0438\u0442\u0435 \u043c\u0438\u043d\u0443\u0442\u0443 \u043f\u0435\u0440\u0435\u0434 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u043c \u0437\u0430\u043f\u0440\u043e\u0441\u043e\u043c' }, 429];
    if (mine.filter(a => a.status === 'pending').length >= 3) return [{ ok: false, error: '\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0437\u0430\u043f\u0440\u043e\u0441\u044b \u043d\u0430 \u0440\u0430\u0441\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u0438\u0438' }, 400];
    let aid;
    if (same) { await DB.prepare("UPDATE access SET status = 'pending', note = ?, created = ?, decided = NULL, decided_by = NULL WHERE id = ?").bind(note, now0, same.id).run(); aid = same.id; }
    else aid = (await DB.prepare("INSERT INTO access (tg_id, client, status, note, created) VALUES (?, ?, 'pending', ?, ?)").bind(user.id, client, note, now0).run()).meta.last_row_id;
    const nm = [user.first_name, user.last_name].filter(Boolean).join(' ') || '\u0411\u0435\u0437 \u0438\u043c\u0435\u043d\u0438';
    const text = [
      '\ud83d\udd11 <b>\u0417\u0430\u043f\u0440\u043e\u0441 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u043a\u0430\u0431\u0438\u043d\u0435\u0442\u0443 \u043a\u043b\u0438\u0435\u043d\u0442\u0430</b>', '',
      client ? `<b>\u041d\u043e\u043c\u0435\u0440 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 (\u0441\u043e \u0441\u043b\u043e\u0432 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f):</b> ${esc(client)}` : '<b>\u041d\u043e\u043c\u0435\u0440 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d.</b> \u041d\u0430\u0437\u043d\u0430\u0447\u044c\u0442\u0435 \u0435\u0433\u043e \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438: \u0413\u0440\u0443\u0437 \u2192 \u041f\u0430\u043d\u0435\u043b\u044c \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430 \u2192 \u0414\u043e\u0441\u0442\u0443\u043f\u044b',
      note ? `<b>\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439:</b> ${esc(note)}` : '', '',
      `\ud83d\udc64 <a href="tg://user?id=${user.id}">${esc(nm)}</a>${user.username ? ' (@' + esc(user.username) + ')' : ''} \u00b7 ID ${user.id}`,
      '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0439\u0442\u0435, \u0442\u043e\u043b\u044c\u043a\u043e \u0435\u0441\u043b\u0438 \u0443\u0432\u0435\u0440\u0435\u043d\u044b, \u0447\u0442\u043e \u044d\u0442\u043e \u0432\u0430\u0448 \u043a\u043b\u0438\u0435\u043d\u0442.'
    ].filter((x, i) => x !== '' || i === 1 || i === 4).join('\n');
    const live = !!(env.RL && await env.RL.get('cfg:wh'));
    const kb = [];
    if (live && client) kb.push([{ text: '\u2705 \u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u2116' + client, callback_data: 'ac:ok:' + aid }]);
    if (live) kb.push([{ text: '\u274c \u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c', callback_data: 'ac:no:' + aid }]);
    for (const chat of String(env.CHAT_ID || '').split(',').map(x => x.trim()).filter(Boolean)) await sendWithFallback(env, { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }, kb);
    return [{ ok: true, access: await myAccess() }];
  }

  if (action === 'me') {
    const { results } = await DB.prepare('SELECT * FROM orders WHERE client_id = ? ORDER BY updated DESC LIMIT 50').bind(user.id).all();
    return [{ ok: true, admin: adm, owner, uid: user.id, db: true, blocked: false, access: await myAccess(), orders: (results || []).map(pub) }];
  }
  if (!adm) return [{ ok: false, error: '\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430' }, 403];

  // ---------- access management (admins)
  if (action === 'acc_list') {
    const acc = (await DB.prepare('SELECT a.id, a.tg_id, a.client, a.status, a.note, a.created, u.name, u.username, u.blocked FROM access a LEFT JOIN users u ON u.tg_id = a.tg_id ORDER BY a.created DESC LIMIT 500').all()).results || [];
    const adms = (await DB.prepare("SELECT tg_id, name, username FROM users WHERE role = 'admin' ORDER BY created LIMIT 100").all()).results || [];
    const blk = (await DB.prepare('SELECT tg_id, name, username FROM users WHERE blocked = 1 ORDER BY seen DESC LIMIT 200').all()).results || [];
    const str = r => ({ ...r, tg_id: String(r.tg_id) });
    return [{ ok: true, owner, access: acc.map(r => ({ ...str(r), blocked: !!r.blocked })), admins: adms.map(str), blocked: blk.map(str) }];
  }
  if (action === 'acc_set') {
    const id = toInt(b.id, 1e12), st = b.status === 'active' ? 'active' : b.status === 'rejected' ? 'rejected' : '';
    if (!id || !st) return [{ ok: false, error: '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441' }, 400];
    const r = await decide(env, id, st, user.id, digits(b.client), false);
    return r.ok ? [r] : [r, 400];
  }
  if (action === 'acc_del') {
    const id = toInt(b.id, 1e12);
    if (!id) return [{ ok: false, error: '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441' }, 400];
    await DB.prepare('DELETE FROM access WHERE id = ?').bind(id).run();
    return [{ ok: true }];
  }
  const tgid = v => { const d = digits(v); return /^\d{1,16}$/.test(d) && Number(d) > 0 ? Number(d) : null; };
  const ensureUser = t => DB.prepare("INSERT OR IGNORE INTO users (tg_id, name, username, role, blocked, created, seen) VALUES (?, '', '', '', 0, ?, 0)").bind(t, now0).run();
  if (action === 'acc_add') {
    const t = tgid(b.tg_id), client = digits(b.client);
    if (!t) return [{ ok: false, error: 'Telegram ID \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u0446\u0438\u0444\u0440\u044b' }, 400];
    if (!/^\d{1,8}$/.test(client)) return [{ ok: false, error: '\u041d\u043e\u043c\u0435\u0440 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u0446\u0438\u0444\u0440\u044b' }, 400];
    await ensureUser(t);
    const cur = await DB.prepare('SELECT id, status FROM access WHERE tg_id = ? AND client = ?').bind(t, client).first();
    if (cur && cur.status === 'active') return [{ ok: false, error: '\u042d\u0442\u043e\u0442 \u043a\u0430\u0431\u0438\u043d\u0435\u0442 \u0443 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f \u0443\u0436\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d' }, 400];
    if (cur) await DB.prepare("UPDATE access SET status = 'active', decided = ?, decided_by = ? WHERE id = ?").bind(now0, user.id, cur.id).run();
    else await DB.prepare("INSERT INTO access (tg_id, client, status, note, created, decided, decided_by) VALUES (?, ?, 'active', '', ?, ?, ?)").bind(t, client, now0, now0, user.id).run();
    return [{ ok: true, notified: await tellAccess(env, t, client, 'active') }];
  }
  if (action === 'user_block' || action === 'user_role') {
    const t = tgid(b.tg_id);
    if (!t) return [{ ok: false, error: 'Telegram ID \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u0446\u0438\u0444\u0440\u044b' }, 400];
    if (isAdmin(env, t)) return [{ ok: false, error: '\u042d\u0442\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u0435\u0446: \u0435\u0433\u043e \u043f\u0440\u0430\u0432\u0430 \u0437\u0430\u0434\u0430\u044e\u0442\u0441\u044f \u0432 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445 \u0441\u0435\u0440\u0432\u0435\u0440\u0430' }, 400];
    if (action === 'user_role' && !owner) return [{ ok: false, error: '\u041d\u0430\u0437\u043d\u0430\u0447\u0430\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432 \u043c\u043e\u0436\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u0435\u0446' }, 403];
    await ensureUser(t);
    if (action === 'user_role') { await DB.prepare('UPDATE users SET role = ? WHERE tg_id = ?').bind(b.admin ? 'admin' : '', t).run(); return [{ ok: true }]; }
    const tu = await DB.prepare('SELECT role FROM users WHERE tg_id = ?').bind(t).first();
    if (tu && tu.role === 'admin' && !owner) return [{ ok: false, error: '\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430 \u043c\u043e\u0436\u0435\u0442 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u0435\u0446' }, 403];
    await DB.prepare('UPDATE users SET blocked = ? WHERE tg_id = ?').bind(b.blocked ? 1 : 0, t).run();
    return [{ ok: true }];
  }

  if (action === 'list') {
    const { results } = await DB.prepare('SELECT * FROM orders ORDER BY updated DESC LIMIT 300').all();
    return [{ ok: true, orders: (results || []).map(full) }];
  }
  if (action === 'del') {
    const id = toInt(b.id, 1e12);
    if (!id) return [{ ok: false, error: '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d \u0437\u0430\u043a\u0430\u0437' }, 400];
    await DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
    return [{ ok: true }];
  }
  if (action === 'save') {
    const o = b.order || {};
    const cidS = s(o.client_id, 20);
    if (cidS && !/^\d{1,16}$/.test(cidS)) return [{ ok: false, error: 'Telegram ID \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u2014 \u0442\u043e\u043b\u044c\u043a\u043e \u0446\u0438\u0444\u0440\u044b' }, 400];
    const kg = o.kg === '' || o.kg == null ? null : Number(o.kg);
    if (kg != null && !(kg >= 0 && kg <= 1e6)) return [{ ok: false, error: '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0432\u0435\u0441' }, 400];
    const places = o.places === '' || o.places == null ? null : toInt(o.places, 1e6);
    if (o.places !== '' && o.places != null && places == null) return [{ ok: false, error: '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u043c\u0435\u0441\u0442' }, 400];
    const f = {
      client_id: cidS ? Number(cidS) : null,
      client: s(o.client, 200),
      title: s(o.title, 200),
      wh: WHS.includes(o.wh) ? o.wh : '',
      route: RTS.includes(o.route) ? o.route : '',
      places,
      kg: kg == null ? null : Math.round(kg * 10) / 10,
      stage: Number.isInteger(Number(o.stage)) ? Math.max(0, Math.min(ST.length - 1, Number(o.stage))) : 0,
      note: s(o.note, 500)
    };
    if (!f.title) return [{ ok: false, error: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435, \u0447\u0442\u043e \u0437\u0430 \u0433\u0440\u0443\u0437' }, 400];
    const id = o.id ? toInt(o.id, 1e12) : null;
    const cur = id ? await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first() : null;
    if (id && !cur) return [{ ok: false, error: '\u0417\u0430\u043a\u0430\u0437 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u2014 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e, \u0435\u0433\u043e \u0443\u0434\u0430\u043b\u0438\u043b\u0438' }, 404];
    const now = Date.now();
    const hist = cur ? parseJ(cur.history, []) : [];
    const changed = !cur || Number(cur.stage) !== f.stage;
    if (changed) hist.push([f.stage, now]);
    let oid = id;
    if (cur) {
      await DB.prepare('UPDATE orders SET client_id = ?, client = ?, title = ?, wh = ?, route = ?, places = ?, kg = ?, stage = ?, note = ?, history = ?, updated = ? WHERE id = ?')
        .bind(f.client_id, f.client, f.title, f.wh, f.route, f.places, f.kg, f.stage, f.note, JSON.stringify(hist.slice(-50)), now, id).run();
    } else {
      const r = await DB.prepare('INSERT INTO orders (client_id, client, title, wh, route, places, kg, stage, note, history, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(f.client_id, f.client, f.title, f.wh, f.route, f.places, f.kg, f.stage, f.note, JSON.stringify(hist), now, now).run();
      oid = r.meta.last_row_id;
    }
    const row = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(oid).first();
    let notified = null;
    if (changed && b.notify && f.client_id) notified = await notifyClient(env, row);
    return [{ ok: true, order: full(row), notified }];
  }
  return [{ ok: false, error: '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435' }, 400];
}

async function notifyClient(env, o) {
  const text = [
    `\ud83d\udce6 <b>\u0417\u0430\u043a\u0430\u0437 ${num(o.id)}</b>`,
    `\u041d\u043e\u0432\u044b\u0439 \u044d\u0442\u0430\u043f: <b>${esc(ST[o.stage] || '')}</b>`,
    esc(o.title || ''),
    o.note ? '\n' + esc(o.note) : '',
    '', '\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u043e\u0441\u0442\u0438 \u2014 \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438, \u0440\u0430\u0437\u0434\u0435\u043b \u00ab\u0413\u0440\u0443\u0437\u00bb.'
  ].filter((x, i) => x !== '' || i === 4).join('\n');
  const body = { chat_id: o.client_id, text, parse_mode: 'HTML', disable_web_page_preview: true };
  let r = await tg(env, 'sendMessage', { ...body, reply_markup: { inline_keyboard: [[{ text: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435', web_app: { url: APP_URL } }]] } });
  if (!r.ok) r = await tg(env, 'sendMessage', body);
  return !!r.ok;
}

// confirm / reject an access request (used by the admin panel and by the buttons in Telegram)
async function decide(env, id, status, by, client, onlyPending) {
  const DB = env.DB;
  const a = await DB.prepare('SELECT * FROM access WHERE id = ?').bind(id).first();
  if (!a) return { ok: false, error: '\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u2014 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e, \u0435\u0433\u043e \u0443\u0434\u0430\u043b\u0438\u043b\u0438' };
  if (onlyPending && a.status !== 'pending') return { ok: false, error: '\u042d\u0442\u043e\u0442 \u0437\u0430\u043f\u0440\u043e\u0441 \u0443\u0436\u0435 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d' };
  const c = status === 'active' && client ? client : a.client;
  if (status === 'active') {
    if (!/^\d{1,8}$/.test(c)) return { ok: false, error: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u043e\u043c\u0435\u0440 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438: \u041f\u0430\u043d\u0435\u043b\u044c \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430 \u2192 \u0414\u043e\u0441\u0442\u0443\u043f\u044b' };
    const dup = await DB.prepare('SELECT id FROM access WHERE tg_id = ? AND client = ? AND id <> ?').bind(a.tg_id, c, id).first();
    if (dup) return { ok: false, error: '\u0423 \u044d\u0442\u043e\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c \u0441 \u0442\u0430\u043a\u0438\u043c \u043d\u043e\u043c\u0435\u0440\u043e\u043c \u043a\u043b\u0438\u0435\u043d\u0442\u0430' };
  }
  await DB.prepare('UPDATE access SET client = ?, status = ?, decided = ?, decided_by = ? WHERE id = ?').bind(c, status, Date.now(), by, id).run();
  const notified = a.status !== status || a.client !== c ? await tellAccess(env, a.tg_id, c, status) : null;
  return { ok: true, notified, client: c };
}
async function tellAccess(env, chat, client, status) {
  const m = manager(env);
  const text = status === 'active'
    ? `\u2705 \u0414\u043e\u0441\u0442\u0443\u043f \u043a \u043a\u0430\u0431\u0438\u043d\u0435\u0442\u0443 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u2116${esc(client)} \u043e\u0442\u043a\u0440\u044b\u0442.\n\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435, \u0440\u0430\u0437\u0434\u0435\u043b \u00ab\u0413\u0440\u0443\u0437\u00bb.`
    : `\u0417\u0430\u043f\u0440\u043e\u0441 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u043a\u0430\u0431\u0438\u043d\u0435\u0442\u0443${client ? ' \u2116' + esc(client) : ''} \u043e\u0442\u043a\u043b\u043e\u043d\u0451\u043d.\n\u0415\u0441\u043b\u0438 \u044d\u0442\u043e \u043e\u0448\u0438\u0431\u043a\u0430 \u2014 \u043d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0443${m ? ' ' + m : ''}.`;
  const body = { chat_id: chat, text, disable_web_page_preview: true };
  let r = await tg(env, 'sendMessage', { ...body, reply_markup: { inline_keyboard: [[{ text: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435', web_app: { url: APP_URL } }]] } });
  if (!r.ok) r = await tg(env, 'sendMessage', body);
  return !!r.ok;
}
// owner (ADMIN_IDS / CHAT_ID) or an admin added inside the app
async function staff(env, id) {
  if (isAdmin(env, id)) return true;
  if (!env.DB || id == null) return false;
  await initDb(env);
  const u = await env.DB.prepare('SELECT role, blocked FROM users WHERE tg_id = ?').bind(id).first();
  return !!(u && u.role === 'admin' && !u.blocked);
}

const num = id => 'FT-' + String(id).padStart(4, '0');
const pub = r => ({ num: num(r.id), title: r.title || '', wh: r.wh || '', route: r.route || '', places: r.places, kg: r.kg, stage: Number(r.stage) || 0, note: r.note || '', updated: r.updated });
const full = r => ({ ...pub(r), id: r.id, client_id: r.client_id == null ? '' : String(r.client_id), client: r.client || '', created: r.created });

const dbReady = new WeakSet();
async function initDb(env) {
  if (dbReady.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, client TEXT, title TEXT, wh TEXT, route TEXT, places INTEGER, kg REAL, stage INTEGER NOT NULL DEFAULT 0, note TEXT, history TEXT, created INTEGER, updated INTEGER)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_client ON orders (client_id)').run();
  // users: everyone who opened the cabinet; access: Telegram user <-> client number (many-to-many), confirmed by staff
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (tg_id INTEGER PRIMARY KEY, name TEXT, username TEXT, role TEXT NOT NULL DEFAULT '', blocked INTEGER NOT NULL DEFAULT 0, created INTEGER, seen INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS access (id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER NOT NULL, client TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', note TEXT, created INTEGER, decided INTEGER, decided_by INTEGER, UNIQUE (tg_id, client))")
  ]);
  dbReady.add(env.DB);
}

// ---------- helpers
const api = (env, m) => `https://api.telegram.org/bot${env.BOT_TOKEN}/${m}`;
async function tg(env, method, body) {
  try {
    const r = await fetch(api(env, method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ...j, ok: r.ok && !!j.ok };
  } catch { return { ok: false }; }
}
function admins(env) {
  return String(env.ADMIN_IDS || env.CHAT_ID || '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
}
const isAdmin = (env, id) => id != null && admins(env).includes(String(id));
function manager(env) {
  const u = String(env.MANAGER || '').trim().replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(u) ? '@' + u : '';
}
function toInt(v, max) { const x = Number(v); return Number.isInteger(x) && x >= 0 && x <= max ? x : null; }
function parseJ(s, d) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : d; } catch { return d; } }
async function hookSecret(token) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('falcon-webhook')));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkInit(initData, token) {
  if (!initData || !token) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(token));
  const k2 = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k2, enc.encode(dcs)));
  const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== hash) return null;
  const ad = Number(p.get('auth_date')) || 0;
  if (!ad || Date.now() / 1000 - ad > 86400) return null;
  try { const u = JSON.parse(p.get('user') || 'null'); return u && u.id ? u : null; } catch { return null; }
}

function normContact(v) {
  v = String(v || '').trim();
  const u = v.replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
  if (/^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/.test(u) && !u.includes('__')) return '@' + u;
  let d = v.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  const plus = d[0] === '+'; d = d.replace('+', '');
  if (!plus && d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (!plus && d.length === 10 && d[0] === '9') d = '7' + d;
  if (d.length === 11 && d[0] === '7') return '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
  return null;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
