// Запуск worker.js на обычном Node (Docker/Elestio). Хранилище KV → SQLite (node:sqlite).
import http from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker from './worker.mjs';

const DATA = process.env.DATA_DIR || '/app/data';
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(`${DATA}/portal.db`);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, x INTEGER NOT NULL DEFAULT 0)');
const sGet = db.prepare('SELECT v, x FROM kv WHERE k = ?');
const sPut = db.prepare('INSERT INTO kv (k, v, x) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, x = excluded.x');
const sDel = db.prepare('DELETE FROM kv WHERE k = ?');
const sClean = db.prepare('DELETE FROM kv WHERE x > 0 AND x < ?');
const NW = {
  async get(k) { const r = sGet.get(k); if (!r) return null; if (r.x && r.x < Date.now()) { sDel.run(k); return null; } return r.v; },
  async put(k, v, o) { sPut.run(k, String(v), o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0); },
  async delete(k) { sDel.run(k); },
};
setInterval(() => sClean.run(Date.now()), 10 * 60 * 1000).unref();

const env = { ...process.env, NW };
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'RESEND_API_KEY', 'OTP_SECRET', 'MAIL_FROM']) {
  if (!env[k]) console.error(`WARNING: не задана переменная ${k}`);
}
const pending = new Set();
const ctx = { waitUntil: (p) => { pending.add(p); p.finally(() => pending.delete(p)); } };

http.createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${req.headers.host}${req.url}`;
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' }), env, ctx);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) h['set-cookie'] = sc;
    res.writeHead(r.status, h);
    if (r.body) Readable.fromWeb(r.body).pipe(res); else res.end();
  } catch (e) { console.error('server error', e && e.message); if (!res.headersSent) res.writeHead(500); res.end('error'); }
}).listen(5000, '0.0.0.0', () => console.log('portal on :5000'));
