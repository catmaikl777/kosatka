/* Выбор хранилища: PostgreSQL, если задан DATABASE_URL, иначе JSON-файл.
   Оба бэкенда отдают одинаковый интерфейс, поэтому игровой код (который
   работает с объектом db в памяти) не знает, где лежат данные. */
const PATHS = require('./paths.js');

function create(db, opts) {
  opts = opts || {};
  if (process.env.DATABASE_URL) {
    return require('./store-pg.js').create(db, opts);
  }
  return require('./store-file.js').create(db, opts);
}

/* Бэкенд выбирается один раз при старте. Путь к файлу нужен только
   для варианта с файлом, но health/startup показывают его всегда. */
function fileTarget() {
  return PATHS.resolve();
}

module.exports = { create: create, fileTarget: fileTarget };
