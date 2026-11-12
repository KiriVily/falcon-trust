import re
src=open('.hoplite/attachments/art_upload_92d7b4d8b24e4447923b6a869812fe4d/worker (1).js',encoding='utf-8').read()
def esc(s):
    out=[]
    for ch in s:
        if ord(ch)<128: out.append(ch)
        else:
            b=ch.encode('utf-16-be')
            out.append(''.join('\\u%04x'%int.from_bytes(b[i:i+2],'big') for i in range(0,len(b),2)))
    return ''.join(out)
def rep(old,new,cnt=1):
    global src
    assert src.count(old)==cnt,(old,src.count(old))
    src=src.replace(old,esc(new))
def resub(pat,fn):
    global src
    m=re.findall(pat,src); assert len(m)==1,(pat,len(m))
    src=re.sub(pat,lambda mm:fn(mm.group(0)),src)

rep("// Falcon Trust worker v2.","// Falcon Trust worker v3 (client access: linking Telegram to a client number, confirmed by staff).")
rep("//   ADMIN_IDS  - text, optional: Telegram IDs of admins, comma-separated. If empty, IDs from CHAT_ID are used.",
"//   ADMIN_IDS  - text, optional: Telegram IDs of owners, comma-separated. If empty, IDs from CHAT_ID are used.\n//                Owners can add more admins by Telegram ID inside the app (admin panel -> access).")
rep("return J({ ok: true, service: 'Falcon Trust', configured:","return J({ ok: true, service: 'Falcon Trust', v: 3, configured:")
rep("if (!isAdmin(env, q.from && q.from.id)) {","if (!(await staff(env, q.from && q.from.id))) {")
rep("""  } else {
    await ans('');
  }
  return new Response('ok');
}""",r"""  } else if (data.startsWith('ac:')) {
    const m = /^ac:(ok|no):(\d{1,12})$/.exec(data);
    if (!m || !env.DB) { await ans(''); return new Response('ok'); }
    await initDb(env);
    const r = await decide(env, Number(m[2]), m[1] === 'ok' ? 'active' : 'rejected', q.from.id, null, true);
    if (!r.ok) { await ans(r.error, true); return new Response('ok'); }
    const label = (m[1] === 'ok' ? '✅ Доступ открыт: №' + r.client : '❌ Отклонено') + ' · ' + (q.from.first_name || 'админ').slice(0, 30) + ' · ' + when;
    await tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'noop' }]] } });
    await ans(m[1] === 'ok' ? 'Доступ открыт' + (r.notified === false ? '. Сообщить клиенту не удалось' : '') : 'Запрос отклонён');
  } else {
    await ans('');
  }
  return new Response('ok');
}""")
rep("  const adm = isAdmin(env, user.id);\n","  const owner = isAdmin(env, user.id);\n  let adm = owner;\n")
rep("""  await initDb(env);
  const DB = env.DB;

  if (action === 'me') {""",r"""  await initDb(env);
  const DB = env.DB;
  const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const digits = v => String(v == null ? '' : v).replace(/[\s№#]/g, '');
  const now0 = Date.now();
  const urow = await DB.prepare("INSERT INTO users (tg_id, name, username, role, blocked, created, seen) VALUES (?, ?, ?, '', 0, ?, ?) ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name, username = excluded.username, seen = excluded.seen RETURNING role, blocked")
    .bind(user.id, s([user.first_name, user.last_name].filter(Boolean).join(' '), 100), s(user.username, 40), now0, now0).first();
  const blocked = !owner && !!(urow && urow.blocked);
  adm = owner || (!blocked && !!urow && urow.role === 'admin');
  const myAccess = async () => ((await DB.prepare('SELECT client, status FROM access WHERE tg_id = ? ORDER BY created').bind(user.id).all()).results || []).map(a => ({ client: a.client, status: a.status }));
  if (blocked) {
    if (action === 'me') return [{ ok: true, admin: false, owner: false, uid: user.id, db: true, blocked: true, access: [], orders: [] }];
    return [{ ok: false, error: 'Доступ к кабинету ограничен. Напишите менеджеру' }, 403];
  }

  if (action === 'access_req') {
    const client = digits(b.client);
    if (client && !/^\d{1,8}$/.test(client)) return [{ ok: false, error: 'Номер клиента — только цифры' }, 400];
    const note = s(b.note, 300);
    const mine = (await DB.prepare('SELECT * FROM access WHERE tg_id = ?').bind(user.id).all()).results || [];
    const same = mine.find(a => a.client === client);
    if (same && same.status === 'active') return [{ ok: false, error: 'Этот кабинет у вас уже подключён' }, 400];
    if (same && same.status === 'pending') return [{ ok: false, error: 'Запрос уже отправлен — ждём подтверждения сотрудника' }, 400];
    if (mine.some(a => now0 - a.created < 60000)) return [{ ok: false, error: 'Подождите минуту перед следующим запросом' }, 429];
    if (mine.filter(a => a.status === 'pending').length >= 3) return [{ ok: false, error: 'У вас уже есть запросы на рассмотрении' }, 400];
    let aid;
    if (same) { await DB.prepare("UPDATE access SET status = 'pending', note = ?, created = ?, decided = NULL, decided_by = NULL WHERE id = ?").bind(note, now0, same.id).run(); aid = same.id; }
    else aid = (await DB.prepare("INSERT INTO access (tg_id, client, status, note, created) VALUES (?, ?, 'pending', ?, ?)").bind(user.id, client, note, now0).run()).meta.last_row_id;
    const nm = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Без имени';
    const text = [
      '🔑 <b>Запрос доступа к кабинету клиента</b>', '',
      client ? `<b>Номер клиента (со слов пользователя):</b> ${esc(client)}` : '<b>Номер клиента не указан.</b> Назначьте его в приложении: Груз → Панель администратора → Доступы',
      note ? `<b>Комментарий:</b> ${esc(note)}` : '', '',
      `👤 <a href="tg://user?id=${user.id}">${esc(nm)}</a>${user.username ? ' (@' + esc(user.username) + ')' : ''} · ID ${user.id}`,
      'Подтверждайте, только если уверены, что это ваш клиент.'
    ].filter((x, i) => x !== '' || i === 1 || i === 4).join('\n');
    const live = !!(env.RL && await env.RL.get('cfg:wh'));
    const kb = [];
    if (live && client) kb.push([{ text: '✅ Подтвердить №' + client, callback_data: 'ac:ok:' + aid }]);
    if (live) kb.push([{ text: '❌ Отклонить', callback_data: 'ac:no:' + aid }]);
    for (const chat of String(env.CHAT_ID || '').split(',').map(x => x.trim()).filter(Boolean)) await sendWithFallback(env, { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }, kb);
    return [{ ok: true, access: await myAccess() }];
  }

  if (action === 'me') {""")
rep("return [{ ok: true, admin: adm, uid: user.id, db: true, orders: (results || []).map(pub) }];",
    "return [{ ok: true, admin: adm, owner, uid: user.id, db: true, blocked: false, access: await myAccess(), orders: (results || []).map(pub) }];")
def after_adm(line):
    return line+esc(r"""
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
    if (!id || !st) return [{ ok: false, error: 'Неверный запрос' }, 400];
    const r = await decide(env, id, st, user.id, digits(b.client), false);
    return r.ok ? [r] : [r, 400];
  }
  if (action === 'acc_del') {
    const id = toInt(b.id, 1e12);
    if (!id) return [{ ok: false, error: 'Неверный запрос' }, 400];
    await DB.prepare('DELETE FROM access WHERE id = ?').bind(id).run();
    return [{ ok: true }];
  }
  const tgid = v => { const d = digits(v); return /^\d{1,16}$/.test(d) && Number(d) > 0 ? Number(d) : null; };
  const ensureUser = t => DB.prepare("INSERT OR IGNORE INTO users (tg_id, name, username, role, blocked, created, seen) VALUES (?, '', '', '', 0, ?, 0)").bind(t, now0).run();
  if (action === 'acc_add') {
    const t = tgid(b.tg_id), client = digits(b.client);
    if (!t) return [{ ok: false, error: 'Telegram ID — только цифры' }, 400];
    if (!/^\d{1,8}$/.test(client)) return [{ ok: false, error: 'Номер клиента — только цифры' }, 400];
    await ensureUser(t);
    const cur = await DB.prepare('SELECT id, status FROM access WHERE tg_id = ? AND client = ?').bind(t, client).first();
    if (cur && cur.status === 'active') return [{ ok: false, error: 'Этот кабинет у пользователя уже подключён' }, 400];
    if (cur) await DB.prepare("UPDATE access SET status = 'active', decided = ?, decided_by = ? WHERE id = ?").bind(now0, user.id, cur.id).run();
    else await DB.prepare("INSERT INTO access (tg_id, client, status, note, created, decided, decided_by) VALUES (?, ?, 'active', '', ?, ?, ?)").bind(t, client, now0, now0, user.id).run();
    return [{ ok: true, notified: await tellAccess(env, t, client, 'active') }];
  }
  if (action === 'user_block' || action === 'user_role') {
    const t = tgid(b.tg_id);
    if (!t) return [{ ok: false, error: 'Telegram ID — только цифры' }, 400];
    if (isAdmin(env, t)) return [{ ok: false, error: 'Это владелец: его права задаются в настройках сервера' }, 400];
    if (action === 'user_role' && !owner) return [{ ok: false, error: 'Назначать администраторов может только владелец' }, 403];
    await ensureUser(t);
    if (action === 'user_role') { await DB.prepare('UPDATE users SET role = ? WHERE tg_id = ?').bind(b.admin ? 'admin' : '', t).run(); return [{ ok: true }]; }
    const tu = await DB.prepare('SELECT role FROM users WHERE tg_id = ?').bind(t).first();
    if (tu && tu.role === 'admin' && !owner) return [{ ok: false, error: 'Администратора может заблокировать только владелец' }, 403];
    await DB.prepare('UPDATE users SET blocked = ? WHERE tg_id = ?').bind(b.blocked ? 1 : 0, t).run();
    return [{ ok: true }];
  }
""")
resub(r"  if \(!adm\) return \[\{ ok: false, error: '[^']*' \}, 403\];\n",after_adm)
rep("""    const o = b.order || {};
    const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
""","    const o = b.order || {};\n")
rep("""  await env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_client ON orders (client_id)').run();
""","""  await env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_client ON orders (client_id)').run();
  // users: everyone who opened the cabinet; access: Telegram user <-> client number (many-to-many), confirmed by staff
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (tg_id INTEGER PRIMARY KEY, name TEXT, username TEXT, role TEXT NOT NULL DEFAULT '', blocked INTEGER NOT NULL DEFAULT 0, created INTEGER, seen INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS access (id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER NOT NULL, client TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', note TEXT, created INTEGER, decided INTEGER, decided_by INTEGER, UNIQUE (tg_id, client))")
  ]);
""")
rep("const num = id => 'FT-' + String(id).padStart(4, '0');",r"""// confirm / reject an access request (used by the admin panel and by the buttons in Telegram)
async function decide(env, id, status, by, client, onlyPending) {
  const DB = env.DB;
  const a = await DB.prepare('SELECT * FROM access WHERE id = ?').bind(id).first();
  if (!a) return { ok: false, error: 'Запрос не найден — возможно, его удалили' };
  if (onlyPending && a.status !== 'pending') return { ok: false, error: 'Этот запрос уже обработан' };
  const c = status === 'active' && client ? client : a.client;
  if (status === 'active') {
    if (!/^\d{1,8}$/.test(c)) return { ok: false, error: 'Укажите номер клиента в приложении: Панель администратора → Доступы' };
    const dup = await DB.prepare('SELECT id FROM access WHERE tg_id = ? AND client = ? AND id <> ?').bind(a.tg_id, c, id).first();
    if (dup) return { ok: false, error: 'У этого пользователя уже есть запись с таким номером клиента' };
  }
  await DB.prepare('UPDATE access SET client = ?, status = ?, decided = ?, decided_by = ? WHERE id = ?').bind(c, status, Date.now(), by, id).run();
  const notified = a.status !== status || a.client !== c ? await tellAccess(env, a.tg_id, c, status) : null;
  return { ok: true, notified, client: c };
}
async function tellAccess(env, chat, client, status) {
  const m = manager(env);
  const text = status === 'active'
    ? `✅ Доступ к кабинету клиента №${esc(client)} открыт.\nОткройте приложение, раздел «Груз».`
    : `Запрос доступа к кабинету${client ? ' №' + esc(client) : ''} отклонён.\nЕсли это ошибка — напишите менеджеру${m ? ' ' + m : ''}.`;
  const body = { chat_id: chat, text, disable_web_page_preview: true };
  let r = await tg(env, 'sendMessage', { ...body, reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: APP_URL } }]] } });
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

const num = id => 'FT-' + String(id).padStart(4, '0');""")
assert all(ord(c)<128 for c in src)
open('.hoplite/out/worker.js','w',encoding='utf-8',newline='').write(src)
print('ok',len(src))
