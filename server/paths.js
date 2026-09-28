/* Выбор пути к файловой базе.
   Раньше база по умолчанию лежала в server/data/db.json — то есть ВНУТРИ
   рабочей копии. Любой деплой, перезаливающий репозиторий, затирал её, и
   аккаунты с кланами исчезали. Теперь путь выбирается сам и по умолчанию
   уходит за пределы папки с кодом.

   Приоритет (первое доступное):
     1. DATA_FILE  — точный путь к файлу, задаётся вручную;
     2. DATA_DIR   — каталог, к нему добавляется db.json;
     3. /data/kosatka/db.json — конвенция Render / Railway / Fly и Docker-volume;
     4. ~/.kosatka/db.json     — домашний каталог сервисного пользователя:
                    не требует root и не затирается деплоем;
     5. server/data/db.json   — запасной вариант, помечается как непостоянный. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEGACY = path.join(__dirname, 'data', 'db.json');

function writableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function resolve() {
  if (process.env.DATA_FILE) {
    return { file: path.resolve(process.env.DATA_FILE), source: 'DATA_FILE', persistent: true };
  }
  if (process.env.DATA_DIR) {
    return {
      file: path.join(path.resolve(process.env.DATA_DIR), 'db.json'),
      source: 'DATA_DIR', persistent: true
    };
  }
  const candidates = [
    { file: path.join('/data', 'kosatka', 'db.json'), source: '/data' },
    { file: path.join(os.homedir(), '.kosatka', 'db.json'), source: 'home' }
  ];
  for (const c of candidates) {
    if (writableDir(path.dirname(c.file))) return { file: c.file, source: c.source, persistent: true };
  }
  return { file: LEGACY, source: 'legacy', persistent: false };
}

/* Если база уже лежала в старом месте, переносим её на новый путь —
   иначе апгрейд обнулил бы аккаунты.
   Перенос делаем ТОЛЬКО для автоопределённого пути: если оператор (или тест)
   явно указал DATA_FILE/DATA_DIR, копировать в него ничего не будем. */
function migrateIfNeeded(target) {
  try {
    if (target.source === 'DATA_FILE' || target.source === 'DATA_DIR') return null;
    if (target.file === LEGACY) return null;
    if (fs.existsSync(target.file)) return null;
    if (!fs.existsSync(LEGACY)) return null;
    fs.writeFileSync(target.file, fs.readFileSync(LEGACY));
    return LEGACY;
  } catch (e) {
    return null;
  }
}

/* Метка первого запуска на этом диске.
   Лежит рядом с базой и НИКОГДА не перезаписывается. Если после редеплоя
   метка на месте с прежней датой — диск настоящий (volume), если её нет —
   каталог затирается вместе с образом, и никакой путь внутри контейнера
   не спасёт базу: нужен либо volume у платформы, либо внешняя БД. */
function mark(file) {
  const m = file + '.firstborn';
  try {
    if (!fs.existsSync(m)) {
      fs.writeFileSync(m, JSON.stringify({ first: new Date().toISOString() }));
    }
    return JSON.parse(fs.readFileSync(m, 'utf8'));
  } catch (e) {
    return null;
  }
}

/* Каталог базы на отдельной ФС (томе), а не в слое контейнера?
   device id у смонтированного тома отличается от корневого — по нему
   видно, подключён ли volume, ещё до первого редеплоя. */
function sameFs(a, b) {
  try { return fs.statSync(a).dev === fs.statSync(b).dev; }
  catch (e) { return null; }
}

module.exports = { resolve, migrateIfNeeded, writableDir, LEGACY, mark, sameFs };
