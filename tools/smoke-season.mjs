/* ============================================================
   PIXEL ORCA — интеграционный тест конца сезона (детерминированный)
   Базу перед стартом кладём с уже истёкшим seasonEnd и готовыми
   очками сезона, поэтому первый же тик сервера раздаёт призы и
   начинает новый сезон — без гонок по времени. Проверяем:
   - event:reward победителям (топ-1 игрок + участник топ-1 клана),
   - event:season:end со сводкой всем клиентам,
   - сброс очков сезона, новый сезон,
   - что поддельный сейв не возвращает очки в рейтинг,
   - что ack event:reward:ok не даёт призу выпасть повторно.

   Запуск:  node tools/smoke-season.mjs
   ============================================================ */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const PORT = 8801 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? ' → ' + extra : '')); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class TestClient {
  constructor(tag) {
    this.tag = tag;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.pending = new Map();
    this.handlers = new Map();
    this.id = 1;
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error(tag + ': ws error'));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.rid != null && this.pending.has(m.rid)) {
        const p = this.pending.get(m.rid);
        this.pending.delete(m.rid);
        if (m.t.includes(':err') || m.err) p.rej(new Error(m.msg || 'err'));
        else p.res(m);
      }
      const hs = this.handlers.get(m.t) || [];
      for (const h of hs) h(m);
    };
  }
  on(t, fn) { this.handlers.set(t, (this.handlers.get(t) || []).concat(fn)); }
  send(t, data = {}, timeout = 5000) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ ...data, t, rid: id }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('таймаут ' + t)); }
      }, timeout);
    });
  }
  wait(t, ms = 8000) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(this.tag + ': не дождался ' + t)), ms);
      this.handlers.set(t, [function (m) { clearTimeout(timer); res(m); }]);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const dbFile = path.join(ROOT, 'server', 'data', 'smoke-season-db.json');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.rmSync(dbFile, { force: true });

/* Рисуем «прошедший» сезон прямо в базе: топ-1 игрок (+клану) и
   топ-2 клана уже имеют очки, и сезон уже истёк. login по токену —
   секрет пароля в тесте не нужен. */
const now = Date.now();
const SALT = 'a1b2c3d4e5f60718';
const hash = (p) => crypto.pbkdf2Sync(p, SALT, 60000, 32, 'sha256').toString('hex');
const SEED = {
  accounts: {
    1: { id: 1, name: 'Призер', salt: SALT, pass: hash('pass1234'), token: 'tokA',
         created: now - 1000, lastSeen: now, state: { coins: 0, totalCoins: 0, skin: 'normal', eventTickets: 5 },
         clanId: 1, seasonScore: 100, skin: 'normal', pendingReward: 0 },
    2: { id: 2, name: 'КланБоец', salt: SALT, pass: hash('pass1234'), token: 'tokB',
         created: now - 1000, lastSeen: now, state: { coins: 0, totalCoins: 0, skin: 'normal', eventTickets: 0 },
         clanId: 1, seasonScore: 10, skin: 'normal', pendingReward: 0 }
  },
  clans: {
    1: { id: 1, name: 'Лидеры', owner: 1, members: [1, 2], code: 'LEAD1',
         treasury: 0, bonus: 0, score: 100, created: now - 1000 }
  },
  tokens: { tokA: 1, tokB: 2 },
  byName: { 'призер': 1, 'кланбоец': 2 },
  clanByCode: { LEAD1: 1 },
  seq: 3,
  seasonEnd: now - 5000,     /* сезон уже истёк → первый тик раздаёт призы */
  seasonNum: 1
};
fs.writeFileSync(dbFile, JSON.stringify(SEED));

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_FILE: dbFile, SEASON_MS: '86400000' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; process.stderr.write('[srv] ' + d); });
process.on('exit', () => { try { srv.kill(); } catch {} });
process.on('exit', () => { try { fs.rmSync(dbFile, { force: true }); } catch {} });

async function main() {
  let up = false;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch {}
    await sleep(100);
  }
  if (!up) throw new Error('сервер не поднялся:\n' + srvLog);

  const A = new TestClient('A');
  const B = new TestClient('B');
  await Promise.all([A.ready, B.ready]);

  /* вешаем ожидания ДО входа: приз может прийти и от первого тика,
     и push-ем прямо в login() — оба пути отдают event:reward */
  const rewardA = A.wait('event:reward', 8000);
  const rewardB = B.wait('event:reward', 8000);
  const seasonEnd = B.wait('event:season:end', 8000);
  const reg = await A.send('resume', { token: 'tokA' });
  ok('вход A по токену', reg.t === 'auth:ok', reg.t);
  await B.send('resume', { token: 'tokB' });
  ok('вход B по токену', true);

  /* топ-1 игрок (50000) + участник топ-1 клана (50000) = 100000;
     топ-2 игрок (25000) + участник топ-1 клана (50000) = 75000 */
  const ra = await rewardA;
  ok('A получил приз: 100000', ra.coins === 100000, JSON.stringify(ra));
  const rb = await rewardB;
  ok('B получил приз: 75000', rb.coins === 75000, JSON.stringify(rb));
  const se = await seasonEnd;
  ok('всем пришло event:season:end со сводкой',
    se.season === 1 && se.newSeason === 2 &&
    se.players[0].name === 'Призер' && se.players[0].reward === 50000 &&
    se.players[1].name === 'КланБоец' && se.players[1].reward === 25000 &&
    se.clans[0].name === 'Лидеры' && se.clans[0].reward === 50000,
    JSON.stringify(se));

  const lbEv = await A.send('lb', { sort: 'event' });
  ok('очки сезона сброшены в лидерборде', lbEv.rows.every(r => !r.seasonScore), JSON.stringify(lbEv.rows));

  /* поддельный сейв не возвращает очки в рейтинг нового сезона */
  const saved = await B.send('save', { state: { eventTickets: 0, eventSeasonScore: 999999 } });
  ok('сейв с eventSeasonScore принят', saved.t === 'save:ok', saved.t);
  const lbCheat = await B.send('lb', { sort: 'event' });
  const me = lbCheat.rows.find(r => r.name === 'КланБоец');
  ok('очки не накачиваются поддельным сейвом', !me || !me.seasonScore, JSON.stringify(me));

  /* ack списывает долг — при повторном входе приз не задублируется */
  await A.send('event:reward:ok', {});
  let extra = null;
  A.on('event:reward', m => { extra = m; });
  await A.send('auth:logout', {});
  await A.send('auth:login', { name: 'Призер', pass: 'pass1234' });
  await sleep(600);
  ok('повторный приз не выдан после ack', extra === null, JSON.stringify(extra));

  const info = await A.send('event:info');
  ok('новый сезон: season=2, myScore=0', info.season === 2 && info.myScore === 0, JSON.stringify(info));

  A.close(); B.close();
}
main().then(() => {
  console.log(`\nСезон: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
}, (e) => {
  console.error('Сезон упал:', e.message);
  console.error(srvLog.split('\n').slice(-10).join('\n'));
  process.exit(1);
});