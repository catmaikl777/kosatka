/* Тест PostgreSQL-хранилища без живого сервера.
   Подменяем require('pg') фейковым пулом, который понимает ровно те
   запросы, которые шлёт store-pg.js: SELECT/DELETE/INSERT ... ON CONFLICT.
   Так проверяется вся логика — дифф-запись, индексы, seq/seasonEnd,
   удаления, «пустое» сохранение — в CI, где живого PG нет. */
'use strict';
const path = require('path');
const assert = require('assert');
const fs = require('fs');

/* ---- маленький фейк пула поверх массивов-таблиц ---- */
let lastFake = null;
function makeFake(seed) {
  const T = {
    accounts: (seed.accounts || []).map((r) => Object.assign({}, r)),
    clans: (seed.clans || []).map((r) => Object.assign({}, r)),
    meta: (seed.meta || []).map((r) => Object.assign({}, r))
  };
  const queries = [];
  function exec(q, p) {
    p = p || [];
    queries.push({ q: q, p: p });
    if (/CREATE TABLE/i.test(q)) return { rows: [] };
    if (/SELECT id, data FROM accounts/i.test(q)) return { rows: T.accounts.map((r) => ({ id: r.id, data: r.data })) };
    if (/SELECT id, data FROM clans/i.test(q)) return { rows: T.clans.map((r) => ({ id: r.id, data: r.data })) };
    if (/SELECT key, value FROM meta/i.test(q)) return { rows: T.meta.map((r) => ({ key: r.key, value: r.value })) };
    if (/DELETE FROM accounts/i.test(q)) { T.accounts = T.accounts.filter((r) => r.id !== p[0]); return { rows: [] }; }
    if (/DELETE FROM clans/i.test(q)) { T.clans = T.clans.filter((r) => r.id !== p[0]); return { rows: [] }; }
    if (/INSERT INTO accounts/i.test(q)) {
      const ex = T.accounts.find((r) => r.id === p[0]);
      const row = { id: p[0], name: p[1], lname: p[2], token: p[3], data: p[4] };
      if (ex) Object.assign(ex, row); else T.accounts.push(row);
      return { rows: [] };
    }
    if (/INSERT INTO clans/i.test(q)) {
      const ex = T.clans.find((r) => r.id === p[0]);
      const row = { id: p[0], name: p[1], lname: p[2], code: p[3], data: p[4] };
      if (ex) Object.assign(ex, row); else T.clans.push(row);
      return { rows: [] };
    }
    if (/INSERT INTO meta/i.test(q)) {
      const pairs = [[p[0], p[1]], [p[2], p[3]]];
      for (const [k, v] of pairs) {
        const ex = T.meta.find((r) => r.key === k);
        if (ex) ex.value = v; else T.meta.push({ key: k, value: v });
      }
      return { rows: [] };
    }
    return { rows: [] };
  }
  /* query() вызываем как настоящий pg: (text) | (text, values) | (text, values, cb).
     Лишний аргумент обязан падать (как в pg), а не молча игнорироваться —
     иначе ошибка «callback is not a function» просочится в прод. */
  function run(...args) {
    const q = args[0], p = args[1] || [], cb = args[2];
    if (args.length > 2) throw new Error('callback is not a function');
    const r = exec(q, p);
    if (cb) cb(null, r);
    return r;
  }
  const pool = {
    on() {},
    query(...args) { return Promise.resolve(run.apply(null, args)); },
    connect() { return Promise.resolve({ query(...args) { return Promise.resolve(run.apply(null, args)); }, release() {} }); },
    end() { return Promise.resolve(); }
  };
  return { pool, T, queries };
}
function FakePool() { lastFake = makeFake(global.__pgseed || {}); return lastFake.pool; }

/* Сканер вызовов .query( в исходнике: возвращает [{line, args}].
   Пропускает комментарии и строковые литералы — в SQL запятые есть
   ('VALUES ($1,$2),($3,$4)'), и без этого разбор посчитал бы их аргументами. */
function scanQueryCalls(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '.' && src.slice(i, i + 7) === '.query(') {
      const open = i + 6;
      let depth = 0, commas = 0, hasValue = false;
      let k = open;
      for (; k < n; k++) {
        const ch = src[k];
        if (ch === "'" || ch === '"' || ch === '`') {
          const q = ch; k++;
          while (k < n && src[k] !== q) { if (src[k] === '\\') k++; k++; }
          if (depth === 1) hasValue = true;
          continue;
        }
        if (ch === '/' && src[k + 1] === '/') { while (k < n && src[k] !== '\n') k++; continue; }
        if (ch === '/' && src[k + 1] === '*') { k += 2; while (k < n && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) break; continue; }
        if (ch === ',' && depth === 1) { commas++; continue; }
        if (depth === 1 && !/\s/.test(ch)) hasValue = true;
      }
      if (hasValue) commas++;
      out.push({ line: src.slice(0, open).split('\n').length, args: commas });
      i = k;
      continue;
    }
    i++;
  }
  return out;
}

const pgMock = { Pool: FakePool, types: { setTypeParser() {} } };
/* Подменяем require('pg') целиком, а не правим require.cache: тест должен
   проходить и без установленного драйвера (проверяем логику хранилища,
   а не наличие пакета). */
const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return pgMock;
  return realLoad.apply(this, arguments);
};
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@db.example/kosatka';

const STORE_PG = require(path.join(__dirname, '..', 'server', 'store-pg.js'));

let pass = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { console.log('  \x1b[31m✗\x1b[0m ' + msg); process.exitCode = 1; }
}
function newDb() { return { accounts: {}, tokens: {}, clans: {}, byName: {}, clanByCode: {}, seq: 1, seasonEnd: Date.now() + 1e7 }; }
function writes(fake) { return fake.queries.filter((x) => /^(INSERT|DELETE)/i.test(x.q)); }

(async function main() {
  console.log('\n\x1b[1mPostgreSQL-хранилище\x1b[0m');

  /* --- СТАТИЧЕСКАЯ ПРОВЕРКА: query() нельзя звать с тремя аргументами ---
     node-pg различает (text) | (text, values) | (text, values, callback).
     Третий аргумент обязан быть функцией, поэтому СЛУЧАЙНЫЙ лишний массив
     (например `client.query(sql, ['seq','1'], ['seasonEnd','2'])`) даёт
     «callback is not a function» и МОЛЧА ломает всю запись в базу.
     Мок-пул ловит это только на покрытых путях, поэтому дополнительно
     сканируем исходник целиком. */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'store-pg.js'), 'utf8');
    const calls = scanQueryCalls(src);
    const bad = calls.filter((c) => c.args > 2);
    ok(!bad.length, `в store-pg.js ни один query() не зовётся с лишним аргументом (вызовов: ${calls.length})`,
      bad.map((c) => `строка ${c.line}: ${c.args} арг.`).join(' | '));
    ok(calls.length >= 5, 'сканер действительно нашёл вызовы query в store-pg.js', String(calls.length));
    /* и живой пример, что мок действительно ловит такой вызов */
    let threw = null;
    const fake = makeFake({});
    try { fake.pool.query('SELECT 1', ['a'], ['b']); } catch (e) { threw = e.message; }
    ok(threw === 'callback is not a function', 'мок-пул отвергает query() с лишним массивом, как настоящий pg',
      String(threw));
  }

  /* --- загрузка: аккаунты, кланы, индексы, seq --- */
  {
    global.__pgseed = {
      accounts: [
        { id: 1, name: 'Оля', lname: 'оля', token: 'tok1', data: { id: 1, name: 'Оля', token: 'tok1', state: { coins: 5 } } },
        { id: 2, name: 'Bob', lname: 'bob', token: null, data: { id: 2, name: 'Bob', token: null, state: { coins: 7 } } }
      ],
      clans: [{ id: 1, name: 'Клан', lname: 'клан', code: 'ABC', data: { id: 1, name: 'Клан', code: 'ABC' } }],
      meta: [{ key: 'seq', value: '3' }, { key: 'seasonEnd', value: String(Date.now() + 1e7) }]
    };
    const db = newDb();
    const store = STORE_PG.create(db, {});
    const r = await store.load(86400000);
    ok(r.accounts === 2 && r.clans === 1, 'загрузка читает аккаунты и кланы');
    ok(db.accounts[1].name === 'Оля' && db.accounts[2].state.coins === 7, 'состояние аккаунтов восстановлено');
    ok(db.byName['оля'] === 1 && db.byName['bob'] === 2, 'индекс byName пересобран');
    ok(db.tokens['tok1'] === 1 && !db.tokens[null], 'индекс tokens пересобран (без null-ключа)');
    ok(db.clanByCode['ABC'] === 1, 'индекс clanByCode пересобран');
    ok(db.seq === 3, 'seq восстановлен из meta');
    ok(store.backend === 'pg' && store.info().host === 'db.example', 'info() отдаёт хост из DATABASE_URL');
    ok(lastFake.queries.some((x) => /CREATE TABLE IF NOT EXISTS accounts/i.test(x.q)), 'схема создаётся при первом старте');
    await store.close();
  }

  /* --- дифф-запись: меняем один аккаунт — пишем только его --- */
  {
    global.__pgseed = {
      accounts: [
        { id: 1, name: 'A', lname: 'a', token: 't1', data: { id: 1, name: 'A', token: 't1', state: { coins: 1 } } },
        { id: 2, name: 'B', lname: 'b', token: 't2', data: { id: 2, name: 'B', token: 't2', state: { coins: 2 } } }
      ],
      meta: [{ key: 'seq', value: '3' }]
    };
    const db = newDb();
    const store = STORE_PG.create(db, {});
    await store.load(86400000);
    const before = writes(lastFake).length;
    db.accounts[1].state.coins = 99;
    db.seq = 3;
    await store.save();
    const w = writes(lastFake).slice(before);
    const accWrites = w.filter((x) => /INSERT INTO accounts/i.test(x.q));
    ok(accWrites.length === 1, 'изменённый аккаунт пишется один раз (не вся база)');
    ok(accWrites[0].p[0] === 1 && JSON.parse(accWrites[0].p[4]).state.coins === 99, 'в pg уходят правильные id и свежие данные');
    ok(w.some((x) => /INSERT INTO meta/i.test(x.q)), 'seq/seasonEnd фиксируются');
    const metaW = w.find((x) => /INSERT INTO meta/i.test(x.q));
    ok(metaW && metaW.p && metaW.p.length === 4 &&
      metaW.p[0] === 'seq' && metaW.p[2] === 'seasonEnd',
      'meta пишется одним массивом параметров, а не парой аргументов (иначе pg упадёт с «callback is not a function»');
    await store.close();
  }

  /* --- ничего не изменилось — базу не дёргаем --- */
  {
    global.__pgseed = {
      accounts: [{ id: 1, name: 'A', lname: 'a', token: 't1', data: { id: 1, name: 'A', token: 't1', state: { coins: 1 } } }],
      meta: [{ key: 'seq', value: '3' }, { key: 'seasonEnd', value: String(Date.now() + 1e7) }]
    };
    const db = newDb();
    const store = STORE_PG.create(db, {});
    await store.load(86400000);
    const before = writes(lastFake).length;
    db.seq = 3;
    await store.save();
    ok(writes(lastFake).length === before, 'без изменений save() не пишет ничего');
    await store.close();
  }

  /* --- удаление клана уходит в pg --- */
  {
    global.__pgseed = {
      clans: [{ id: 5, name: 'Клан', lname: 'клан', code: 'XYZ', data: { id: 5, name: 'Клан', code: 'XYZ' } }],
      meta: [{ key: 'seq', value: '6' }, { key: 'seasonEnd', value: String(Date.now() + 1e7) }]
    };
    const db = newDb();
    const store = STORE_PG.create(db, {});
    await store.load(86400000);
    const before = writes(lastFake).length;
    delete db.clans[5];
    delete db.clanByCode.XYZ;
    await store.save();
    const w = writes(lastFake).slice(before);
    ok(w.some((x) => /DELETE FROM clans/i.test(x.q) && x.p[0] === 5), 'удалённый клан удаляется в pg');
    await store.close();
  }

  /* --- invalidate: после восстановления из бэкапа всё перезаписывается --- */
  {
    global.__pgseed = { accounts: [], meta: [{ key: 'seq', value: '1' }, { key: 'seasonEnd', value: String(Date.now() + 1e7) }] };
    const db = newDb();
    const store = STORE_PG.create(db, {});
    await store.load(86400000);
    const before = writes(lastFake).length;
    /* сервер подлил снимок из бэкапа в память и сбросил кэш диффа */
    db.accounts[42] = { id: 42, name: 'Из бэкапа', token: 'tk' };
    store.invalidate();
    await store.save();
    const w = writes(lastFake).slice(before);
    ok(w.some((x) => /INSERT INTO accounts/i.test(x.q) && x.p[0] === 42), 'после invalidate восстановленные аккаунты попадают в pg');
    await store.close();
  }

  console.log(`\n  Пройдено: ${pass}, провалено: ${process.exitCode ? 'см. выше' : 0}\n`);
})().catch((e) => { console.error(e); process.exit(1); });
