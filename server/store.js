/* Выбор хранилища: PostgreSQL, если задан DATABASE_URL, иначе JSON-файл.
   Оба бэкенда отдают одинаковый интерфейс, поэтому игровой код (который
   работает с объектом db в памяти) не знает, где лежат данные. */
const PATHS = require('./paths.js');

/* Причина, по которой PostgreSQL не поднялся — показываем в /api/health,
   чтобы «база молча оказалась файловой» нельзя было пропустить. */
let lastError = null;

function create(db, opts) {
  opts = opts || {};
  if (process.env.DATABASE_URL) {
    try {
      const s = require('./store-pg.js').create(db, opts);
      lastError = null;
      return s;
    } catch (e) {
      /* Критерий здесь такой: упасть из-за отсутствующего драйвера нельзя
         ни при каких условиях — иначе контейнер уходит в CrashLoop и
         недоступен вообще, включая попытку починить. Лучше подняться на
         файловой базе с громким предупреждением. */
      lastError = e.message;
      console.error('');
      console.error('  ⚠  ⚠  PostgreSQL НЕ ЗАПУСТИЛСЯ — сервер работает на файловой базе.');
      console.error('     ' + e.message);
      console.error('     Аккаунты НЕ потеряны: они пишутся в файл, но в PostgreSQL');
      console.error('     их не будет. Почини DATABASE_URL и перезапусти сервис.');
      console.error('');
    }
  } else {
    lastError = null;
  }
  return require('./store-file.js').create(db, opts);
}

function fileTarget() {
  return PATHS.resolve();
}

function error() { return lastError; }

module.exports = { create: create, fileTarget: fileTarget, error: error };
