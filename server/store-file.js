/* Файловое хранилище: база — один JSON-документ, пишем атомарно
   (временный файл + rename), чтобы рестарт не оставил битую базу.
   Используется, когда DATABASE_URL не задан. */
const fs = require('fs');
const path = require('path');

function create(db, opts) {
  /* Путь просим у вызывающего лениво: в режиме PostgreSQL файл вообще не
     нужен, и выбирать его (а заодно создавать каталоги) на старте впустую
     нельзя — вдруг потом сработает откат на файл. */
  const pathInfo = (opts && opts.resolveFile) ? opts.resolveFile() : { file: opts.file };
  const file = pathInfo.file;
  const dir = path.dirname(file);
  let brokenWarned = false;

  function load(seasonMs) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(db, raw);
      if (!db.seasonEnd) db.seasonEnd = Date.now() + seasonMs;
      return {
        accounts: Object.keys(db.accounts || {}).length,
        clans: Object.keys(db.clans || {}).length
      };
    } catch (e) {
      /* ENOENT — новая база, это не ошибка */
      return { fresh: true, error: e.code === 'ENOENT' ? null : e.message };
    }
  }

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);       /* атомарно: рестарт не оставит битую базу */
      brokenWarned = false;
      return Promise.resolve();
    } catch (e) {
      console.error('[db] ошибка записи:', e.message);
      if (!brokenWarned) {
        brokenWarned = true;
        console.error('[db] ВНИМАНИЕ: база не сохраняется — прогресс игроков будет потерян.');
        console.error('[db] Проверь, что каталог ' + dir + ' существует и доступен на запись (volume/disk).');
      }
      return Promise.reject(e);
    }
  }

  return {
    backend: 'file',
    file: file,
    existed: fs.existsSync(file),
    load: load,
    save: save,
    /* файл перезаписывается целиком — кэшDirty не нужен */
    invalidate: function () {},
    info: function () { return { backend: 'file', file: file }; },
    close: function () { return Promise.resolve(); }
  };
}

module.exports = { create: create };
