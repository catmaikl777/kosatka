/* ============================================================
   Бэкап базы в приватный репозиторий GitHub.

   Зачем: на хостинге без постоянного тома файловая система контейнера
   затирается при каждом редеплое, и все аккаунты пропадают. Держать
   копию рядом бесполезно — она исчезнет вместе с контейнером. Поэтому
   снимок базы уходит в отдельный ПРИВАТНЫЙ репозиторий, а при старте
   с пустой базой сервер поднимает её оттуда.

   ВАЖНО: репозиторий с бэкапами должен быть приватным — в снимке лежат
   хеши паролей и токены сессий.

   Переменные окружения (задаются в панели платформы):
     BACKUP_REPO     owner/name приватного репозитория, напр. catmaikl777/kosatka-data
     BACKUP_TOKEN    токен GitHub с правом contents:write на этот репозиторий
     BACKUP_PATH     путь файла в репозитории (по умолчанию db.json)
     BACKUP_BRANCH   ветка (по умолчанию main)
     BACKUP_EVERY_MS как часто проверять изменения (по умолчанию 5 минут)
     BACKUP_API      адрес API (по умолчанию api.github.com; нужен для GitHub Enterprise)

   Без BACKUP_REPO/BACKUP_TOKEN модуль полностью выключен и ничего не
   делает — локальная разработка и тесты не затронуты.
   ============================================================ */
'use strict';

const crypto = require('crypto');

const DEFAULTS = {
  path: 'db.json',
  branch: 'main',
  api: 'https://api.github.com',
  everyMs: 300000,   /* раз в 5 минут */
  timeoutMs: 8000,
  minEveryMs: 30000  /* чаще — смысла нет, упрёмся в лимит GitHub */
};

const MIN_EVERY_MS = 30000;

/* Настройки бэкапа. Возвращает { on: false, warn } если выключен или
   сконфигурирован с ошибкой — сервер тогда просто не бэкапит. */
function readConfig(env) {
  const e = env || process.env;
  const repo = String(e.BACKUP_REPO || '').trim();
  const token = String(e.BACKUP_TOKEN || '').trim();
  if (!repo && !token) return { on: false };
  if (!repo || !token) {
    return { on: false, warn: 'BACKUP_REPO и BACKUP_TOKEN должны быть заданы вместе — бэкап выключен' };
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { on: false, warn: 'BACKUP_REPO должен быть вида owner/repo, получено: ' + repo };
  }
  const every = +(e.BACKUP_EVERY_MS || 0) || DEFAULTS.everyMs;
  return {
    on: true,
    repo: repo,
    token: token,
    path: String(e.BACKUP_PATH || DEFAULTS.path).replace(/^\/+/, ''),
    branch: String(e.BACKUP_BRANCH || DEFAULTS.branch),
    api: String(e.BACKUP_API || DEFAULTS.api).replace(/\/+$/, ''),
    everyMs: Math.max(MIN_EVERY_MS, every),
    timeoutMs: DEFAULTS.timeoutMs
  };
}

function contentsUrl(c) {
  return c.api + '/repos/' + c.repo + '/contents/' + c.path +
    '?ref=' + encodeURIComponent(c.branch);
}

function headers(c, json) {
  const h = {
    Authorization: 'Bearer ' + c.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pixel-orca-server'
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function errText(res) {
  try {
    const t = await res.text();
    return String(t || '').slice(0, 200);
  } catch (e) {
    return '';
  }
}

/* Снимок с GitHub: { sha, json } либо null, если файла ещё нет. */
async function fetchSnapshot(fetchImpl, c) {
  const res = await fetchImpl(contentsUrl(c), { headers: headers(c), signal: AbortSignal.timeout(c.timeoutMs) });
  if (res.status === 404) return null;           /* снимка ещё нет — это не ошибка */
  if (res.status === 401 || res.status === 403) {
    throw new Error('GitHub ' + res.status + ' — токен не проходит или нет доступа к ' + c.repo +
      ' (нужен contents:write). ' + await errText(res));
  }
  if (!res.ok) throw new Error('GitHub ' + res.status + ': ' + await errText(res));
  const j = await res.json();
  return {
    sha: j && j.sha,
    json: Buffer.from(String((j && j.content) || '').replace(/\s/g, ''), 'base64').toString('utf8')
  };
}

/* Записать снимок. sha обязателен для обновления существующего файла. */
async function pushSnapshot(fetchImpl, c, json, sha) {
  const body = {
    message: 'db: автосохранение',
    content: Buffer.from(json, 'utf8').toString('base64'),
    branch: c.branch
  };
  if (sha) body.sha = sha;
  const res = await fetchImpl(contentsUrl(c), {
    method: 'PUT',
    headers: headers(c, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(c.timeoutMs)
  });
  if (!res.ok) {
    const err = new Error('GitHub ' + res.status + ': ' + await errText(res));
    err.status = res.status;
    throw err;
  }
  const j = await res.json();
  return (j && j.content && j.content.sha) || sha || null;
}

/* Модуль бэкапа.
   getJson()  -> текущая база строкой
   applyJson() -> подставить разобранный снимок в память
   fetchImpl  -> подменяется в тестах, по умолчанию глобальный fetch */
function create(opts) {
  const o = opts || {};
  const c = readConfig(o.env);
  const fetchImpl = o.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const state = {
    on: !!(c && c.on),
    last: null,        /* когда последний раз успешно записали */
    error: null,       /* последняя ошибка, чтобы была видна в /api/health */
    pushes: 0,
    restores: 0
  };
  if (!state.on) {
    if (c && c.warn) state.error = c.warn;
    return { config: c, state: state, restore: async () => null, flush: async () => false, start: () => null, stop: () => null };
  }
  if (!fetchImpl) {
    state.on = false;
    state.error = 'в этой сборке Node нет fetch — бэкап недоступен';
    return { config: c, state: state, restore: async () => null, flush: async () => false, start: () => null, stop: () => null };
  }

  let sha = null;        /* sha последнего известного снимка в репозитории */
  let lastHash = null;   /* хеш того, что мы уже отправили */
  let timer = null;

  /* База пустая после рестарта (файла не было) — воскрешаем из снимка. */
  async function restore() {
    try {
      const snap = await fetchSnapshot(fetchImpl, c);
      if (!snap) { state.error = null; return null; }
      sha = snap.sha;
      if (typeof o.applyJson === 'function') o.applyJson(snap.json);
      lastHash = crypto.createHash('sha1').update(snap.json).digest('hex');
      state.restores++;
      state.last = new Date().toISOString();
      state.error = null;
      return true;
    } catch (e) {
      state.error = e.message;
      return null;
    }
  }

  /* Отдать снимок, если база менялась. force — записать даже без изменений
     (например, на SIGTERM: лучше лишний коммит, чем потерянные аккаунты). */
  async function flush(force) {
    if (typeof o.getJson !== 'function') return false;
    const json = o.getJson();
    const hash = crypto.createHash('sha1').update(json).digest('hex');
    if (!force && hash === lastHash) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        sha = await pushSnapshot(fetchImpl, c, json, sha);
        lastHash = hash;
        state.pushes++;
        state.last = new Date().toISOString();
        state.error = null;
        return true;
      } catch (e) {
        /* 409 = файл успели изменить — перечитываем sha и пробуем ещё раз */
        if (e.status === 409 && attempt === 0 && !sha) {
          try {
            const snap = await fetchSnapshot(fetchImpl, c);
            if (snap) sha = snap.sha;
            continue;
          } catch (e2) { state.error = e2.message; return false; }
        }
        state.error = e.message;
        return false;
      }
    }
    return false;
  }

  function start() {
    if (timer) return timer;
    timer = setInterval(() => { flush(false).catch(() => { /* ошибка уже в state */ }); }, c.everyMs);
    if (timer.unref) timer.unref();   /* не держим процесс ради бэкапа */
    return timer;
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { config: c, state: state, restore: restore, flush: flush, start: start, stop: stop };
}

module.exports = { create, readConfig, fetchSnapshot, pushSnapshot, DEFAULTS, MIN_EVERY_MS };
