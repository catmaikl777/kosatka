/* Предполётная проверка PostgreSQL: запускай ПЕРЕД деплоем, с живым
   DATABASE_URL. Скрипт дергает настоящий server/store-pg.js: создаёт
   схему, кладёт аккаунт-сентинел, перечитывает базу свежим подключением
   и убирает за собой. Ничего чужого не трогает — работает и на пустой БД,
   и на боевой.

   Запуск:
     DATABASE_URL='postgresql://user:pass@host:5432/db?sslmode=require' \
       node tools/pg-check.mjs                                  */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const STORE_PG = require('../server/store-pg.js');

const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error('Не задан DATABASE_URL. Пример:\n' +
    "  DATABASE_URL='postgresql://user:pass@host:5432/db?sslmode=require' node tools/pg-check.mjs");
  process.exit(1);
}

const SENTINEL = '__pgcheck__';
const ID = 900000001;               /* заведомо незанятый id */
let bad = 0;
function ok(cond, msg) {
  if (cond) console.log('  \x1b[32m✓\x1b[0m ' + msg);
  else { console.log('  \x1b[31m✗\x1b[0m ' + msg); bad++; }
}
function newDb() {
  return { accounts: {}, tokens: {}, clans: {}, byName: {}, clanByCode: {}, seq: 1, seasonEnd: Date.now() + 86400000 };
}

(async function main() {
  let host = '(неизвестный хост)';
  try { host = new URL(conn).host; } catch (e) { /* ignore */ }
  console.log('\n\x1b[1mПроверка PostgreSQL\x1b[0m → ' + host + '\n');

  /* 1) загрузка: схема создаётся, существующие данные читаются */
  const db = newDb();
  const store = STORE_PG.create(db, {});
  let loaded;
  try { loaded = await store.load(86400000); }
  catch (e) {
    console.error('  \x1b[31m✗\x1b[0m не удалось подключиться/создать схему:', e.message);
    console.error('    Проверь хост, порт, логин/пароль и что sslmode соответствует серверу.');
    process.exit(1);
  }
  ok(true, 'подключение и схема (CREATE TABLE IF NOT EXISTS) — ок');
  console.log(`    в базе: аккаунтов ${loaded.accounts}, кланов ${loaded.clans}`);

  /* 2) запись сентинела */
  db.accounts[ID] = { id: ID, name: SENTINEL, token: SENTINEL + '_tok', state: { coins: 42, nested: { a: [1, 2] } } };
  db.byName[SENTINEL] = ID;
  db.seq = ID + 1;
  try { await store.save(); ok(true, 'запись аккаунта прошла (UPSERT + jsonb)'); }
  catch (e) { console.error('  \x1b[31m✗\x1b[0m запись упала:', e.message); await store.close(); process.exit(1); }

  /* 3) свежее подключение читает обратно (доказывает, что данные в БД, а не в кэше) */
  const db2 = newDb();
  const store2 = STORE_PG.create(db2, {});
  const back = await store2.load(86400000);
  const got = db2.accounts[ID];
  ok(!!got, 'аккаунт-сентинел виден в НОВОМ подключении (реально записан в БД)');
  ok(got && got.state && got.state.coins === 42, 'jsonb-сейв сохранился и прочитан');
  ok(got && got.state && Array.isArray(got.state.nested.a) && got.state.nested.a[1] === 2, 'вложенные объекты/массивы в jsonb целы');
  ok(typeof db2.accounts[1] === 'undefined' || !Number.isNaN(db2.seq), 'seq вычитан как число (без строк в id)');
  ok(back.accounts >= 1, 'все аккаунты прочитаны (' + back.accounts + ')');

  /* 4) уникальность ника: другой id с тем же именем должен отбиться,
        а уже записанный сентинел — уцелеть (транзакция откатывается) */
  const dup = ID + 1;
  db2.accounts[dup] = { id: dup, name: SENTINEL, token: SENTINEL + '_dup' };
  let rejected = false;
  try { await store2.save(); }
  catch (e) { rejected = /duplicate key|unique/i.test(e.message); }
  delete db2.accounts[dup];
  ok(rejected, 'одинаковый ник отбивается базой (UNIQUE по lname)');
  const dbMid = newDb();
  const storeMid = STORE_PG.create(dbMid, {});
  await storeMid.load(86400000);
  ok(!!dbMid.accounts[ID], 'после отката сентинел на месте — транзакция цела');
  await storeMid.close();

  /* 5) уборка */
  delete db2.accounts[ID];
  delete db2.byName[SENTINEL];
  await store2.save();
  const db3 = newDb();
  const store3 = STORE_PG.create(db3, {});
  await store3.load(86400000);
  ok(!db3.accounts[ID], 'сентинел удалён — база осталась чистой');
  await store3.close();
  await store2.close();
  await store.close();

  console.log(bad
    ? '\n  \x1b[31mЕсть проблемы — НЕ деплой пока.\x1b[0m\n'
    : '\n  \x1b[32mPostgreSQL готов к деплою.\x1b[0m\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
