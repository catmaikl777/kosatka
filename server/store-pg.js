/* PostgreSQL-хранилище.
   Включается переменной DATABASE_URL. База — источник истины: аккаунты
   и кланы лежат в своих таблицах, производные индексы (byName, tokens,
   clanByCode) пересобираются при загрузке, а прогресс хранится в jsonb.

   Ключевая оптимизация — дифф-запись. Клиентский сейв весит до 512 КБ,
   и переписывать все записи каждые 2 с было бы расточительно. Поэтому мы
   держим в памяти JSON-строку последней записанной версии каждой записи
   и в pg попадают только реально изменившиеся. */
/* Драйвер грузим лениво. Раньше `require('pg')` стоял на верхнем уровне, и
   контейнер, собранный без `npm install`, падал в CrashLoop на старте —
   сервис становился недоступен целиком, включая попытку починить. Теперь
   отсутствие драйвера не убивает сервис: store.js ловит ошибку и
   переключается на файл, объясняя причину. */
let Pool = null;
function loadPg() {
  if (Pool) return Pool;
  let mod;
  try { mod = require('pg'); }
  catch (e) {
    throw new Error('пакет pg не установлен в образе — собери сервис с ' +
      '`npm install` (или `npm ci`), иначе в PostgreSQL ничего не запишется');
  }
  /* node-pg отдаёт int8/bigint строкой, а id в игре — число. Без этого
     сравнения вида acc.id === 42 ломались бы на загрузке. */
  try { mod.types.setTypeParser(20, function (v) { return v === null ? null : Number(v); }); }
  catch (e) { /* ignore */ }
  Pool = mod.Pool;
  return Pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id        BIGINT PRIMARY KEY,
  name      TEXT NOT NULL,
  lname     TEXT NOT NULL,
  token     TEXT,
  data      JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_lname ON accounts (lname);
CREATE INDEX IF NOT EXISTS accounts_token ON accounts (token);

CREATE TABLE IF NOT EXISTS clans (
  id        BIGINT PRIMARY KEY,
  name      TEXT NOT NULL,
  lname     TEXT NOT NULL,
  code      TEXT,
  data      JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clans_lname ON clans (lname);
CREATE UNIQUE INDEX IF NOT EXISTS clans_code ON clans (code);

CREATE TABLE IF NOT EXISTS meta (
  key       TEXT PRIMARY KEY,
  value     JSONB NOT NULL
);`;

/* JSON-строка записанной версии: id -> json */
function snapshot(map) {
  const out = new Map();
  for (const id in map) out.set(id, JSON.stringify(map[id]));
  return out;
}

function create(db, opts) {
  const conn = process.env.DATABASE_URL;
  const PgPool = loadPg();
  const pool = new PgPool({
    connectionString: conn,
    ssl: /sslmode=require|heroku|neon|supabase|render/.test(conn) ? { rejectUnauthorized: false } : undefined,
    max: 4
  });
  pool.on('error', function (e) { console.error('[pg] ошибка пула:', e.message); });

  let lastAcc = new Map();   /* id -> json последней ЗАПИСАННОЙ версии */
  let lastClan = new Map();
  let lastSeq = 0, lastSeason = 0;
  let firstWrite = true;     /* до первой записи lastAcc пуст — писать всё */

  async function init() {
    await pool.query(SCHEMA);
  }

  function rebuildIndex() {
    db.accounts = db.accounts || {};
    db.clans = db.clans || {};
    db.tokens = {};
    db.byName = {};
    db.clanByCode = {};
    for (const id in db.accounts) {
      const a = db.accounts[id];
      if (a.token) db.tokens[a.token] = a.id != null ? a.id : Number(id);
      if (a.name) db.byName[a.name.toLowerCase()] = a.id != null ? a.id : Number(id);
    }
    for (const id in db.clans) {
      const cl = db.clans[id];
      if (cl.code) db.clanByCode[cl.code] = cl.id != null ? cl.id : Number(id);
    }
  }

  async function load(seasonMs) {
    await init();
    const [a, c, m] = await Promise.all([
      pool.query('SELECT id, data FROM accounts'),
      pool.query('SELECT id, data FROM clans'),
      pool.query('SELECT key, value FROM meta')
    ]);
    db.accounts = {};
    db.clans = {};
    for (const r of a.rows) {
      const acc = r.data;
      acc.id = acc.id != null ? acc.id : Number(r.id);
      db.accounts[acc.id] = acc;
    }
    for (const r of c.rows) {
      const cl = r.data;
      cl.id = cl.id != null ? cl.id : Number(r.id);
      db.clans[cl.id] = cl;
    }
    for (const r of m.rows) {
      if (r.key === 'seq') db.seq = Number(r.value);
      if (r.key === 'seasonEnd') db.seasonEnd = Number(r.value);
    }
    /* Свежую дату не подставляем при просроченном seasonEnd намеренно:
       пусть первый тик сервера выполнит выплату призов и начнёт новый
       сезон (paySeason). Раньше тут же пересчитывали дату, и конец
       сезона проходил молча, без наград. */
    if (!db.seasonEnd) db.seasonEnd = Date.now() + seasonMs;
    if (!db.seq) {
      let maxId = 0;
      for (const id in db.accounts) maxId = Math.max(maxId, Number(id));
      db.seq = maxId + 1;
    }
    rebuildIndex();
    lastAcc = snapshot(db.accounts);
    lastClan = snapshot(db.clans);
    /* запоминаем и meta: иначе первое же save() после загрузки сочтёт,
       что seasonEnd/seq «изменились», и лишний раз дёрнет базу */
    lastSeq = db.seq; lastSeason = db.seasonEnd;
    firstWrite = false;
    return { accounts: a.rows.length, clans: c.rows.length };
  }

  function diff(map, last) {
    const changed = [];
    const removed = [];
    for (const id in map) {
      const json = JSON.stringify(map[id]);
      /* id — ключ объекта, то есть строка; в pg bigint ждём число */
      if (last.get(id) !== json) changed.push({ id: Number(id), obj: map[id], json: json });
    }
    for (const id of last.keys()) {
      if (!(id in map)) removed.push(Number(id));
    }
    return { changed: changed, removed: removed };
  }

  async function save() {
    const a = diff(db.accounts, lastAcc);
    const c = diff(db.clans, lastClan);
    const seq = db.seq, seasonEnd = db.seasonEnd;
    /* ничего не поменялось — не дёргаем базу впустую */
    if (!firstWrite && !a.changed.length && !a.removed.length &&
        !c.changed.length && !c.removed.length &&
        seq === lastSeq && seasonEnd === lastSeason) {
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of a.removed) await client.query('DELETE FROM accounts WHERE id = $1', [r]);
      for (const ch of a.changed) {
        await client.query(
          'INSERT INTO accounts (id, name, lname, token, data) VALUES ($1,$2,$3,$4,$5) ' +
          'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lname=EXCLUDED.lname, ' +
          'token=EXCLUDED.token, data=EXCLUDED.data',
          [ch.id, ch.obj.name || '', String(ch.obj.name || '').toLowerCase(), ch.obj.token || null, ch.json]
        );
      }
      for (const r of c.removed) await client.query('DELETE FROM clans WHERE id = $1', [r]);
      for (const ch of c.changed) {
        await client.query(
          'INSERT INTO clans (id, name, lname, code, data) VALUES ($1,$2,$3,$4,$5) ' +
          'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lname=EXCLUDED.lname, ' +
          'code=EXCLUDED.code, data=EXCLUDED.data',
          [ch.id, ch.obj.name || '', String(ch.obj.name || '').toLowerCase(), ch.obj.code || null, ch.json]
        );
      }
      await client.query(
        'INSERT INTO meta (key, value) VALUES ($1,$2),($3,$4) ' +
        'ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        ['seq', String(seq), 'seasonEnd', String(seasonEnd)]
      );
      await client.query('COMMIT');
      lastAcc = snapshot(db.accounts);
      lastClan = snapshot(db.clans);
      lastSeq = seq; lastSeason = seasonEnd; firstWrite = false;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (x) { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    backend: 'pg',
    file: null,
    load: load,
    save: save,
    invalidate: function () { firstWrite = true; lastAcc = new Map(); lastClan = new Map(); },
    info: function () {
      let host = null;
      try { host = new URL(conn).host; } catch (e) { /* ignore */ }
      return { backend: 'pg', host: host };
    },
    close: function () { return pool.end(); }
  };
}

module.exports = { create: create };
