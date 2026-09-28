/* ============================================================
   PIXEL ORCA — проверка бэкапа базы в репозиторий GitHub

   Воспроизводит ровно ту поломку, ради которой бэкап и нужен:
   хостинг без постоянного тома, редеплой пересоздаёт контейнер,
   файла базы больше нет. Сервер обязан воскресить базу из приватного
   репозитория, чтобы ник не пришлось регистрировать заново.

   Сеть не используется: вместо api.github.com поднимается локальная
   заглушка, которая хранит один файл. Токен — фиктивный.

   Запуск:  node tools/smoke-backup.mjs
   ============================================================ */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const TMP = path.join(ROOT, 'server', 'data', 'smoke-backup');
const DB = path.join(TMP, 'db.json');
const GH_PORT = 8900 + (process.pid % 90);
const GAME_PORT = 9000 + (process.pid % 90);
const NICK = 'Косатка';
const PASS = 'пароль123';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? ' → ' + extra : '')); }
};

/* ---------- заглушка GitHub: один файл в репозитории ---------- */
let stored = null, puts = 0;
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const gh = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'PUT') {
      const b = JSON.parse(Buffer.concat(chunks).toString());
      stored = { sha: 'sha-' + (++puts), content: b.content };
      return json(res, 200, { content: { sha: stored.sha } });
    }
    if (!stored) { res.writeHead(404); return res.end('Not Found'); }
    json(res, 200, { sha: stored.sha, content: stored.content });
  });
});
await new Promise(r => gh.listen(GH_PORT, '127.0.0.1', r));

/* ---------- запуск настоящего сервера ---------- */
function startServer() {
  const p = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(GAME_PORT), HOST: '127.0.0.1', DATA_FILE: DB,
      BACKUP_REPO: 'me/kosatka-data', BACKUP_TOKEN: 'ghp_fake',
      BACKUP_API: 'http://127.0.0.1:' + GH_PORT
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.log = () => out;
  return p;
}
function waitListen(p, ms) {
  return (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 10000)) {
      if (/сервер запущен/.test(p.log())) return true;
      if (p.exitCode !== null) throw new Error('сервер умер:\n' + p.log().slice(-600));
      await sleep(150);
    }
    throw new Error('сервер не поднялся:\n' + p.log().slice(-600));
  })();
}
function auth(t, payload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + GAME_PORT + '/ws');
    const timer = setTimeout(() => { try { ws.close(); } catch (e) { /* ignore */ } reject(new Error('таймаут ' + t)); }, 6000);
    ws.onopen = () => ws.send(JSON.stringify({ t, rid: 1, ...payload }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'auth:ok' || /:err$/.test(m.t)) {
        clearTimeout(timer);
        try { ws.close(); } catch (e2) { /* ignore */ }
        resolve(m);
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error ' + t)); };
  });
}
const health = () => fetch('http://127.0.0.1:' + GAME_PORT + '/api/health').then(r => r.json());
const stop = (p) => new Promise(r => { p.once('exit', r); p.kill('SIGTERM'); });
/* wipe — то, что делает платформа при редеплое без тома */
const wipe = () => { fs.rmSync(DB, { force: true }); fs.rmSync(DB + '.firstborn', { force: true }); return !fs.existsSync(DB); };

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let srv = null;
try {
  console.log('\n  \x1b[1m[1]\x1b[0m первый запуск: аккаунт создаётся');
  srv = startServer();
  await waitListen(srv);
  let h = await health();
  ok('бэкап включён и виден в /api/health', !!(h.backup && h.backup.on === true), JSON.stringify(h.backup));
  ok('пустой репозиторий (404) не ломает старт', h.accounts === 0);
  const reg = await auth('auth:register', { name: NICK, pass: PASS });
  ok('аккаунт зарегистрирован', reg.t === 'auth:ok', reg.t + ' ' + (reg.msg || ''));
  ok('аккаунт появился в базе', (await health()).accounts === 1);

  console.log('\n  \x1b[1m[2]\x1b[0m рестарт: снимок уезжает в репозиторий');
  await stop(srv);
  srv = null;
  ok('снимок записан (PUT)', puts === 1, 'puts=' + puts);
  const snap = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8')) : null;
  ok('в снимке виден аккаунт', !!(snap && snap.accounts && Object.keys(snap.accounts).length === 1),
    JSON.stringify(Object.keys((snap && snap.accounts) || {})));

  console.log('\n  \x1b[1m[3]\x1b[0m wipe: файла базы нет, как после редеплоя');
  ok('файл базы удалён', wipe());
  srv = startServer();
  await waitListen(srv);
  h = await health();
  ok('база восстановлена из репозитория', h.accounts === 1, 'accounts=' + h.accounts);
  ok('health рапортует о восстановлении', h.backup.restores === 1, JSON.stringify(h.backup));
  ok('в логе есть «восстановлена из бэкапа»', /восстановлена из бэкапа/.test(srv.log()),
    srv.log().slice(-300));
  ok('старый ник занят — база не обнулилась',
    /:err$/.test((await auth('auth:register', { name: NICK, pass: PASS })).t || ''));
  ok('вход по старому паролю после wipe',
    (await auth('auth:login', { name: NICK, pass: PASS })).t === 'auth:ok');

  console.log('\n  \x1b[1m[4]\x1b[0m второй wipe: снимок обновился и снова подхватился');
  await sleep(300);
  await stop(srv);
  srv = null;
  ok('снимок перезаписан (второй PUT)', puts === 2, 'puts=' + puts);
  wipe();
  srv = startServer();
  await waitListen(srv);
  ok('аккаунт на месте после второго wipe', (await health()).accounts === 1);
} catch (e) {
  fail++;
  console.log('  \x1b[31mФЕЙЛ:\x1b[0m ' + e.message);
} finally {
  if (srv) { try { srv.kill('SIGKILL'); } catch (e) { /* ignore */ } }
  gh.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('');
  console.log(`  Пройдено: ${pass}, провалено: ${fail}`);
  process.exit(fail ? 1 : 0);
}
