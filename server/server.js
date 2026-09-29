/* ============================================================
   PIXEL ORCA — сервер (Node.js, ноль зависимостей)
   • статика клиента из ../ (index.html, css, js)
   • WebSocket /ws: аккаунты, облачные сейвы, лидерборд,
     кланы, PvP-лобби, рейды 3x3, сезонный ивент
   Запуск:  node server/server.js        (по умолчанию порт 8787)
            PORT=3000 node server/server.js
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : path.resolve(__dirname, '..');

/* Списки скинов/эффектов/улучшений нужны серверу, чтобы не принимать
   от клиента выдуманные id. Берём из общей с клиентом data.js. */
const DATA = (() => {
  try {
    require(path.join(__dirname, '..', 'js', 'data.js'));
    return globalThis.DATA || null;
  } catch (e) {
    console.warn('[server] не удалось загрузить js/data.js:', e.message);
    return null;
  }
})();
/* null = фильтр выключен: если data.js не загрузился, чистить по белому
   списку нельзя — иначе мы бы снесли чужие скины, а не защитили их. */
const SKIN_IDS = DATA ? new Set(DATA.SKINS.map(s => s.id)) : null;
const EFFECT_IDS = DATA ? new Set(DATA.EFFECTS.map(e => e.id)) : null;
const UPG_IDS = DATA ? new Set(DATA.UPGRADES.map(u => u.id)) : null;
/* Хранилище выбирает server/store.js: если задан DATABASE_URL — PostgreSQL,
   иначе JSON-файл, путь к которому подбирает server/paths.js (переменные
   DATA_FILE/DATA_DIR имеют приоритет, иначе выбирается постоянный каталог
   ЗА пределами папки с кодом — иначе деплой затирал бы аккаунты и кланы). */
const PATHS = require('./paths.js');
const BACKUP = require('./backup.js');
const STORE_MOD = require('./store.js');
const USE_PG = !!process.env.DATABASE_URL;

/* Путь к файловой базе выбирается ЛЕНИВО. Пока работает PostgreSQL, путь
   не нужен, а выбирать его на старте впустую нельзя: PATHS.resolve() создаёт
   каталоги на диске, и при откате на файл путь обязан быть ещё раз
   разрешён заново. Поэтому всё про файл живёт в ensureFile(). */
let DB_PATH = null, DB_FILE = null, DB_DIR = null, DB_PERSISTENT = true;
let DB_MOVED_FROM = null, DB_BORN = null, DB_SAME_FS = null;
function ensureFile() {
  if (!DB_PATH) {
    DB_PATH = PATHS.resolve();
    DB_FILE = DB_PATH.file;
    DB_DIR = path.dirname(DB_FILE);
    DB_PERSISTENT = DB_PATH.persistent;
    DB_MOVED_FROM = PATHS.migrateIfNeeded(DB_PATH);
    DB_BORN = PATHS.mark(DB_FILE);
    DB_SAME_FS = PATHS.sameFs(DB_DIR, __dirname);
  }
  return DB_PATH;
}/* публичный адрес сервиса: платформы передают его по-разному.
   Внимание: без скобок '||' перебивает '?:' по приоритету, и при заданном
   PUBLIC_URL/RENDER_EXTERNAL_URL (без FLY_APP_NAME) печатался бы
   https://undefined.fly.dev. */
const FLY_URL = process.env.FLY_APP_NAME ? 'https://' + process.env.FLY_APP_NAME + '.fly.dev' : null;
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || FLY_URL || null;
const MAX_SAVE_BYTES = 512 * 1024;
const SEASON_MS = +(process.env.SEASON_MS || 30 * 86400000);
/* Призы сезона (совпадают с client D.EVENT.playerRewards/clanRewards):
   топ-3 игроков и топ-3 кланов получают косатки, кланы — каждому участнику. */
const SEASON_PLAYER_REWARDS = [50000, 25000, 10000];
const SEASON_CLAN_REWARDS = [50000, 25000, 10000];
const PVP_MS = +(process.env.PVP_MS || 30000);
const RAID_MS = +(process.env.RAID_MS || 60000);
const TICK = +(process.env.TICK || 250);

/* ================= Хранилище ================= */
const db = {
  accounts: {},   /* id -> acc */
  tokens: {},     /* token -> id */
  clans: {},      /* id -> clan */
  byName: {},     /* lower(name) -> id */
  clanByCode: {}, /* code -> id */
  seq: 1,
  seasonEnd: Date.now() + SEASON_MS,
  seasonNum: 1
};

/* Создаём хранилище: PG или файл. Игровой код работает с объектом db
   в памяти, а слой хранения сам решает, куда его писать. Файловый путь
   отдаём лениво — он нужен, только если реально выпал файловый режим. */
const STORE = STORE_MOD.create(db, { resolveFile: ensureFile });

async function loadDb() {
  try {
    const r = await STORE.load(SEASON_MS);
    if (r.fresh) {
      console.log('[db] новая база' + (r.error ? ' (' + r.error + ')' : ''));
      /* сразу фиксируем базу, чтобы следующие рестарты не гадали: для файла
         это создаёт db.json, для PG — первые строки */
      await flushDb();
    } else {
      console.log(`[db] загружено: ${Object.keys(db.accounts).length} аккаунтов, ${Object.keys(db.clans).length} кланов`);
    }
  } catch (e) {
    console.error('[db] не удалось открыть базу:', e.message);
    console.error('[db] сервер стартует с ПУСТОЙ базой — игроки увидят новый мир.');
  }
}
let saveTimer = null;
let dbBrokenWarned = false;
let saveInFlight = null;
let savePending = false;
function saveDb(now) {
  if (now) return flushDb();
  if (saveTimer) return null;
  saveTimer = setTimeout(() => { saveTimer = null; flushDb(); }, 2000);
  return null;
}
/* Запись в БД асинхронная (и для файла, и тем более для PG). Пока идёт
   одна запись, следующие запросы не плодят новые соединения, а пометка
   savePending заставит повторить снимок — иначе изменения, сделанные
   во время записи, молча потерялись бы. */
function flushDb() {
  if (saveInFlight) { savePending = true; return saveInFlight; }
  saveInFlight = Promise.resolve()
    .then(function () { return STORE.save(); })
    .then(function () { dbBrokenWarned = false; }, function (e) {
      console.error('[db] ошибка записи:', e.message);
      if (!dbBrokenWarned) {
        dbBrokenWarned = true;
        console.error('[db] ВНИМАНИЕ: база не сохраняется — прогресс игроков может быть потерян.');
        if (STORE.backend === 'pg') console.error('[db] Проверь DATABASE_URL и доступность PostgreSQL.');
        else console.error('[db] Проверь, что каталог ' + DB_DIR + ' доступен на запись.');
      }
    })
    .then(function () {
      saveInFlight = null;
      if (savePending) { savePending = false; return flushDb(); }
    });
  return saveInFlight;
}
/* Старое имя осталось для shutdown/uncaughtException. */
function writeDb() { return flushDb(); }

/* ================= Утилиты ================= */
const rnd = (n) => crypto.randomBytes(n).toString('hex');
function norm(s) { return String(s == null ? '' : s).trim().slice(0, 24); }
function hash(pass, salt) {
  return crypto.pbkdf2Sync(String(pass), salt, 60000, 32, 'sha256').toString('hex');
}
function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : (def || 0); }
/* Границы честности: клиент присылает свой сейв целиком, поэтому
   значения нужно зажимать, а не просто проверять размер. */
const LIMITS = {
  coins: 1e18, totalCoins: 1e21, fish: 1e15, shells: 1e9, xp: 1e15,
  level: 5000, boxesOpened: 1e9, prestiges: 1e6, eventTickets: 1e9,
  eventCoins: 1e15, eventSeasonScore: 1e18, playTime: 1e13
};
const MAX_ARR = 64;
const MAX_KEYS = 64;

function clampNum(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.min(n, max);
}
function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function cleanList(v, allowed) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string' || out.length >= MAX_ARR) continue;
    if (allowed && !allowed.has(x)) continue;
    if (out.indexOf(x) < 0) out.push(x);
  }
  return out;
}
const MAX_DEPTH = 6;
const MAX_STR = 200;
const MAX_NUM = 1e21;
/* поля, которые чистятся отдельно — их не нужно тащить через deep() */
const HANDLED = {
  upgrades: 1, skinsOwned: 1, effectsOwned: 1, skin: 1, effectsOn: 1, buff: 1
};

/* Глубокая, но ограниченная копия: режет глубину, длины и числа,
   выкидывает функции и ключи, ведущие в прототип. */
function deep(v, d) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'number') return clampNum(v, MAX_NUM);
  if (t === 'boolean') return v;
  if (t === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (t !== 'object') return null;
  if (d >= MAX_DEPTH) return null;
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length && i < MAX_ARR; i++) out.push(deep(v[i], d + 1));
    return out;
  }
  const out = {};
  let n = 0;
  for (const k in v) {
    if (n++ >= MAX_KEYS) break;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    out[k] = deep(v[k], d + 1);
  }
  return out;
}

/* Приводит присланный сейв к ожидаемой форме: обрезает строки,
   зажимает числа, выкидывает неизвестные скины/эффекты/улучшения. */
function cleanState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const o = {};
  /* 1. Числа, по которым строится лидерборд, зажимаем жёстко. */
  for (const k in LIMITS) o[k] = clampNum(s[k], LIMITS[k]);

  /* 2. Всё остальное переносим как есть, но с ограничением глубины,
     длины строк и массивов: клиент сам присылает сейв целиком, а
     белый список полей стёр бы прогресс при входе с другого устройства. */
  for (const k in s) {
    if (k in LIMITS || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (HANDLED[k]) continue;
    if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
    o[k] = deep(s[k], 0);
  }

  /* 3. Поля, за которыми стоит целостность, проверяем по спискам. */
  o.upgrades = {};
  if (s.upgrades && typeof s.upgrades === 'object' && !Array.isArray(s.upgrades)) {
    let n = 0;
    for (const id in s.upgrades) {
      if (n++ >= MAX_KEYS) break;
      if (UPG_IDS && !UPG_IDS.has(id)) continue;
      o.upgrades[id] = clampNum(s.upgrades[id], 1e6);
    }
  }
  o.skinsOwned = cleanList(s.skinsOwned, SKIN_IDS);
  if (o.skinsOwned.indexOf('normal') < 0) o.skinsOwned.unshift('normal');
  o.effectsOwned = cleanList(s.effectsOwned, EFFECT_IDS);
  o.skin = (!SKIN_IDS || SKIN_IDS.has(s.skin)) ? str(s.skin, 32) : 'normal';
  if (o.skinsOwned.indexOf(o.skin) < 0) o.skin = 'normal';

  o.effectsOn = {};
  if (s.effectsOn && typeof s.effectsOn === 'object' && !Array.isArray(s.effectsOn)) {
    let n = 0;
    for (const id in s.effectsOn) {
      if (n++ >= MAX_KEYS) break;
      if (EFFECT_IDS && !EFFECT_IDS.has(id)) continue;
      o.effectsOn[id] = s.effectsOn[id] ? 1 : 0;
    }
  }

  o.buff = {};
  if (s.buff && typeof s.buff === 'object' && !Array.isArray(s.buff)) {
    o.buff = {
      mult: Math.max(1, Math.min(100, clampNum(s.buff.mult, 100))),
      until: clampNum(s.buff.until, 1e13),
      name: str(s.buff.name, 32)
    };
  }
  return o;
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  let json;
  try { json = JSON.stringify(s); } catch (e) { return null; }
  if (!json || json.length > MAX_SAVE_BYTES) return null;
  return cleanState(s);
}
function accPub(a) {
  if (!a) return null;
  return { id: a.id, name: a.name, clan: a.clanId || null };
}
function clanBonus(cl) {
  if (!cl) return 0;
  return (cl.bonus || 0) + (cl.treasury >= 1e6 ? Math.min(0.25, Math.floor(cl.treasury / 1e6) * 0.01) : 0);
}
function clanState(cl, role) {
  if (!cl) return null;
  /* members — подробный список участников ({id, name, role, score}),
     а не число: вкладка «Клан» рисует из него таблицу. Раньше сюда
     приходило число, и список участников был всегда пуст. */
  const members = cl.members.map(mid => {
    const a = db.accounts[mid];
    return {
      id: mid,
      name: a ? a.name : ('#' + mid),
      role: roleIn(cl, mid),
      score: a ? (a.seasonScore || 0) : 0
    };
  });
  return {
    id: cl.id, name: cl.name, code: cl.code, role: role || null,
    members, treasury: Math.floor(cl.treasury),
    bonus: clanBonus(cl), score: Math.floor(cl.score || 0)
  };
}

/* ================= Статика ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  /* базовые заголовки: игра отдаётся и как статика, и как api */
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*'
  };
  if (url === '/api/health') {
    const body = JSON.stringify({
      ok: true, uptime: Math.round(process.uptime()),
      players: clients.size, accounts: Object.keys(db.accounts).length,
      clans: Object.keys(db.clans).length,
      lobbies: lobbies.size, teams: teams.size,
      /* dbPersistent: false — базу по-прежнему затирает деплой */
      dbPersistent: DB_PERSISTENT,
      /* Диагностика переживаемости базы. dbFirst — метка первого запуска
         на этом диске, она не перезаписывается: если после редеплоя её нет
         или дата откатилась — каталог затирается вместе с образом.
         dbSameFs: true — база лежит в слое образа (том не подключён).
         Для PostgreSQL вместо пути на диске важен сам бэкенд: он живёт
         рядом с сервисом и переживает передеплой. */
      dbSource: STORE.backend === 'pg' ? 'postgres' : (DB_PATH ? DB_PATH.source : null),
      dbBackend: STORE.backend,
      dbHost: STORE.info().host || null,
      /* непустое поле = сервер просил PostgreSQL, но не смог и тихо
         перешёл на файл. Мониторинг должен это видеть. */
      dbError: STORE_MOD.error() || null,
      dbFirst: (DB_BORN && DB_BORN.first) || null,
      dbSameFs: DB_SAME_FS,
      /* доступные для записи каталоги на ОТДЕЛЬНОЙ ФС — если платформа
         подключила том, но DATA_FILE смотрит в образ, вент здесь.
         Для PostgreSQL тома не нужны, поэтому и не создаём каталоги. */
      dbVolumes: STORE.backend === 'file' ? PATHS.volumes() : [],
      /* состояние бэкапа: on=false — бэкап не настроен, тогда аккаунты
         переживут рестарт только при наличии тома */
      backup: {
        on: backup.state.on,
        last: backup.state.last,
        error: backup.state.error,
        pushes: backup.state.pushes,
        restores: backup.state.restores
      },
      seasonLeft: Math.max(0, db.seasonEnd - Date.now())
    });
    res.writeHead(closing ? 503 : 200, Object.assign({}, base, { 'Content-Type': 'application/json; charset=utf-8' }));
    return res.end(body);
  }
  let p = decodeURIComponent(url);
  if (p === '/') p = '/index.html';
  /* наружу отдаём только клиентские файлы: /server/* и dot-файлы скрыты */
  const low = p.toLowerCase();
  if (low.startsWith('/server') || low.includes('/.') || low.endsWith('.db') ||
      low.endsWith('.json.tmp') || low.includes('node_modules')) {
    res.writeHead(403, Object.assign({}, base, { 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('403 — закрыто');
  }
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403, Object.assign({}, base, { 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('403');
  }
  fs.stat(file, (stErr, st) => {
    if (stErr || !st.isFile()) {
      res.writeHead(404, Object.assign({}, base, { 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('404 — не найдено. Сайт лежит на GitHub Pages, бэкенд отдаёт только /ws и /api/health.');
    }
    /* ETag по размеру и времени: дешёвая ревалидация, мобильный трафик не тратится впустую */
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const ext = path.extname(file).toLowerCase();
    const headers = Object.assign({}, base, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      /* код и разметку всегда ревалидируем, картинки/шрифты можно кэшировать */
      'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.webmanifest')
        ? 'no-cache' : 'public, max-age=604800',
      'Last-Modified': new Date(st.mtime).toUTCString(),
      'ETag': etag
    });
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
      return res.end();
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

/* ================= WebSocket (RFC 6455, вручную) ================= */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  if (closing) {           /* идёт деплой: новых игроков не берём */
    try { socket.destroy(); } catch (e) { /* ignore */ }
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);

  const c = {
    socket, buf: Buffer.alloc(0), alive: true,
    acc: null, msgCount: 0, msgWindow: Date.now(),
    lobbyId: null, teamId: null,
    frag: null, fragOp: 0,          /* накопитель фрагментированных сообщений */
    overrun: false
  };
  clients.add(c);
  if (head && head.length) c.buf = Buffer.from(head);

  socket.on('data', (d) => { c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d; parse(c); });
  socket.on('error', () => drop(c));
  socket.on('close', () => drop(c));
  send(c, { t: 'hello', v: 1, seasonEnd: db.seasonEnd, players: clients.size });
});

function drop(c) {
  if (!clients.has(c)) return;
  clients.delete(c);
  leaveLobby(c, true);
  leaveTeam(c, true);
  if (c.acc) { c.acc.lastSeen = Date.now(); saveDb(); }
  try { c.socket.destroy(); } catch (e) { /* ignore */ }
}

function parse(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (b.length < 10) return;
      const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
      len = hi * 4294967296 + lo; off = 10;
    }
    let mask = null;
    if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) return;
    let pay = b.slice(off, off + len);
    if (mask) for (let i = 0; i < pay.length; i++) pay[i] ^= mask[i & 3];
    c.buf = b.slice(off + len);

    if (op === 0x8) { drop(c); return; }
    if (op === 0x9) { frame(c, pay, 0xA); continue; }
    if (op === 0xA) { c.alive = true; continue; }
    if (op === 0x0 || op === 0x1 || op === 0x2) {
      /* сообщение может прийти фрагментами (op 0x0 — продолжение):
         копим их и отдаём в handle только после финального фрагмента */
      if (op !== 0x0) c.fragOp = op;
      c.frag = c.frag && c.frag.length ? Buffer.concat([c.frag, pay]) : pay;
      if (c.frag.length > MAX_SAVE_BYTES) { c.frag = null; c.fragOp = 0; drop(c); return; }
      if (!fin) continue;
      const full = c.frag;
      const fullOp = c.fragOp;
      c.frag = null; c.fragOp = 0;
      if (fullOp !== 0x2) handle(c, full.toString('utf8'));   /* 0x2 — бинарный, не используем */
    }
  }
}

function frame(c, payload, op) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeUInt32BE(Math.floor(len / 4294967296), 2);
    head.writeUInt32BE(len >>> 0, 6);
  }
  head[0] = 0x80 | (op == null ? 0x1 : op);
  try { c.socket.write(Buffer.concat([head, payload])); } catch (e) { drop(c); }
}
function send(c, obj) { if (c && clients.has(c)) frame(c, Buffer.from(JSON.stringify(obj))); }
function err(c, t, msg) { send(c, { t: t + ':err', rid: c.lastId, msg: msg }); }

function broadcastLobby(l) {
  const view = lobbyView(l);
  for (const p of l.players) if (p.c) send(p.c, { t: 'pvp:joined', lobby: view, id: p.c.lastId });
  pvpLobbyList();
}
function pvpLobbyList(asker) {
  const rows = [...lobbies.values()].map(lobbyView);
  for (const c of clients) {
    const l = c.lobbyId ? lobbies.get(c.lobbyId) : null;
    const msg = { t: 'pvp:lobbies', rows, my: l ? lobbyView(l) : null };
    if (c === asker) msg.rid = c.lastId;
    send(c, msg);
  }
}
function raidTeamList(asker) {
  const rows = [...teams.values()].map(teamView);
  for (const c of clients) {
    const tm = c.teamId ? teams.get(c.teamId) : null;
    const msg = { t: 'raid:teams', rows, my: tm ? teamView(tm) : null };
    /* Ответ на ПРЯМОЙ запрос помечаем rid — иначе промис API.raidTeams()
       висел до таймаута, и список/«моя комната» не отрисовывались при
       открытии окна. Рассылка идёт без rid: иначе можно было бы задеть
       чужой ожидающий запрос (клиент ищет промис только по rid). */
    if (c === asker) msg.rid = c.lastId;
    send(c, msg);
  }
}

/* ================= Протокол ================= */
function handle(c, raw) {
  if (raw.length > MAX_SAVE_BYTES) return;
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || !m.t) return;
  /* rid — идентификатор запроса (данные могут содержать свой id) */
  c.lastId = m.rid != null ? m.rid : m.id;
  const t = m.t;

  /* антифлуд: 40 сообщений/сек; для кликов боя — 200 (это основной геймплей,
     кликер удерживает 20-30 кликов/с, а клиент шлёт их пачками) */
  const now = Date.now();
  const isClicks = t === 'pvp:clicks' || t === 'raid:clicks';
  const limit = isClicks ? 200 : 40;
  if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgCount = 0; }
  if (++c.msgCount > limit) {
    /* раньше сообщение просто молча терялось и клиент висел до таймаута —
       теперь отвечаем ошибкой, чтобы запрос не выглядел зависшим */
    if (c.msgCount === limit + 1) {
      console.warn('[flood]', t);
      err(c, t, 'слишком много запросов — подожди секунду');
    }
    return;
  }

  const t0 = process.hrtime.bigint();
  try { route(c, t, m); }
  catch (e) { console.error('[ws]', t, e); err(c, t, 'внутренняя ошибка сервера'); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (ms > 200) console.warn(`[slow] ${t} ${ms.toFixed(1)}ms`);
}

function route(c, t, m) {
  /* ---- авторизация ---- */
  if (t === 'auth:register') return authRegister(c, m);
  if (t === 'auth:login') return authLogin(c, m);
  if (t === 'auth:logout') return authLogout(c, m);
  if (t === 'resume') return authResume(c, m);

  const open = t === 'lb' || t === 'clans' || t === 'pvp:lobbies' || t === 'raid:teams' || t === 'event:info';

  if (t === 'save') return saveState(c, m);
  if (t === 'load') return loadState(c);
  if (t === 'lb') return leaderboard(c, m.sort);
  if (t === 'event:info') return eventInfo(c);
  if (t === 'event:exchange') return eventExchange(c, m);
  if (t === 'event:reward:ok') return eventRewardAck(c);

  if (t.indexOf('clan') === 0) return clanRoute(c, t, m, open);
  if (t.indexOf('pvp') === 0) return pvpRoute(c, t, m, open);
  if (t.indexOf('raid') === 0) return raidRoute(c, t, m, open);

  err(c, t, 'неизвестная команда: ' + t);
}

/* ---------- аккаунты ---------- */
function authRegister(c, m) {
  const name = norm(m.name);
  const pass = String(m.pass || '');
  if (name.length < 2) return err(c, 'auth:register', 'ник минимум 2 символа');
  if (pass.length < 4) return err(c, 'auth:register', 'пароль минимум 4 символа');
  const key = name.toLowerCase();
  if (db.byName[key]) return err(c, 'auth:register', 'такой ник уже занят');
  const salt = rnd(8);
  const acc = {
    id: db.seq++, name, salt, pass: hash(pass, salt), token: rnd(24),
    created: Date.now(), lastSeen: Date.now(), state: null, clanId: null,
    seasonScore: 0, skin: 'normal'
  };
  db.accounts[acc.id] = acc;
  db.byName[key] = acc.id;
  db.tokens[acc.token] = acc.id;
  login(c, acc);
  console.log(`[auth] регистрация @${acc.name}`);
  saveDb();
}
function authLogin(c, m) {
  const name = norm(m.name);
  const id = db.byName[name.toLowerCase()];
  const acc = id && db.accounts[id];
  if (!acc || acc.pass !== hash(String(m.pass || ''), acc.salt)) {
    return err(c, 'auth:login', 'неверный ник или пароль');
  }
  acc.token = rnd(24);
  db.tokens[acc.token] = acc.id;
  login(c, acc);
  saveDb();
}
function authResume(c, m) {
  const id = db.tokens[String(m.token || '')];
  const acc = id && db.accounts[id];
  if (!acc) return err(c, 'resume', 'сессия истекла — войди заново');
  login(c, acc);
}
function login(c, acc) {
  c.acc = acc;
  acc.lastSeen = Date.now();
  send(c, { t: 'auth:ok', rid: c.lastId, token: acc.token, account: accPub(acc) });
  const cl = acc.clanId ? db.clans[acc.clanId] : null;
  send(c, { t: 'clan:state', clan: cl ? clanState(cl, roleIn(cl, acc.id)) : null });
  send(c, { t: 'event:info', rid: c.lastId, left: Math.max(0, db.seasonEnd - Date.now()), topScore: topSeasonScore(), myScore: acc.seasonScore || 0, season: db.seasonNum });
  if ((acc.pendingReward || 0) > 0) {
    send(c, { t: 'event:reward', coins: acc.pendingReward, season: db.seasonNum - 1 });
  }
}
function authLogout(c, m) {
  const a = c.acc;
  if (a) { delete db.tokens[a.token]; a.token = null; }
  c.acc = null;
  send(c, { t: 'auth:ok', rid: c.lastId, account: null, loggedOut: true });
  saveDb();
}

/* ---------- сейвы ---------- */
function saveState(c, m) {
  if (!c.acc) return err(c, 'save', 'сначала войди в аккаунт');
  const s = sanitizeState(m.state);
  if (!s) return err(c, 'save', 'сейв отклонён (битый или слишком большой)');
  c.acc.state = s;
  c.acc.skin = norm(s.skin) || 'normal';
  /* Очки сезона — ТОЛЬКО серверная истина: копятся обменом билетов
     (event:exchange), а клиентский сейв их не поднимает. Раньше сейв
     переносил eventSeasonScore в аккаунт, позволяя поднять рейтинг
     правкой сейва, а после сброса сезона старые очки заново воскресали
     на новый сезон. */
  c.acc.savedAt = Date.now();
  /* Членство в клане — ТОЛЬКО серверная истина. Раньше здесь стояло
     `if (s.clan && s.clan.id && !c.acc.clanId) c.acc.clanId = +s.clan.id;`
     — клиентский сейв сам возвращал игроку клан после выхода/удаления,
     из-за чего интерфейс вечно показывал «ты уже в клане», а выйти
     было невозможно. Теперь в сейв попадает лишь серверная проекция. */
  s.clan = c.acc.clanId && db.clans[c.acc.clanId]
    ? { id: db.clans[c.acc.clanId].id, name: db.clans[c.acc.clanId].name,
        role: roleIn(db.clans[c.acc.clanId], c.acc.id) }
    : null;
  saveDb();
  send(c, { t: 'save:ok', rid: c.lastId, savedAt: c.acc.savedAt });
}
function loadState(c) {
  if (!c.acc) return err(c, 'load', 'сначала войди в аккаунт');
  send(c, { t: 'load:ok', rid: c.lastId, state: c.acc.state, savedAt: c.acc.savedAt || 0 });
}

/* ---------- лидерборд ---------- */
function topSeasonScore() {
  let max = 0;
  for (const k in db.accounts) if (db.accounts[k].seasonScore > max) max = db.accounts[k].seasonScore;
  return max;
}
function eventInfo(c) {
  send(c, {
    t: 'event:info', rid: c.lastId,
    left: Math.max(0, db.seasonEnd - Date.now()),
    topScore: topSeasonScore(), players: Object.keys(db.accounts).length,
    season: db.seasonNum,
    myScore: c.acc ? (c.acc.seasonScore || 0) : 0
  });
}
/* клиент применил награду сезона → можно списать долг */
function eventRewardAck(c) {
  if (c.acc && (c.acc.pendingReward || 0) > 0) { c.acc.pendingReward = 0; saveDb(); }
  send(c, { t: 'event:reward:ok', rid: c.lastId });
}
/* обмен билетов сезона на очки своего клана (1 билет = 10 очков) */
function eventExchange(c, m) {
  if (!c.acc) return err(c, 'event:exchange', 'сначала войди в аккаунт');
  const cl = c.acc.clanId && db.clans[c.acc.clanId];
  if (!cl) return err(c, 'event:exchange', 'обмен доступен только в клане');
  const s = c.acc.state;
  if (!s) return err(c, 'event:exchange', 'сначала загрузи прогресс');
  const want = Math.max(1, Math.floor(num(m.n, 1)));
  const have = Math.max(0, Math.floor(num(s.eventTickets, 0)));
  const n = Math.min(want, have);
  if (n < 1) return err(c, 'event:exchange', 'у тебя нет билетов');
  s.eventTickets = have - n;
  const points = n * 10;
  for (const mid of cl.members) {
    const a = db.accounts[mid];
    if (a) a.seasonScore = (a.seasonScore || 0) + points;
  }
  cl.score = (cl.score || 0) + points;
  pushClan(cl);
  saveDb();
  send(c, {
    t: 'event:exchange:ok', rid: c.lastId, tickets: s.eventTickets, points,
    seasonScore: c.acc.seasonScore, clan: clanState(cl, roleIn(cl, c.acc.id))
  });
}
/* ================= Конец сезона =================
   Когда таймер сезона истёк, раздаём призы и начинаем новый сезон:
   - топ-3 игрока по личным очкам → SEASON_PLAYER_REWARDS
   - топ-3 клана по очкам клана → SEASON_CLAN_REWARDS каждому участнику
   Награда кладётся в pendingReward аккаунта и уходит клиенту push-ом
   (event:reward) сразу, если он онлайн, или при следующем входе.
   Клиент подтверждает получение сообщением event:reward:ok — тогда
   долг списывается и не выпадет дважды. */
function findConn(a) {
  for (const c of clients) if (c.acc === a) return c;
  return null;
}
function paySeason() {
  const now = Date.now();
  const players = Object.values(db.accounts)
    .filter(a => (a.seasonScore || 0) > 0)
    .sort((x, y) => (y.seasonScore || 0) - (x.seasonScore || 0))
    .slice(0, SEASON_PLAYER_REWARDS.length);
  const clanTop = Object.values(db.clans)
    .filter(cl => (cl.score || 0) > 0)
    .sort((x, y) => (y.score || 0) - (x.score || 0))
    .slice(0, SEASON_CLAN_REWARDS.length);
  const playerTop = players.map((a, i) => ({ name: a.name, score: a.seasonScore || 0, reward: SEASON_PLAYER_REWARDS[i] || 0 }));
  const clanTopRows = clanTop.map((cl, i) => ({ name: cl.name, score: cl.score || 0, reward: SEASON_CLAN_REWARDS[i] || 0 }));
  const got = {};
  players.forEach((a, i) => { const rw = SEASON_PLAYER_REWARDS[i] || 0; if (rw > 0) got[a.id] = (got[a.id] || 0) + rw; });
  clanTop.forEach((cl, i) => {
    const rw = SEASON_CLAN_REWARDS[i] || 0;
    if (rw <= 0) return;
    for (const mid of cl.members) {
      const a = db.accounts[mid];
      if (a) got[mid] = (got[mid] || 0) + rw;
    }
  });
  for (const id in got) {
    const a = db.accounts[id];
    if (!a) continue;
    a.pendingReward = (a.pendingReward || 0) + got[id];
    const conn = findConn(a);
    if (conn) send(conn, { t: 'event:reward', coins: got[id], season: db.seasonNum });
  }
  for (const k in db.accounts) db.accounts[k].seasonScore = 0;
  for (const k in db.clans) db.clans[k].score = 0;
  db.seasonNum = (db.seasonNum || 1) + 1;
  db.seasonEnd = now + SEASON_MS;
  saveDb(true);
  console.log(`[season] сезон #${db.seasonNum - 1} завершён: ${Object.keys(got).length} призов, новый до ${new Date(db.seasonEnd).toISOString()}`);
  for (const c of [...clients]) send(c, {
    t: 'event:season:end', season: db.seasonNum - 1, newSeason: db.seasonNum,
    left: SEASON_MS, players: playerTop, clans: clanTopRows
  });
}
function leaderboard(c, sort) {
  const rows = Object.values(db.accounts).map(a => {
    const s = a.state || {};
    return {
      id: a.id, name: a.name,
      coins: num(s.totalCoins, 0),
      clicks: num(s.stats && s.stats.clicks, 0),
      wins: num(s.stats && s.stats.pvpWins, 0) + num(s.stats && s.stats.raidWins, 0),
      level: num(s.level, 1),
      seasonScore: a.seasonScore || 0,
      clan: a.clanId && db.clans[a.clanId] ? db.clans[a.clanId].name : null
    };
  });
  const key = sort === 'event' ? 'seasonScore' : (sort === 'level' ? 'level' : (sort === 'clicks' ? 'clicks' : (sort === 'wins' ? 'wins' : 'coins')));
  rows.sort((a, b) => b[key] - a[key] || b.coins - a.coins);
  send(c, { t: 'lb:ok', rid: c.lastId, rows: rows.slice(0, 50), sort: key });
}

/* ---------- кланы ---------- */
function roleIn(cl, id) {
  if (cl.owner === id) return 'owner';
  return cl.members.indexOf(id) >= 0 ? 'member' : null;
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let k = 0; k < 5; k++) c += A[crypto.randomInt(A.length)];
    if (!db.clanByCode[c]) return c;
  }
  return 'C' + rnd(4).toUpperCase();
}
function clanRoute(c, t, m, open) {
  if (t === 'clans') {
    const rows = Object.values(db.clans).map(cl => ({
      id: cl.id, name: cl.name, members: cl.members.length,
      coins: Math.floor(cl.treasury), score: Math.floor(cl.score || 0),
      bonus: clanBonus(cl)
    })).sort((a, b) => b.score - a.score || b.coins - a.coins);
    return send(c, { t: 'clans:ok', rid: c.lastId, rows });
  }
  if (!c.acc) return err(c, t, 'сначала войди в аккаунт');

  if (t === 'clan:create') {
    const name = norm(m.name);
    if (name.length < 2) return err(c, t, 'название слишком короткое');
    for (const k in db.clans) {
      if (db.clans[k].name.toLowerCase() === name.toLowerCase()) return err(c, t, 'клан с таким именем уже есть');
    }
    if (c.acc.clanId) return err(c, t, 'ты уже в клане');
    const cl = {
      id: db.seq++, name, code: newCode(), owner: c.acc.id,
      members: [c.acc.id], treasury: 0, bonus: 0, score: 0, created: Date.now()
    };
    db.clans[cl.id] = cl;
    db.clanByCode[cl.code] = cl.id;
    c.acc.clanId = cl.id;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:create:ok', rid: c.lastId, clan: clanState(cl, 'owner') });
  }
  if (t === 'clan:join') {
    const code = String(m.code || '').toUpperCase().trim();
    const cid = db.clanByCode[code];
    const cl = cid && db.clans[cid];
    if (!cl) return err(c, t, 'клан с таким кодом не найден');
    if (c.acc.clanId) return err(c, t, 'ты уже в клане');
    if (cl.members.length >= 50) return err(c, t, 'клан переполнен');
    cl.members.push(c.acc.id);
    c.acc.clanId = cl.id;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:join:ok', rid: c.lastId, clan: clanState(cl, 'member') });
  }
  if (t === 'clan:leave') {
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (!cl) return err(c, t, 'ты не в клане');
    if (cl.owner === c.acc.id) return err(c, t, 'владелец не может выйти — удали клан или передай владение');
    cl.members = cl.members.filter(x => x !== c.acc.id);
    c.acc.clanId = null;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:leave:ok', rid: c.lastId, clan: null });
  }
  if (t === 'clan:delete') {
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (!cl) return err(c, t, 'ты не в клане');
    if (cl.owner !== c.acc.id) return err(c, t, 'удалить клан может только владелец');
    const members = cl.members.slice();
    for (const mid of members) { const a = db.accounts[mid]; if (a) a.clanId = null; }
    delete db.clans[cl.id];
    delete db.clanByCode[cl.code];
    saveDb();
    /* Каждому бывшему участнику шлём clan:state: null — иначе у всех
       остаётся клон клана в интерфейсе и в сейве, хотя клан уже удалён. */
    for (const mid of members) pushClanState(mid, null);
    return send(c, { t: 'clan:delete:ok', rid: c.lastId, clan: null });
  }
  if (t === 'clan:me') {
    /* Запрос канонического состояния: клиент дёргает его после любой
       мутации, чтобы вкладки не показывали старые данные. */
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (cl) for (const mid of cl.members) {
      if (db.accounts[mid] && db.accounts[mid].clanId !== cl.id) {
        db.accounts[mid].clanId = cl.id;      /* починка разъезда БД */
        cl.members.push(mid);
      }
    }
    return send(c, { t: 'clan:state', rid: c.lastId, clan: cl ? clanState(cl, roleIn(cl, c.acc.id)) : null });
  }
  if (t === 'clan:donate') {
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (!cl) return err(c, t, 'ты не в клане');
    const coins = Math.max(0, Math.floor(num(m.coins, 0)));
    const s = c.acc.state || {};
    if (num(s.coins, 0) < coins) return err(c, t, 'не хватает косаток');
    s.coins = num(s.coins, 0) - coins;
    c.acc.state = s;
    cl.treasury += coins;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:donate:ok', rid: c.lastId, coins, clan: clanState(cl, roleIn(cl, c.acc.id)), left: s.coins });
  }
  err(c, t, 'неизвестная команда клана');
}
function pushClan(cl) {
  for (const mid of cl.members) {
    const a = db.accounts[mid];
    if (!a) continue;
    for (const c of clients) if (c.acc === a) send(c, { t: 'clan:state', clan: clanState(cl, roleIn(cl, a.id)) });
  }
}
/* Точечная рассылка clan:state одному аккаунту (в т.ч. clan: null при выходе/удалении). */
function pushClanState(accId, cl) {
  const a = db.accounts[accId];
  if (!a) return;
  for (const c of clients) if (c.acc === a) send(c, { t: 'clan:state', clan: cl });
}

/* ---------- PvP ---------- */
const lobbies = new Map();

function lobbyView(l) {
  return {
    id: l.id, code: l.code, type: l.type, owner: l.ownerName,
    ready: l.players.length > 1 && l.players.every(p => p.ready),
    opponent: l.players[1] ? l.players[1].name : null,
    players: l.players.map(p => p.name)
  };
}
function lobbyOf(c) { return c.lobbyId ? lobbies.get(c.lobbyId) : null; }
function pvpRoute(c, t, m, open) {
  if (t === 'pvp:lobbies') return pvpLobbyList(c);
  if (!c.acc) return err(c, t, 'сначала войди в аккаунт');
  const l = lobbyOf(c);

  if (t === 'pvp:create') {
    if (l) return err(c, t, 'ты уже в лобби');
    const type = m.type === 'closed' ? 'closed' : 'open';
    const lb = {
      id: db.seq++, code: type === 'closed' ? newCode() : null, type,
      ownerId: c.acc.id, ownerName: c.acc.name, ownerSkin: c.acc.skin || 'normal',
      players: [{ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal', ready: false }],
      state: 'wait', scoreA: 0, scoreB: 0, clicksA: 0, clicksB: 0, endAt: 0
    };
    lobbies.set(lb.id, lb);
    c.lobbyId = lb.id;
    pvpLobbyList();
    return send(c, { t: 'pvp:create:ok', rid: c.lastId, lobby: lobbyView(lb) });
  }
  if (t === 'pvp:join' || t === 'pvp:joinCode') {
    if (l) return err(c, t, 'выйди из текущего лобби');
    let lb = null;
    if (t === 'pvp:join') lb = lobbies.get(+m.id);
    else {
      const code = String(m.code || '').toUpperCase().trim();
      lb = [...lobbies.values()].find(x => x.code === code);
    }
    if (!lb) return err(c, t, 'лобби не найдено');
    if (lb.state !== 'wait') return err(c, t, 'бой уже начался');
    if (lb.players.length >= 2) return err(c, t, 'в лобби нет мест');
    lb.players.push({ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal', ready: false });
    c.lobbyId = lb.id;
    broadcastLobby(lb);
    return send(c, { t: 'pvp:join:ok', rid: c.lastId, lobby: lobbyView(lb) });
  }
  if (t === 'pvp:ready') {
    if (!l) return err(c, t, 'ты не в лобби');
    const me = l.players.find(p => p.c === c);
    if (me) me.ready = !!m.ready;
    broadcastLobby(l);
    return send(c, { t: 'pvp:ready:ok', rid: c.lastId });
  }
  if (t === 'pvp:start') {
    if (!l) return err(c, t, 'ты не в лобби');
    if (l.ownerId !== c.acc.id) return err(c, t, 'начать бой может только владелец лобби');
    if (l.players.length < 2) return err(c, t, 'нужен соперник');
    if (l.state !== 'wait') return err(c, t, 'бой уже идёт');
    if (!l.players.every(p => p.ready)) return err(c, t, 'оба игрока должны быть готовы');
    startPvp(l);
    return send(c, { t: 'pvp:start:ok', rid: c.lastId });
  }
  if (t === 'pvp:clicks') {
    if (!l || l.state !== 'play') return send(c, { t: 'pvp:clicks:ok', rid: c.lastId, you: 0, foe: 0, ignored: true });
    const i = l.players.findIndex(p => p.c === c);
    if (i < 0) return;
    const n = Math.max(0, Math.min(50, Math.floor(num(m.n, 1))));
    if (i === 0) { l.scoreA += n; l.clicksA += n; } else { l.scoreB += n; l.clicksB += n; }
    clTickets(c, n);
    return send(c, {
      t: 'pvp:clicks:ok', rid: c.lastId,
      you: i === 0 ? l.scoreA : l.scoreB,
      foe: i === 0 ? l.scoreB : l.scoreA
    });
  }
  if (t === 'pvp:leave') return doLeaveLobby(c, l);
  err(c, t, 'неизвестная команда pvp');
}
function leaveLobby(c) {
  const l = lobbyOf(c);
  if (l) doLeaveLobby(c, l);
}
function startPvp(l) {
  l.state = 'play';
  l.scoreA = l.scoreB = l.clicksA = l.clicksB = 0;
  l.endAt = Date.now() + PVP_MS;
  const [a, b] = l.players;
  send(a.c, { t: 'pvp:start', duration: PVP_MS / 1000, foe: b.name, foeSkin: b.skin, mySkin: a.skin });
  send(b.c, { t: 'pvp:start', duration: PVP_MS / 1000, foe: a.name, foeSkin: a.skin, mySkin: b.skin });
  pvpLobbyList();
  console.log(`[pvp] старт #${l.id}: ${a.name} vs ${b.name}`);
}
function doLeaveLobby(c, l) {
  if (!l) return send(c, { t: 'pvp:leave:ok', rid: c.lastId });
  l.players = l.players.filter(p => p.c !== c);
  c.lobbyId = null;
  if (l.state === 'play') { endPvp(l, true); }
  else {
    if (!l.players.length) lobbies.delete(l.id);
    else if (l.ownerId !== l.players[0].id) { l.ownerId = l.players[0].id; l.ownerName = l.players[0].name; }
    for (const p of l.players) send(p.c, { t: 'pvp:left', lobby: lobbyView(l) });
  }
  pvpLobbyList();
  return send(c, { t: 'pvp:leave:ok', rid: c.lastId });
}
function endPvp(l, aborted) {
  /* Ничья не должна отдавать победу тому, кто стоит первым в лобби:
     сравниваем честно и передаём draw отдельным флагом. */
  const draw = !aborted && Math.floor(l.scoreA) === Math.floor(l.scoreB);
  for (let i = 0; i < 2; i++) {
    const p = l.players[i];
    if (!p || !p.c) continue;
    const mine = i === 0 ? l.scoreA : l.scoreB;
    const theirs = i === 0 ? l.scoreB : l.scoreA;
    const win = !aborted && !draw && mine > theirs;
    const reward = aborted ? 0 : Math.floor((win ? 2000 : draw ? 900 : 400) * 10);
    send(p.c, {
      t: 'pvp:end', you: mine, foe: theirs, win, draw,
      yourClicks: i === 0 ? l.clicksA : l.clicksB,
      reward
    });
    p.c.lobbyId = null;
  }
  lobbies.delete(l.id);
  pvpLobbyList();
}
function leaveLobby(c, silent) {
  const l = lobbyOf(c);
  if (!l) return;
  doLeaveLobby(c, l);
}
function clTickets(c, n) {
  /* 1 билет за каждые 100 кликов в PvP — начисляем в облачном сейве */
  const a = c.acc;
  if (!a || !a.state) return;
  const s = a.state;
  s.pvpTicketAcc = (s.pvpTicketAcc || 0) + n;
  const DIV = 100;
  while (s.pvpTicketAcc >= DIV) {
    s.pvpTicketAcc -= DIV;
    s.eventTickets = (s.eventTickets || 0) + 1;
  }
}

/* ---------- Рейды 3x3 ---------- */
const teams = new Map();

function teamView(t) {
  return {
    id: t.id, owner: t.owner, open: t.open,
    players: t.players.length, names: t.players.map(p => p.name),
    searching: !!t.searching, score: Math.floor(t.score || 0)
  };
}
function teamMembers(t) { return t.players.map(p => p.name); }
function teamOf(c) { return c.teamId ? teams.get(c.teamId) : null; }
function raidRoute(c, t, m, open) {
  if (t === 'raid:teams') return raidTeamList(c);
  if (!c.acc) return err(c, t, 'сначала войди в аккаунт');
  const tm = teamOf(c);

  if (t === 'raid:create') {
    if (tm) return err(c, t, 'ты уже в команде');
    const team = {
      id: db.seq++, owner: c.acc.name, ownerId: c.acc.id, open: m.open !== false,
      players: [{ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal' }],
      score: 0, clicks: 0, searching: false, state: 'wait', foeId: 0, endAt: 0
    };
    teams.set(team.id, team);
    c.teamId = team.id;
    raidTeamList();
    return send(c, { t: 'raid:create:ok', rid: c.lastId, team: teamView(team) });
  }
  if (t === 'raid:join') {
    if (tm) return err(c, t, 'выйди из текущей команды');
    const team = teams.get(+m.id);
    if (!team) return err(c, t, 'команда не найдена');
    if (team.state !== 'wait') return err(c, t, 'рейд уже начался');
    if (team.players.length >= 3) return err(c, t, 'в команде уже 3 игрока');
    team.players.push({ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal' });
    c.teamId = team.id;
    pushTeam(team);
    return send(c, { t: 'raid:join:ok', rid: c.lastId, team: teamView(team) });
  }
  if (t === 'raid:search') {
    if (!tm) return err(c, t, 'создай или вступи в команду');
    if (tm.state === 'play') return send(c, { t: 'raid:search:ok', rid: c.lastId, status: 'searching' });
    const foe = [...teams.values()].find(x => x.id !== tm.id && x.open && x.state === 'wait' && !x.foeId);
    if (!foe) {
      tm.searching = true;
      raidTeamList();
      return send(c, { t: 'raid:search:ok', rid: c.lastId, status: 'searching' });
    }
    startRaid(tm, foe);
    return send(c, { t: 'raid:search:ok', rid: c.lastId, status: 'found', foe: teamView(foe) });
  }
  if (t === 'raid:clicks') {
    if (!tm || tm.state !== 'play') return send(c, { t: 'raid:clicks:ok', rid: c.lastId, you: 0, foe: 0, ignored: true });
    const n = Math.max(0, Math.min(50, Math.floor(num(m.n, 1))));
    tm.clicks += n;
    tm.score += n * 3;
    const foe = tm.foeId ? teams.get(tm.foeId) : null;
    return send(c, {
      t: 'raid:clicks:ok', rid: c.lastId,
      you: Math.floor(tm.score), foe: foe ? Math.floor(foe.score) : 0
    });
  }
  if (t === 'raid:leave') return doLeaveTeam(c, tm);
  err(c, t, 'неизвестная команда рейда');
}
function pushTeam(t) {
  for (const p of t.players) if (p.c) send(p.c, { t: 'raid:team', team: teamView(t) });
}
function startRaid(a, b) {
  a.state = b.state = 'play';
  a.foeId = b.id; b.foeId = a.id;
  a.searching = b.searching = false;
  a.score = b.score = 0;
  a.endAt = b.endAt = Date.now() + RAID_MS;
  sendRaidStart(a, b);
  sendRaidStart(b, a);
  raidTeamList();
  console.log(`[raid] старт #${a.id} vs #${b.id}`);
}
function sendRaidStart(self, foe) {
  for (const p of self.players) {
    if (!p.c) continue;
    send(p.c, {
      t: 'raid:start', duration: RAID_MS / 1000,
      foe: { owner: foe.owner, skin: foe.players[0] ? foe.players[0].skin : 'pirate', players: foe.players.length },
      mates: teamMembers(self)
    });
  }
}
function doLeaveTeam(c, t) {
  if (!t) return;
  t.players = t.players.filter(p => p.c !== c);
  c.teamId = null;
  if (t.state === 'play') { endRaid(t, true); return; }
  if (!t.players.length) teams.delete(t.id);
  else { fixRaidOwner(t); pushTeam(t); }
  raidTeamList();
}
function endRaid(t, aborted) {
  const foe = t.foeId ? teams.get(t.foeId) : null;
  const myScore = Math.floor(t.score), foeScore = foe ? Math.floor(foe.score) : 0;
  /* Раньше первая команда получала win при равенстве, а вторая — нет.
     Теперь ничья честно отдаётся обоим. */
  const draw = !aborted && foe && myScore === foeScore;
  /* игроков НЕ отцепляем от команды (раньше тут стояло p.c.teamId = null):
     иначе после боя команда оставалась в списке «открытых», но my был null —
     панель своей комнаты исчезала, и выйти/удалить её было нечем. */
  for (const p of t.players) {
    if (!p.c) continue;
    send(p.c, {
      t: 'raid:end', you: myScore, foe: foeScore,
      win: !aborted && !draw && myScore > foeScore, draw,
      myClicks: t.clicks
    });
  }
  if (foe) {
    for (const p of foe.players) {
      if (!p.c) continue;
      send(p.c, {
        t: 'raid:end', you: foeScore, foe: myScore,
        win: !aborted && !draw && foeScore > myScore, draw,
        myClicks: foe.clicks
      });
    }
    foe.foeId = 0; foe.state = 'wait'; foe.endAt = 0;
    pushTeam(foe);
  }
  t.foeId = 0; t.state = 'wait'; t.endAt = 0;
  if (!t.players.length) teams.delete(t.id);
  else { pushTeam(t); }
  raidTeamList();
}
function leaveTeam(c) { const t = teamOf(c); if (t) doLeaveTeam(c, t); }

/* ================= Таймеры ================= */
setInterval(() => {
  const now = Date.now();
  /* оба готовы → бой начинается сам (как в королевских баттлах) */
  for (const l of [...lobbies.values()]) {
    if (l.state === 'wait' && l.players.length === 2 && l.players.every(p => p.ready)) startPvp(l);
  }
  for (const l of [...lobbies.values()]) {
    if (l.state !== 'play') continue;
    const secs = Math.max(0, Math.min(PVP_MS / 1000, Math.ceil((l.endAt - now) / 1000)));
    for (let i = 0; i < 2; i++) {
      const p = l.players[i];
      if (!p || !p.c) continue;
      send(p.c, {
        t: 'pvp:tick',
        you: i === 0 ? l.scoreA : l.scoreB,
        foe: i === 0 ? l.scoreB : l.scoreA,
        time: secs
      });
    }
    if (now >= l.endAt) endPvp(l, false);
  }
  for (const t of [...teams.values()]) {
    if (t.state !== 'play') continue;
    const foe = t.foeId ? teams.get(t.foeId) : null;
    if (!foe) { endRaid(t, true); continue; }
    const secs = Math.max(0, Math.min(RAID_MS / 1000, Math.ceil((t.endAt - now) / 1000)));
    for (const p of t.players) {
      if (!p.c) continue;
      send(p.c, { t: 'raid:tick', you: Math.floor(t.score), foe: Math.floor(foe.score), time: secs });
    }
    if (now >= t.endAt) { endRaid(t, false); }
  }
  /* матчмейкинг: соединяем ищущие команды */
  const seeking = [...teams.values()].filter(t => t.searching && t.state === 'wait' && !t.foeId);
  for (let i = 0; i + 1 < seeking.length; i += 2) startRaid(seeking[i], seeking[i + 1]);
  if (now > db.seasonEnd) paySeason();
}, TICK).unref();

setInterval(() => {
  for (const c of [...clients]) {
    if (!c.alive) { drop(c); continue; }
    c.alive = false;
    try { frame(c, Buffer.alloc(0), 0x9); } catch (e) { drop(c); }
  }
}, 25000);

/* ================= Матчмейкинг живых игроков ================= */
/* Никаких ботов на сервере: ищем только настоящих соперников.
   Правило: как только двое ждущих игроков отметились «готов»,
   переносим соперника в лобби и сразу стартуем бой.            */
setInterval(() => {
  const waiting = [...lobbies.values()].filter(l =>
    l.state === 'wait' && l.players.length === 1 && l.players[0].ready && l.players[0].c);
  for (let i = 0; i + 1 < waiting.length; i += 2) {
    const a = waiting[i], b = waiting[i + 1];
    if (a.id === b.id) continue;
    /* переносим игрока из лобби a в лобби b */
    const mover = a.players[0];
    a.players = [];
    lobbies.delete(a.id);
    mover.c.lobbyId = b.id;
    b.players.push(mover);
    b.ownerId = b.players[0].id;
    b.ownerName = b.players[0].name;
    broadcastLobby(b);
    console.log(`[mm] ${b.players[0].name} ↔ ${b.players[1].name}`);
    startPvp(b);
  }
}, 2000).unref();

/* смена владельца лобби при выходе первого игрока (для рейдов) */
function fixRaidOwner(t) {
  if (t.players.length && t.ownerId !== t.players[0].id) {
    t.ownerId = t.players[0].id;
    t.owner = t.players[0].name;
  }
}


/* ---- бэкап в приватный репозиторий GitHub ----
   Если база пуста (деплой без тома, wipe, свежая PostgreSQL) — воскрешаем
   её из снимка, иначе игроки зашли бы в пустой мир. Дальше снимок уходит сам. */
const backup = BACKUP.create({
  getJson: function () { return JSON.stringify(db); },
  applyJson: function (raw) {
    Object.assign(db, JSON.parse(raw));
    /* восстановленные записи сервер не помнит как записанные — сбрасываем
       кэш диффа, иначе они не попадут в базу до первого изменения */
    STORE.invalidate();
  }
});
if (backup.config && backup.config.on) {
  console.log('  бэкап базы: ' + backup.config.repo + ' → ' + backup.config.path +
    ' (каждые ' + Math.round(backup.config.everyMs / 1000) + ' с)');
} else if (backup.state.error) {
  console.log('  бэкап базы выключен: ' + backup.state.error);
}

/* Старт не должен зависеть от GitHub: даже если сеть лежит, сервер
   поднимается (пусть с пустой базой) — иначе платформа убьёт инстанс. */
function boot() {
  server.listen(PORT, HOST, function () {
    const ext = PUBLIC_URL || (HOST === '0.0.0.0' || HOST === '::' ? null : HOST);
    console.log('');
    console.log('  🐋  PIXEL ORCA — сервер запущен');
    console.log('      http://localhost:' + PORT);
    console.log('      ws://localhost:' + PORT + '/ws');
    if (ext) console.log('      публично: ' + ext.replace(/\/+$/, ''));
    if (STORE.backend === 'pg') {
      /* PostgreSQL переживает передеплой сам: это внешний сервис, а не файл
         в слое образа, поэтому предупреждений про эфемерный диск тут нет. */
      console.log('      база: PostgreSQL ' + (STORE.info().host || '') + '  ← переживает редеплой');
    } else {
      console.log('      база: ' + DB_FILE + (DB_PERSISTENT ? '' : '  ← ЭФЕМЕРНО'));
    }
    if (STORE.backend === 'file') {
      console.log('      путь выбран: ' + DB_PATH.source +
        (DB_SAME_FS === false ? ' (отдельный том)' : DB_SAME_FS === true ? ' (внутри образа)' : ''));
    }
    if (DB_BORN && DB_BORN.first) {
      console.log('      этот диск живёт с: ' + DB_BORN.first);
    }
    if (DB_MOVED_FROM) {
      console.log('      база перенесена со старого места: ' + DB_MOVED_FROM);
    }
    if (!DB_PERSISTENT) {
      console.log('');
      console.log('  ⚠  База лежит во временном каталоге и пропадёт при следующем деплое.');
      console.log('     Задай DATA_FILE или DATA_DIR на постоянном диске.');
    } else if (DB_SAME_FS === true) {
      console.log('');
      console.log('  ⚠  Каталог базы — часть образа, а не подключённый том.');
      console.log('     Если деплой пересоздаёт контейнер, аккаунты пропадут.');
      if (backup.config && backup.config.on) {
        console.log('     Спасает бэкап: ' + backup.config.repo + ' — аккаунты восстановятся при старте.');
      } else {
        console.log('     Спасает только бэкап: задай BACKUP_REPO и BACKUP_TOKEN.');
      }
    }
    console.log('      Ctrl+C — остановить');
    console.log('');
  });
}

/* Пустота базы (а не отсутствие файла) решает, воскрешать ли бэкап:
   для PostgreSQL файла нет вовсе, а «база была непустой» — единственный
   честный признак того, что мир не надо поднимать заново. */
function dbIsEmpty() {
  return !Object.keys(db.accounts).length && !Object.keys(db.clans).length;
}

loadDb().then(function () {
  if (backup.config && backup.config.on && dbIsEmpty()) {
    return backup.restore().then(function (restored) {
      if (restored) {
        console.log('  ✔ база восстановлена из бэкапа: аккаунтов ' +
          Object.keys(db.accounts).length + ', кланов ' + Object.keys(db.clans).length);
        return flushDb();   /* снимок из GitHub сразу ложится в базу */
      }
    });
  }
  return null;
}).catch(function (e) {
  console.error('[boot] ошибка на старте:', e && e.message);
}).then(function () {
  if (backup.config && backup.config.on) backup.start();
  boot();
});

/* ================= Мягкое завершение (PaaS деплоит через SIGTERM) =================
   Пока идёт деплой, новые соединения не принимаем, существующие рвём, базу пишем. */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n[boot] ${signal}: останавливаемся, сохраняем базу…`);
  try { server.close(); } catch (e) { /* ignore */ }
  for (const c of [...clients]) { try { c.socket.destroy(); } catch (e) { /* ignore */ } }
  clients.clear();
  /* Запись в базу асинхронная (для PostgreSQL тем более), поэтому дальше
     мы обязаны ДОЖДАТЬСЯ её: иначе SIGTERM убьёт процесс на середине
     запроса и последние секунды прогресса пропадут. Сторож — на случай,
     если БД не отвечает: платформа даёт на завершение считанные секунды. */
  const bye = function () { console.log('[boot] готово, до свидания.'); process.exit(0); };
  const guard = setTimeout(bye, 9000);
  if (guard.unref) guard.unref();
  const saved = writeDb()
    .then(function () { return STORE.close(); })
    .catch(function (e) { console.error('[db] не сохранилась:', e.message); });
  /* снимок в GitHub — страховка от wipe; ждём недолго, но успеваем */
  if (backup.config && backup.config.on) {
    backup.stop();
    saved
      .then(function () { return backup.flush(true); })
      .then((ok) => { if (ok) console.log('[backup] снимок сохранён в ' + backup.config.repo); })
      .catch(() => { /* ошибка уже в backup.state */ })
      .then(bye);
    return;
  }
  saved.then(bye);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => {
  console.error('[fatal] необработанная ошибка:', e && e.stack ? e.stack : e);
  Promise.resolve(writeDb()).catch(() => { /* ignore */ });
  setTimeout(function () { process.exit(1); }, 1500);
});
