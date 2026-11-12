// Local test harness: runs the worker against in-memory SQLite (as D1), a Map (as KV) and a fake Telegram API.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import worker from './worker.mjs';

export const TOKEN = '123456:TEST-TOKEN';
export const OWNER = 1000;
export const tgLog = [];
export const failChats = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://api.telegram.org/')) return realFetch(url, init);
  const method = u.split('/').pop();
  let body = {};
  if (typeof init.body === 'string') body = JSON.parse(init.body);
  else if (init.body instanceof FormData) body = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '[file]']));
  tgLog.push({ method, body });
  const ok = !failChats.has(String(body.chat_id));
  return new Response(JSON.stringify(ok ? { ok: true, result: {} } : { ok: false, description: 'blocked' }), { status: ok ? 200 : 403 });
};

export function makeEnv() {
  const db = new DatabaseSync(':memory:');
  class Stmt {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...a) { return new Stmt(this.sql, a); }
    async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; }
    async first() { const r = db.prepare(this.sql).get(...this.args); return r ? { ...r } : null; }
    async all() { return { results: db.prepare(this.sql).all(...this.args).map(r => ({ ...r })) }; }
  }
  const kv = new Map();
  return {
    BOT_TOKEN: TOKEN, CHAT_ID: String(OWNER) + ',-100555', MANAGER: '@test_manager',
    RL: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
    DB: { prepare: sql => new Stmt(sql), batch: async a => { for (const s of a) await s.run(); } },
    _db: db, _kv: kv
  };
}

export function initData(user, ageSec = 0) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - ageSec), query_id: 'q', user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
export const U = (id, first_name = 'User' + id, username = 'user_' + id) => ({ id, first_name, username });

export async function api(env, user, action, extra = {}) {
  const r = await worker.fetch(new Request('https://w.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: typeof user === 'string' ? user : initData(user), action, ...extra }) }), env);
  return { status: r.status, ...(await r.json()) };
}
export async function hookSecret() {
  return crypto.createHmac('sha256', TOKEN).update('falcon-webhook').digest('hex');
}
export async function press(env, from, data, message_id = 1) {
  const r = await worker.fetch(new Request('https://w.test/tg', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': await hookSecret() },
    body: JSON.stringify({ callback_query: { id: 'cb', from, data, message: { message_id, chat: { id: OWNER }, text: 'x', reply_markup: { inline_keyboard: [[{ text: 'a', callback_data: data }]] } } } }) }), env);
  return r.status;
}
export { worker };
