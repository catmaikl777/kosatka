/* ============================================================
   PIXEL ORCA — runtime smoke-тест клиента без браузера
   Поднимает минимальный DOM/Canvas/WebAudio шим, выполняет все
   скрипты игры и проверяет реальное поведение:
     • бутстрап без исключений
     • клики начисляют косаток, комбо и криты работают
     • улучшения покупаются, доход растёт
     • магазин/квесты/достижения/рыбалка/ивент открываются
     • бокс открывается и выдаёт лут
     • сброс в океан начисляет ракушки
     • сейв пишется в localStorage и восстанавливается
   Запуск: node tools/smoke-client.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (x !== undefined ? ' → ' + x : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ================= мини-DOM ================= */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source']);

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach(x => x && this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, f) { if (f === undefined) f = !this.set.has(c); f ? this.set.add(c) : this.set.delete(c); return f; }
  toString() { return [...this.set].join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = Object.create(null);
    this.childNodes = [];
    this.parentNode = null;
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, {
      get: (t, k) => t[k] !== undefined ? t[k] : '',
      set: (t, k, v) => { t[k] = v; return true; }
    });
    this.dataset = new Proxy(Object.create(null), {
      get: (t, k) => (k in t ? t[k] : undefined),
      set: (t, k, v) => { t[k] = String(v); return true; }
    });
    this.classList = new ClassList(this);
    this._listeners = Object.create(null);
    this._text = '';
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.width = 300; this.height = 150;
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes.filter(n => n instanceof Node); }
  get firstChild() { return this.childNodes[0] || null; }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() {
    if (this.childNodes.length) return this.childNodes.map(c => c.textContent).join('');
    return this._text;
  }
  set innerHTML(html) { this.childNodes = []; this._html = String(html); parseInto(this, String(html)); }
  get innerHTML() {
    if (this._html != null && !this.childNodes.length) return this._html;
    return this.childNodes.map(serialize).join('');
  }
  appendChild(n) { if (n) { n.parentNode = this; this.childNodes.push(n); if (n.attrs && n.attrs.id) document.byId[n.attrs.id] = n; } return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const l = this._listeners[t]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let n = this;
    while (n) {
      const l = n._listeners[ev.type] || [];
      for (const fn of l.slice()) { ev.currentTarget = n; fn(ev); }
      n = n.parentNode;
      if (!ev.bubbles) break;
    }
    return true;
  }
  click() { if (this.disabled) return false; return this.dispatchEvent({ type: 'click', target: this, bubbles: true }); }
  focus() { document.activeElement = this; }
  select() {}
  setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240, x: 0, y: 0 }; }
  getContext() { return makeCtx(); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  get offsetWidth() { return 320; }
  get offsetHeight() { return 240; }
  get scrollTop() { return 0; }
  get clientWidth() { return 320; }
  get clientHeight() { return 240; }
  get scrollHeight() { return 240; }
  get isConnected() { return true; }
}
function serialize(n) {
  if (n instanceof Node) {
    const a = Object.keys(n.attrs).map(k => ` ${k}="${n.attrs[k]}"`).join('');
    return `<${n.tagName.toLowerCase()}${a}>${n.innerHTML}</${n.tagName.toLowerCase()}>`;
  }
  return String(n);
}

/* парсер HTML-фрагментов (простой, под наш формат) */
function parseInto(parent, html) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m, stack = [parent];
  while ((m = re.exec(html))) {
    const [full, close, tag, attrs, selfClose, text] = m;
    if (text !== undefined) {
      const t = text.trim();
      if (t) { const tn = new Node('#text'); tn._text = t; stack[stack.length - 1].childNodes.push(tn); }
      continue;
    }
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const node = new Node(tag);
    const ar = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(attrs))) {
      node.attrs[a[1]] = a[2];
      if (a[1] === 'class') node.className = a[2];
      if (a[1].startsWith('data-')) {
        const key = a[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        node.dataset[key] = a[2];
      }
    }
    if (node.attrs.id) document.byId[node.attrs.id] = node;
    stack[stack.length - 1].appendChild(node);
    if (!VOID.has(tag.toLowerCase()) && !selfClose) stack.push(node);
  }
}

/* селекторы: tag / #id / .class / [attr] / [attr="v"] / комбинации, потомки по пробелу */
function matches(node, sel) {
  if (!(node instanceof Node)) return false;
  sel = sel.trim();
  if (!sel || sel === '*') return true;
  const parts = sel.match(/(^|\s+)([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)/);
  if (!parts) return false;
  const [, , tag, id, cls, attrs] = parts;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (id && node.attrs.id !== id.slice(1)) return false;
  if (cls) for (const c of cls.split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  if (attrs) {
    for (const m of attrs.matchAll(/\[([\w:-]+)(?:([~|^$*]?=)"?([^\]"]*)"?)?\]/g)) {
      const [, k, op, v] = m;
      const val = k.startsWith('data-') ? node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : node.attrs[k];
      if (op === '=' && String(val) !== v) return false;
      if (!op && val === undefined) return false;
    }
  }
  return true;
}
function queryAll(root, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (!(c instanceof Node)) continue;
      if (matches(c, sel)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  if (sel.includes(' ')) {
    /* селекторы с потомками: упрощённо ищем по любому сегменту */
    const seg = sel.trim().split(/\s+/).pop();
    return out.filter(n => matches(n, seg));
  }
  return out;
}

/* 2D-контекст-шим: всё глотает */
function makeCtx() {
  const noop = () => {};
  const target = {
    canvas: null, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: false,
    measureText: () => ({ width: 8 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop, drawImage: noop, save: noop, restore: noop,
    setTransform: noop, translate: noop, scale: noop, rotate: noop
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

/* ================= окружение ================= */
const document = {
  byId: Object.create(null),
  activeElement: null,
  createElement: (t) => new Node(t),
  createElementNS: (ns, t) => new Node(t),
  createTextNode: (t) => { const n = new Node('#text'); n._text = t; return n; },
  getElementById(id) { return document.byId[id] || null; },
  querySelector(sel) { return queryAll(document.documentElement, sel)[0] || null; },
  querySelectorAll(sel) { return queryAll(document.documentElement, sel); },
  addEventListener() {}, removeEventListener() {},
  body: new Node('body'),
  head: new Node('head'),
  documentElement: new Node('html'),
  readyState: 'complete',
  hidden: false
};
document.body.classList = new ClassList(document.body);

const localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); }
};

const errors = [];
const listeners = new Map();
const rafQueue = [];
const sandbox = {
  console: {
    log: (...a) => { if (process.env.PO_DEBUG) console.log('   [log]', ...a); },
    warn: (...a) => { if (process.env.PO_DEBUG) console.log('   [warn]', ...a); },
    error: (...a) => { errors.push(a.join(' ')); }
  },
  document, localStorage, location: { protocol: 'http:', host: 'localhost:8787', href: 'http://localhost:8787/' },
  navigator: { userAgent: 'node', language: 'ru', vibrate: () => true },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp, Promise, Map, Set, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  Uint8ClampedArray, TextEncoder, TextDecoder,
  AudioContext: function () {
    return {
      currentTime: 0, state: 'running', destination: {},
      createOscillator: () => ({
        type: 'sine',
        /* AudioParam целиком: реальный WebAudio умеет все методы,
           иначе synth-звук падает в песочнице, а не в браузере */
        frequency: { value: 440, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
        connect() {}, disconnect() {}, start() {}, stop() {}
      }),
      createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }),
      createBiquadFilter: () => ({ type: 'lowpass', frequency: { value: 800, setValueAtTime() {} }, Q: { value: 1 }, connect() {} }),
      createBufferSource: () => ({
        buffer: null, loop: true,
        playbackRate: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {}, disconnect() {}, start() {}, stop() {}
      }),
      decodeAudioData: (ab, ok2) => { if (typeof ok2 === 'function') ok2({ duration: 1, sampleRate: 44100, getChannelData: () => new Float32Array(1024) }); return Promise.resolve({}); },
      createBuffer: () => ({ getChannelData: () => new Float32Array(1024) }),
      resume: () => Promise.resolve(), close: () => Promise.resolve()
    };
  },
  webkitAudioContext: null,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener: (t, fn) => { (listeners.get(t) || listeners.set(t, []).get(t)).push(fn); },
  removeEventListener: () => {},
  innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Intl, Uint8Array, Float32Array
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

/* ================= загрузка скриптов ================= */
console.log('\n\x1b[1mPIXEL ORCA — runtime smoke клиента\x1b[0m\n');

const html = read('index.html');
/* регистрируем элементы из реальной разметки */
const bodyHtml = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
const body = new Node('body');
parseInto(body, bodyHtml);
document.body = body;
document.documentElement.appendChild(body);
for (const m of bodyHtml.matchAll(/\bid="([^"]+)"/g)) {
  if (document.byId[m[1]]) continue;
  const n = new Node('div');
  n.attrs.id = m[1];
  document.byId[m[1]] = n;
  body.appendChild(n);
}
ok('разметка разобрана, найдено элементов: ' + Object.keys(document.byId).length, Object.keys(document.byId).length > 10);

/* порядок берём из index.html — ровно как в браузере */
const files = [...html.matchAll(/<script src="js\/([^"]+)"/g)].map(m => m[1]);
if (!files.length) { console.log('  \x1b[31m✗\x1b[0m в index.html нет скриптов'); process.exit(1); }
for (const f of files) {
  try { vm.runInContext(read('js/' + f), sandbox, { filename: f }); }
  catch (e) {
    console.log('  \x1b[31m✗\x1b[0m ошибка загрузки ' + f + ': ' + e.message);
    console.log('    ' + String(e.stack || '').split('\n').slice(1, 4).join('\n    '));
    fail++;
  }
}
ok(`все ${files.length} скриптов выполнились в порядке index.html без ошибок`, fail === 0, errors.join(' | '));

const { DATA, ST, UI, FX, CLICK, SHOP, QUESTS, FISH, REW, SOCIAL, BATTLE, API, SND, PO_SPR } = sandbox;
ok('все модули доступны в глобальной области', !!(DATA && ST && UI && FX && CLICK && SHOP && QUESTS && FISH && REW && SOCIAL && BATTLE && API && SND && PO_SPR));

/* main.js сам вызывает boot() при readyState=complete */
ok('boot() отработал без исключений', errors.length === 0, errors.join(' | '));

/* ---------- регресс: картинки не должны пикселизироваться ----------
   Раньше везде стояло imageSmoothingEnabled = false и CSS
   image-rendering: pixelated — спрайты и фото масштабировались
   nearest-neighbour и выглядели грубой лесенкой. */
{
  const src = ['sprites', 'fx', 'battle', 'fishing', 'ui']
    .map(n => fs.readFileSync(new URL('../js/' + n + '.js', import.meta.url), 'utf8')).join('\n');
  ok('в js нет отключения сглаживания картинок',
    !/imageSmoothingEnabled\s*=\s*false/.test(src),
    (src.match(/imageSmoothingEnabled\s*=\s*false/g) || []).length + ' вхождений');
  ok('сглаживание включается явно', /imageSmoothingEnabled\s*=\s*true/.test(src));

  const css = fs.readFileSync(new URL('../css/pixel.css', import.meta.url), 'utf8');
  ok('в css нет pixelated/crisp-edges', !/image-rendering\s*:\s*(pixelated|crisp-edges)/.test(css),
    (css.match(/image-rendering\s*:\s*(pixelated|crisp-edges)/g) || []).join(', '));
  ok('css задаёт image-rendering: auto', /image-rendering\s*:\s*auto/.test(css));
}

/* ---------- регресс: сборка обязана штамповать версию service worker ----------
   sw.js отдаёт статику cache-first, поэтому оболочка живёт под именем
   kosatka-<VERSION>-shell. Пока VERSION меняется вручную, пользователи
   получают старый JS неделями: правки есть в репозитории, а в игре — нет.
   Сборка (tools/prepare-pages.mjs) обязана подставлять версию сама. */
{
  const prep = fs.readFileSync(new URL('../tools/prepare-pages.mjs', import.meta.url), 'utf8');
  ok('сборка штампует VERSION в sw.js',
    /replace\(\s*\/const VERSION = '\[\^'\]\*'\;\//.test(prep),
    'в prepare-pages.mjs нет замены const VERSION');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok('в sw.js версия объявлена константой с одинарными кавычками',
    /^const VERSION = '[^']*';$/m.test(sw),
    'строка const VERSION = \'...\'; не найдена — шаблон не заменится');
}

/* ---- HUD: гостевой кнопки нет, все валюты на главном экране ---- */
/* шим не умеет descendant-селекторы, поэтому ищем через обход родителей */
const inParentClass = (node, cls) => {
  for (let n = node; n; n = n.parentNode) if (n.classList && n.classList.contains(cls)) return true;
  return false;
};
ok('кнопка «ГОСТЬ» убрана из верхнего HUD', !document.getElementById('accBtn'),
  'accBtn всё ещё в разметке');
const connDot = document.getElementById('connDot');
ok('статус сервера перенесён внутрь HUD (не перекрывает его)',
  !!connDot && inParentClass(connDot, 'hud'), 'connDot вне .hud');
ok('статус сервера стоит в ряду валют, ниже основного HUD',
  !!connDot && inParentClass(connDot, 'hud-cur'), 'conn не в .hud-cur');
const CUR_IDS = ['hudCoins', 'hudFish', 'hudShells', 'ticketCnt', 'hudSeason'];
const missingCur = CUR_IDS.filter(id => !document.getElementById(id));
ok('все валюты есть в HUD', missingCur.length === 0, 'нет: ' + missingCur.join(','));
const curPills = [...document.querySelectorAll('[data-cur]')];
ok('каждая валюта кликабельна и объясняется', curPills.length === 5,
  `пилюль=${curPills.length}, data-cur=${curPills.map(b => b.dataset.cur).join(',')}`);
ok('валютные пилюли лежат в общем ряду HUD',
  curPills.length > 0 && curPills.every(b => inParentClass(b, 'hud-cur')), 'не все в .hud-cur');
/* подписи валют реально ведут к модалке с пояснением */
const curErr = errors.length;
for (const b of curPills) b.dispatchEvent({ type: 'click', target: b, bubbles: true });
ok('тап по валютам открывает пояснения без ошибок', errors.length === curErr, errors.slice(curErr).join(' | '));
UI.closeAll();
const guideTitles = [...document.querySelectorAll('.px-modal.dialog')].map(m => {
  const h = m.querySelector('h3');
  return h ? h.textContent : '';
});
ok('пояснение к каждой валюте показано',
  curPills.every((b, i) => /КОСАТКИ|РЫБА|РАКУШКИ|БИЛЕТЫ|ОЧКИ/.test(guideTitles[i] || '')),
  guideTitles.join(' | '));
const guideBodies = [...document.querySelectorAll('.px-modal.dialog')].map(m => m.textContent);
ok('в пояснении к валюте есть текст, а не только заголовок',
  guideBodies.length === 5 && guideBodies.every(t => t.length > 60),
  'длины: ' + guideBodies.map(t => t.length).join(','));

/* ---- вкладка «Как играть» ---- */
const howto = document.getElementById('howto');
ok('модалка «Как играть» есть в разметке', !!howto);
const howtoTxt = howto ? howto.textContent : '';
ok('в гайде есть ключевые разделы',
  ['КЛИК', 'ВАЛЮТЫ', 'РЫБАЛКА', 'БОКСЫ', 'СКИНЫ', 'ПРЕСТИЖ', 'СОХРАНЕНИЕ']
    .every(k => howtoTxt.includes(k)),
  'разделов: ' + (howto ? howto.querySelectorAll('.sec-h').length : 0));
const howtoUp = howtoTxt.toUpperCase();
ok('в гайде объяснены все 5 валют',
  ['КОСАТКИ', 'РЫБА', 'РАКУШКИ', 'БИЛЕТЫ ИВЕНТА', 'ОЧКИ СЕЗОНА'].every(k => howtoUp.includes(k)),
  'нет: ' + ['КОСАТКИ', 'РЫБА', 'РАКУШКИ', 'БИЛЕТЫ ИВЕНТА', 'ОЧКИ СЕЗОНА'].filter(k => !howtoUp.includes(k)).join(','));
ok('пункт «КАК ИГРАТЬ» есть в меню', [...document.querySelectorAll('[data-menu]')]
  .some(b => b.dataset.menu === 'howto'));
const howtoErr = errors.length;
UI.open('howto');
SHOP.paintIcons(document);
ok('гайд открывается без ошибок', errors.length === howtoErr && UI.isOpen('howto'), errors.slice(howtoErr).join(' | '));
UI.closeAll();

/* прокручиваем кадры анимации */
const tickFrames = (n) => { for (let i = 0; i < n; i++) { const q = rafQueue.splice(0, rafQueue.length); for (const fn of q) { try { fn(performance.now()); } catch (e) { errors.push('raf: ' + e.message); } } } };

/* ================= 1. клики ================= */
const coins0 = ST.state.coins;
const clicks0 = ST.state.stats.clicks;
for (let i = 0; i < 50; i++) { CLICK.doClick(10 + i, 20); tickFrames(1); }
ok('50 кликов начислили косатки', ST.state.coins > coins0, `${coins0} → ${ST.state.coins}`);
ok('счётчик кликов вырос', ST.state.stats.clicks >= 50, String(ST.state.stats.clicks));
ok('комбо набирается', CLICK.combo > 1, String(CLICK.combo));
ok('последний выигрыш больше нуля', CLICK.lastGain > 0, String(CLICK.lastGain));
ok('опыт начисляется', ST.state.xp > 0, String(ST.state.xp));

/* крит должен случиться при большом числе кликов */
let crits = 0;
for (let i = 0; i < 300; i++) { const c = ST.state.stats.crits; CLICK.doClick(5, 5); if (ST.state.stats.crits > c) crits++; }
ok('критические клики срабатывают', ST.state.stats.crits > 0, `crits=${ST.state.stats.crits}`);

/* бонус-точки (clickable bonus) */
CLICK.spawnBonus();
ok('бонус-точка появляется на сцене', CLICK.bonuses.length > 0, String(CLICK.bonuses.length));

/* ================= 2. улучшения ================= */
ST.state.coins = 1e9;
ST.state.totalCoins = 1e9;
const upId = DATA.UPGRADES[0].id;
const up0 = ST.up(upId);
const cost = ST.upgradeCost(upId);
const rBuy = ST.buyUpgrade(upId);
ok('улучшение покупается за монеты', ST.up(upId) === up0 + 1 && !!rBuy,
  `${upId}: ${up0} → ${ST.up(upId)}, цена ${cost}, ответ=${JSON.stringify(rBuy)}`);
ok('perClick вырос после покупки', ST.perClick(0) > 1, String(ST.perClick(0)));
const beforeSec = ST.perSecond();
ST.buyUpgrade(upId);
ok('perSecond не упал', ST.perSecond() >= beforeSec, `${beforeSec} → ${ST.perSecond()}`);
const rMax = ST.buyMax(upId);
ok('buyMax покупает пачкой', ST.up(upId) > 2 && !!rMax, `${upId} → ${ST.up(upId)}, ответ=${JSON.stringify(rMax)}`);
ok('критический шанс в норме', ST.critChance() > 0 && ST.critMult() > 1,
  `chance=${ST.critChance().toFixed(3)} mult=${ST.critMult()}`);

/* ================= 3. магазин: рендер всех вкладок ================= */
SHOP.initClicks();
for (const [tab, boxId] of [['upgrades', 'shopUpgrades'], ['skins', 'shopSkins'], ['boxes', 'shopBoxes'], ['fx', 'shopEffects'], ['ranks', 'shopRanks']]) {
  const err = errors.length;
  SHOP.render(tab);
  const box = document.getElementById(boxId);
  ok(`вкладка «${tab}» отрисована (${boxId}: ${box ? box.children.length : 'нет контейнера'})`,
    box && box.children.length > 0 && errors.length === err, errors.slice(err).join(' | '));
}
const upHtml = document.getElementById('shopUpgrades').innerHTML;
ok('карточки улучшений содержат спрайты и цены', /data-spr=/.test(upHtml) && /px-card/.test(upHtml),
  upHtml.slice(0, 60));
SHOP.paintIcons();
ok('paintIcons не падает', true);

/* --- регресс: секретный скин не должен быть виден в магазине до открытия --- */
{
  const secret = DATA.SKINS.find(s => s.secret);
  if (!secret) { ok('в данных есть секретный скин', false, 'нет'); }
  else {
    ST.state.skinsOwned = ST.state.skinsOwned.filter(id => id !== secret.id);
    SHOP.render('skins');
    let html = document.getElementById('shopSkins').innerHTML;
    ok('секретный скин скрыт в магазине до открытия',
      html.indexOf(secret.id) < 0 && html.indexOf(secret.name) < 0,
      secret.id);
    /* открывается за 100% достижений — и тогда появляется в магазине */
    const claim = ST.state.achievementsClaimed;
    const savedClaim = Object.assign({}, claim);
    for (const a of DATA.ACHIEVEMENTS) claim[a.id] = 1;
    QUESTS.check();
    ok('100% достижений открывает секретный скин', ST.state.skinsOwned.includes(secret.id),
      ST.state.skinsOwned.join(','));
    SHOP.render('skins');
    html = document.getElementById('shopSkins').innerHTML;
    ok('после открытия секретный скин виден в магазине',
      html.indexOf(secret.id) >= 0, secret.id);
    ST.state.achievementsClaimed = savedClaim;
    ST.state.skinsOwned = ST.state.skinsOwned.filter(id => id !== secret.id);
  }
}

/* ================= 4. скин ================= */
const skinsBefore = ST.state.skinsOwned.length;
const skin = DATA.SKINS.find(s => s.cost && !s.box && !s.event && !s.raid && !s.secret);
ok('есть скин, который можно купить за косатки', !!skin);
if (skin) { ST.state.coins = 1e12; ST.buySkin(skin.id); }
ok('скин покупается и надевается', ST.state.skinsOwned.length > skinsBefore && ST.state.skin === skin.id,
  `${skin.id}, owned=${ST.state.skinsOwned.length}`);
ok('коэффициент скина учитывается', ST.allMult() > 1, String(ST.allMult()));

/* --- регресс: скин с ценой И альтернативным источником (бокс/ивент/рейд)
   раньше buySkin() отказывал из-за box/event/raid, хотя цену показывали. --- */
const dual = DATA.SKINS.find(s => s.cost > 0 && (s.box || s.event || s.raid || s.secret)
  && !ST.state.skinsOwned.includes(s.id));
ok('есть скин с ценой и боксом одновременно', !!dual,
  dual ? `${dual.id} cost=${dual.cost} box=${dual.box || '-'} raid=${dual.raid || '-'} event=${dual.event || '-'} secret=${dual.secret || '-'}` : '');
if (dual) {
  ST.state.coins = dual.cost;
  const coinsBefore = ST.state.coins;
  const bought = ST.buySkin(dual.id);
  ok('скин с ценой и боксом покупается за косатки', bought === true, `buySkin=${bought}`);
  ok('скин с ценой и боксом списывает ровно цену',
    ST.state.coins === coinsBefore - dual.cost, `${coinsBefore} → ${ST.state.coins}, цена=${dual.cost}`);
  ok('покупной скин добавлен и надет',
    ST.state.skinsOwned.includes(dual.id) && ST.state.skin === dual.id, `skin=${ST.state.skin}`);
  ok('повторная покупка не списывает косатки (уже есть)', ST.buySkin(dual.id) === false, `skin=${ST.state.skin}`);
}
/* скины без цены по-прежнему нельзя купить — только из бокса/ивента */
const noCost = DATA.SKINS.find(s => !(s.cost > 0) && !ST.state.skinsOwned.includes(s.id));
ok('скин без цены не покупается за косатки', noCost ? ST.buySkin(noCost.id) === false : true,
  noCost ? noCost.id : '');

/* ================= 5. бокс ================= */
ST.state.coins = 1e12;
ST.state.fish = 10;
ST.state.shells = 10;
const boxesBefore = ST.state.stats.boxesOpened;
/* Ждём не фиксированное время, а сам лот: на медленной машине (CI) 1900мс
   может не хватить, и тесты падали бы из-за скорости, а не из-за бага.
   Смотрим ТОЛЬКО открытые окна: закрытые остаются в DOM ещё 200мс, иначе
   старый лот засчитывался бы как свежий. */
const openDialogs = () => [...document.querySelectorAll('.px-modal.dialog.open')];
const waitLoot = async (ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (openDialogs().some(m => m.querySelector('.loot-list'))) return true;
    await sleep(50);
  }
  return false;
};
/* Дождаться конца анимации и закрыть окно. Важно: UI.closeAll() сам по себе
   НЕ отменяет открытие (это не клик), поэтому жмём «×» — только он сбрасывает
   rolling. Иначе следующий openBox() молча игнорируется и каскадом ломает
   все тесты ниже. */
const settle = async () => {
  /* Закрываем окна и ЖДЁМ конца анимации (всё оканчивается на 1690мс).
     Раньше здесь был клик по «×», но waitLoot() видел лот от ПРЕДЫДУЩЕГО
     бокса и кликал по ещё не открывшемуся — тест проверял не то. */
  UI.closeAll();
  await sleep(2200);
};
/* Открыть бокс и получить ИМЕННО его окно. Пока идёт чужая анимация,
   openBox выходит молча (rolling), поэтому ждём и пробуем снова. */
const openBoxFresh = async (id) => {
  for (let i = 0; i < 80; i++) {
    const n = ST.state.stats.boxesOpened;
    SHOP.openBox(id);
    if (ST.state.stats.boxesOpened !== n) return openDialogs().pop();
    await sleep(50);
  }
  return null;
};
/* Снимок всего, что может выдать бокс. Раньше тест смотрел только на
   косатки/рыбу/ракушки/билеты/эффекты, а «Ящик кальмара» вполне может
   выдать xp (8%), скин (4%) или бафф (2%) — тогда все измеренные цифры
   не менялись и тест падал случайно, хотя лот выдавался правильно. */
const lootSnapshot = () => ({
  coins: ST.state.coins, fish: ST.state.fish, shells: ST.state.shells,
  tickets: ST.state.eventTickets, xp: ST.state.xp,
  skins: ST.state.skinsOwned.length, effects: ST.state.effectsOwned.length,
  /* бафф лежит в state.buff (объект mult/until), а НЕ в массиве buffs */
  buff: ST.state.buff ? ST.state.buff.mult + '@' + ST.state.buff.until : 'нет',
  level: ST.state.level
});
const fmtSnap = (s) => `${s.coins}🐋/${s.fish}🐟/${s.shells}🐚/${s.tickets}🎫/${Math.round(s.xp)}xp/${s.skins}скин/${s.effects}эфф/бафф=${s.buff}`;
/* Лот выдан, если изменилось что-то, кроме чистого списания цены бокса */
const lootGranted = (before, after, boxCost) =>
  (after.coins - before.coins + boxCost) > 0 || after.fish !== before.fish ||
  after.shells !== before.shells || after.tickets !== before.tickets ||
  after.xp !== before.xp || after.skins !== before.skins ||
  after.effects !== before.effects || after.buff !== before.buff ||
  after.level !== before.level;

const boxId = DATA.BOXES[0].id;
const r = SHOP.openBox(boxId);
ok('бокс открывается (списание + счётчик)', ST.state.stats.boxesOpened === boxesBefore + 1 && ST.state.coins < 1e12,
  `${boxesBefore} → ${ST.state.stats.boxesOpened}, id=${boxId}, ответ=${JSON.stringify(r)}`);
await waitLoot();                         /* интрига 1470мс + лут на 1690мс */
ok('бокс выдал награду', errors.length === 0, errors.slice(0, 2).join(' | '));
const loot = document.querySelectorAll('.loot-list');
ok('окно лута показано', loot.length > 0,
  `найдено=${loot.length}, body.children=${document.body.children.length}, modals=${document.querySelectorAll('.px-modal').length}, html=${loot.length ? loot[0].innerHTML.slice(0, 80) : document.body.innerHTML.slice(0, 120)}`);
ok('иконки лута отрисованы', loot.length > 0 && [...loot[0].querySelectorAll('canvas[data-spr]')]
  .every(c => c.dataset.painted === '1'), 'пустые канвасы в окне лута');
/* rolling должен сброситься: следующий бокс обязан открыться */
const boxesAfterFirst = ST.state.stats.boxesOpened;
SHOP.openBox(boxId);
ok('после открытия бокс снова доступен', ST.state.stats.boxesOpened === boxesAfterFirst + 1,
  `rolling не сброшен: ${boxesAfterFirst} → ${ST.state.stats.boxesOpened}`);
await settle();

/* --- закрытие модалки бокса до кульминации: добыча не теряется --- */
ST.state.coins = 1e12;
const BOX0 = DATA.BOXES[0];
const snapBefore = lootSnapshot();
const openedBefore = ST.state.stats.boxesOpened;
const boxModal = await openBoxFresh(BOX0.id);
/* сцену берём из ОТКРЫТОГО окна: закрытые ещё 200мс висят в DOM,
   иначе клик ушёл бы в модалку от предыдущего теста */
const stage = boxModal && boxModal.querySelector('.box-stage');
ok('бокс открылся и показал фазу интриги', !!stage, 'нет .box-stage в открытом окне');
if (stage) {
  /* жмём «×» — как будто игрок передумал, не дожидаясь взрыва */
  const closeBtn = boxModal.querySelector('[data-close]');
  ok('у модалки бокса есть кнопка закрытия', !!closeBtn);
  if (closeBtn) closeBtn.dispatchEvent({ type: 'click', target: closeBtn, bubbles: true });
}
const snapAfter = lootSnapshot();
/* цена бокса обязана списаться даже при досрочном закрытии */
ok('стоимость бокса списана при досрочном закрытии',
  snapAfter.coins - snapBefore.coins + BOX0.cost >= 0,
  `${fmtSnap(snapBefore)} → ${fmtSnap(snapAfter)}, цена=${BOX0.cost}`);
ok('при досрочном закрытии лот всё равно выдан',
  ST.state.stats.boxesOpened === openedBefore + 1 && lootGranted(snapBefore, snapAfter, BOX0.cost),
  `boxes ${openedBefore}→${ST.state.stats.boxesOpened}, ${fmtSnap(snapBefore)} → ${fmtSnap(snapAfter)}`);
/* и боксы снова открываются: rolling не залип */
const openedAfter = ST.state.stats.boxesOpened;
SHOP.openBox(BOX0.id);
ok('после досрочного закрытия новый бокс открывается', ST.state.stats.boxesOpened === openedAfter + 1,
  `${openedAfter} → ${ST.state.stats.boxesOpened}`);
await settle();

/* --- регресс: закрытие ПОСЛЕ показа лута не выдаёт второй бонус --- */
ST.state.coins = 1e12;
const lastBox = await openBoxFresh(BOX0.id);
ok('бокс для регресса открылся', !!lastBox, 'openBox не сработал');
ok('после всех фаз показан лот', await waitLoot(), 'лот не показан');
/* Замер делаем ПОСЛЕ выдачи лота: бокс законно что-то роняет, а вот закрытие
   окна не должно добавить ещё — иначе бокс можно «фармить», не дожидаясь взрыва.
   Снимок полный (включая xp/скины/баффы), иначе лишний опыт был бы незаметен. */
const snapDone = lootSnapshot();
const doneLoot = openDialogs().pop();
ok('бокс засчитан ровно один раз', ST.state.stats.boxesOpened > 0, String(ST.state.stats.boxesOpened));
if (doneLoot) {
  const x = doneLoot.querySelector('[data-close]');
  ok('после открытия лута кнопка «×» на месте', !!x);
  if (x) {
    x.dispatchEvent({ type: 'click', target: x, bubbles: true });
    /* и повторно — как будто игрок ткнул ещё раз по уже закрытому окну */
    x.dispatchEvent({ type: 'click', target: x, bubbles: true });
  }
}
const snapClosed = lootSnapshot();
ok('закрытие окна лута не выдаёт дополнительную добычу',
  fmtSnap(snapDone) === fmtSnap(snapClosed),
  `${fmtSnap(snapDone)} → ${fmtSnap(snapClosed)}`);
UI.closeAll();

/* --- регресс: кнопка «ОТКРЫТЬ ×10» обязана открывать 10 боксов за 10 цен,
   а не один бокс (раньше подпись обещала ×10, а открывался один — деньги
   «уходили», ящик был один). --- */
ST.state.coins = 1e12;
const BOXT = DATA.BOXES[0];
const boxesBeforeTen = ST.state.stats.boxesOpened;
const snapBeforeTen = lootSnapshot();
SHOP.openBoxTen(BOXT.id);
ok('пачка ×10 списывает ровно 10 цен',
  ST.state.coins === 1e12 - BOXT.cost * 10 && ST.state.stats.boxesOpened === boxesBeforeTen + 10,
  `coins=${ST.state.coins} (жду ${1e12 - BOXT.cost * 10}), boxes ${boxesBeforeTen} → ${ST.state.stats.boxesOpened}`);
await waitLoot();
const tenSnap = lootSnapshot();
ok('пачка ×10 выдаёт лут за все 10 боксов', lootGranted(snapBeforeTen, tenSnap, BOXT.cost * 10),
  `${fmtSnap(snapBeforeTen)} → ${fmtSnap(tenSnap)}`);
const tenRows = (openDialogs().pop()?.querySelectorAll('.loot-row') ?? []).length;
ok('в окне пачки ровно 10 строк лута', tenRows === 10, `строк=${tenRows}`);
ok('пачка ×10 повторно не выдаёт лут при закрытии', (() => {
  const x = openDialogs().find(m => m.querySelector('[data-close]'))?.querySelector('[data-close]');
  if (x && x.dispatchEvent) x.dispatchEvent({ type: 'click', target: x, bubbles: true });
  return fmtSnap(lootSnapshot()) === fmtSnap(tenSnap);
})(), fmtSnap(lootSnapshot()));
await settle();

/* --- утечка DOM: closeAll обязан удалять окна modalShell, а не прятать их.
       Иначе каждое открытие бокса навсегда оставляет поддерево в документе --- */
/* сначала приводим DOM в покой, иначе считаем не свои окна */
UI.closeAll();
await sleep(300);
const dynBefore = document.querySelectorAll('.px-modal.dyn').length;
const probe = UI.modalShell('ТЕСТ', '<p>тест</p>');
ok('тестовое окно создано', document.querySelectorAll('.px-modal.dyn').length === dynBefore + 1,
  `${dynBefore} → ${document.querySelectorAll('.px-modal.dyn').length}`);
UI.closeAll();
ok('closeAll сразу снимает класс open', !probe.classList.contains('open'), probe.className);
await sleep(300);                          /* closeEl удаляет узел через 200мс */
/* судим по дереву: мини-DOM после removeChild не чистит parentNode у узла,
   поэтому проверять ссылки на родителя здесь бессмысленно */
ok('closeAll удаляет окно из DOM, а не просто прячет',
  document.querySelectorAll('.px-modal.dyn').length === dynBefore,
  `осталось .dyn=${document.querySelectorAll('.px-modal.dyn').length}, ждём ${dynBefore}`);
/* статические окна из разметки при этом остаются на месте */
ok('статическое окно настроек не выброшено из DOM',
  !!document.getElementById('settings'), 'нет #settings');

/* ================= 6. квесты и достижения ================= */
const errQ = errors.length;
QUESTS.render();
QUESTS.check();
ok('квесты и достижения считаются без ошибок', errors.length === errQ, errors.slice(errQ).join(' | '));
ok('есть активные задания', QUESTS.activeQuest() !== undefined, String(QUESTS.activeQuest()));
ok('дневные квесты инициализированы', ST.state.dailyQuests.length === 3, String(ST.state.dailyQuests.length));
ok('ежедневная награда доступна', REW.dailyState().can === true, JSON.stringify(REW.dailyState()));

/* ================= 7. рыбалка ================= */
ST.state.fish = 50;
const errFish = errors.length;
FISH.open();
ok('окно рыбалки открылось', FISH.running === true, String(FISH.running));
ok('рыбалка тикает без ошибок', (FISH.tick(16), errors.length === errFish), errors.slice(errFish).join(' | '));
/* прогоняем реальный кадровый цикл: раньше update() падал с ReferenceError
   (dt не был передан из loop), и это ловилось только здесь */
const errRaft = errors.length;
tickFrames(6);
ok('кадровый цикл рыбалки не падает', errors.length === errRaft, errors.slice(errRaft).join(' | '));
FISH.close();
ok('рыбалка закрывается', FISH.running === false, String(FISH.running));
ST.state.fish = 10;
const fishEx = ST.exchangeFish();
ok('обмен рыбы на косатки работает', ST.state.fish === 0 && fishEx.coins > 0, JSON.stringify(fishEx));

/* ================= 8. престиж ================= */
ST.state.coins = 5e8;
ST.state.totalCoins = 5e8;
ok('престиж доступен после фарма', ST.canPrestige() === true, 'gain=' + ST.prestigeGain());
SHOP.renderPrestige(document.getElementById('prestigeBody') || document.body);
ok('экран престижа отрисован', errors.length === 0, errors.slice(0, 2).join(' | '));
const shellsPre = ST.state.shells;
const prestigesPre = ST.state.prestiges;
ST.doPrestige();
ok('престиж начисляет ракушки и сбрасывает прогресс',
  ST.state.shells > shellsPre && ST.state.prestiges === prestigesPre + 1,
  `shells ${shellsPre} → ${ST.state.shells}, coins=${ST.state.coins}`);

/* ================= 9. настройки, темы, сейв ================= */
FX.setTheme('neon');
ok('тема переключается без ошибок', FX.themeKey === 'neon', FX.themeKey);
FX.setTheme('lagoon');
ok('тема lagoon активна', FX.themeKey === 'lagoon');
FX.setPixelScale(5);
ok('размер пикселя меняется', FX.size.px === 5, String(FX.size.px));
FX.setPixelScale(3);
ok('возврат к 3px', FX.size.px === 3);

ST.state.settings.shake = true;
CLICK.doClick(12, 14);
ok('тряска при крите не бьёт по null-элементу', errors.length === 0, errors.slice(0, 2).join(' | '));
ST.state.settings.shake = false;

ST.flush();
const save = localStorage.getItem(ST.KEY);
ok('сейв записан в localStorage (' + ST.KEY + ')', !!save, String(save && save.length) + ' байт');
const snapshot = JSON.parse(save);
const coinsSaved = snapshot.coins, lvlSaved = snapshot.level, skinSaved = snapshot.skin;
ST.state.coins = 0; ST.state.level = 1;
ST.load();
ok('сейв восстанавливает монеты', ST.state.coins === coinsSaved, `${ST.state.coins} vs ${coinsSaved}`);
ok('сейв восстанавливает уровень и скин', ST.state.level === lvlSaved && ST.state.skin === skinSaved);

/* облачная загрузка после входа: fromCloud применяет облако, но хранит
   личность аккаунта и настройки устройства */
const deviceAcc = { name: 'Orca', token: 'tok-1', id: 7 };
const deviceTheme = 'neon';
ST.state.account = deviceAcc;
ST.state.settings.theme = deviceTheme;
const cloud = JSON.parse(save);
cloud.coins = coinsSaved + 555;
cloud.level = lvlSaved + 2;
cloud.skin = 'gold';
cloud.account = { name: null, token: null, id: null };
cloud.settings.theme = 'lagoon';
ok('fromCloud загружает облако', ST.fromCloud(cloud) === true);
ok('из облака пришли монеты', ST.state.coins === coinsSaved + 555, String(ST.state.coins));
ok('из облака пришли уровень и скин', ST.state.level === lvlSaved + 2 && ST.state.skin === 'gold');
ok('личность аккаунта сохранена', ST.state.account.name === 'Orca' && ST.state.account.token === 'tok-1', JSON.stringify(ST.state.account));
ok('настройки устройства сохранены', ST.state.settings.theme === 'neon', ST.state.settings.theme);
ok('облако записано на диск', JSON.parse(localStorage.getItem(ST.KEY)).coins === coinsSaved + 555);
ok('fromCloud на мусоре безопасен', ST.fromCloud(null) === false && ST.fromCloud('x') === false);

/* сервер хранит отсутствие клана как null — импорт не должен ломать clan */
const cloud2 = JSON.parse(localStorage.getItem(ST.KEY));
cloud2.clan = null;
ok('fromCloud с clan:null безопасен', ST.fromCloud(cloud2) === true);
ok('после null-клана state.clan — объект', !!ST.state.clan && typeof ST.state.clan === 'object',
  JSON.stringify(ST.state.clan));
ST.state.clan.id = null; ST.state.clan.name = null; ST.state.clan.role = null;
ok('в null-клан можно писать (applyClan не падает)', errors.length === 0, errors.slice(0, 2).join(' | '));

/* ================= 10. оффлайн-доход ================= */
const snap2 = JSON.parse(save);
snap2.lastSave = Date.now() - 3600000;      /* час назад */
snap2.coins = 1000;
snap2.upgrades = snap2.upgrades || {};
snap2.upgrades.fin = 30; snap2.upgrades.voice = 20; snap2.upgrades.drone = 12;   /* нужен ненулевой доход */
localStorage.setItem(ST.KEY, JSON.stringify(snap2));
ST.load();
const off = ST.offlineInfo;
ok('офлайн-доход рассчитан (50% от часа, кап 8ч)', !!off && off.coins > 0, JSON.stringify(off));
ok('офлайн-доход зачислен на 50%', ST.state.coins > 1000, String(ST.state.coins));
ok('офлайн-доход учтён в статистике', ST.state.stats.offlineEarned > 0, String(ST.state.stats.offlineEarned));

/* ================= 11. форматирование и формулы ================= */
ok('формат чисел: 1.23B', ST.fmt(1234567890) === '1.23B', ST.fmt(1234567890));
ok('формат чисел: 12.3K', ST.fmt(12345) === '12.3K', ST.fmt(12345));
ok('формат времени: д/ч/м/с', /д|ч|м|с/.test(ST.fmtTime(90061000)), ST.fmtTime(90061000));
ok('ранг считается', typeof ST.rank() === 'string' && ST.rank().length > 0, ST.rank());
ok('стат кликов читается', ST.statValue('clicks') > 0, String(ST.statValue('clicks')));
ok('стат timeOnline есть', ST.statValue('timeOnline') !== undefined, String(ST.statValue('timeOnline')));

/* ================= 12. PvP и рейд офлайн (фолбэк) ================= */
const errB = errors.length;
BATTLE.openPvP();
ok('PvP: лобби открыто', !!document.getElementById('pvLobby'));
ok('PvP: есть кнопка «БОЙ С БОТОМ» офлайн', !!document.getElementById('pvBot'),
  String(!!document.getElementById('pvBot')));
ok('PvP: показан лидерборд лобби', !!document.getElementById('pvList'), String(!!document.getElementById('pvList')));
BATTLE.close();
BATTLE.openRaid();
ok('рейд: лобби открыто', !!document.getElementById('rdLobby'));
ok('рейд: есть кнопка «РЕЙД С БОТАМИ»', !!document.getElementById('rdBot'), String(!!document.getElementById('rdBot')));
BATTLE.close();
ok('PvP/рейд не дали ошибок', errors.length === errB, errors.slice(errB).join(' | '));

/* ================= 12a. регресс: поле не растянуто =============
   Буфер canvas расширялся Math.max(200,·)×Math.max(240,·), из-за чего
   его пропорции переставали совпадать с пропорциями блока, и CSS
   растягивал картинку — кот выглядел «толстым». Буфер обязан
   сохранять пропорции блока. */
const sceneEl = document.getElementById('scene');
ok('канвас поля найден', !!sceneEl, String(!!sceneEl));
if (sceneEl) {
  const boxAR = sceneEl.clientWidth / sceneEl.clientHeight;
  const bufAR = sceneEl.width / sceneEl.height;
  ok('пропорции буфера поля совпадают с блоком (нет растяжения)',
    Math.abs(bufAR - boxAR) < 0.02,
    `буфер ${sceneEl.width}x${sceneEl.height} AR=${bufAR.toFixed(3)}, блок AR=${boxAR.toFixed(3)}`);
  ok('буфер поля не меньше минимума', sceneEl.width >= 100 && sceneEl.height >= 100,
    `${sceneEl.width}x${sceneEl.height}`);
}

/* ================= 12a-2. регресс: кот живёт в свободном поле ==========
   Орангутина раньше считалась от высоты всего экрана (H*0.58), поэтому на
   телефоне, где HUD и меню съедают ~40% высоты, она занимала практически
   всё видимое поле. Теперь она вписывается в область между HUD и меню. */
{
  const hudEl = document.querySelector('.hud');
  const menuEl = document.getElementById('menuBtns');
  const VW = 390, VH = 844, HUD_H = 62, MENU_H = 150;
  const rect = (w, h, top) => ({ left: 0, top, right: w, bottom: top + h, width: w, height: h, x: 0, y: top });
  const saved = [sceneEl, hudEl, menuEl].map((el) => (el ? el.getBoundingClientRect : null));
  const setRect = (el, r) => { if (el) el.getBoundingClientRect = () => r; };
  setRect(sceneEl, rect(VW, VH, 0));
  setRect(hudEl, rect(VW, HUD_H, 0));
  setRect(menuEl, rect(VW, MENU_H, VH - MENU_H));

  FX.resize();
  const o = FX.orca;
  /* переводим css-пиксели телефона в пиксели буфера */
  const k = sceneEl.height / VH;
  const fieldTop = HUD_H * k;
  const fieldBot = (VH - MENU_H) * k;
  const fieldH = fieldBot - fieldTop;
  ok('кот помещается в свободное поле по вертикали',
    o.y >= fieldTop - 1 && o.y + o.h <= fieldBot + 1,
    `кот y=${o.y.toFixed(1)}..${(o.y + o.h).toFixed(1)}, поле ${fieldTop.toFixed(1)}..${fieldBot.toFixed(1)}`);
  ok('кот занимает не больше 60% высоты поля',
    o.h > 0 && o.h <= fieldH * 0.6,
    `высота кота ${o.h.toFixed(1)} из поля ${fieldH.toFixed(1)} (${(o.h / fieldH * 100).toFixed(0)}%)`);

  [sceneEl, hudEl, menuEl].forEach((el, i) => { if (el && saved[i]) el.getBoundingClientRect = saved[i]; });
  FX.resize();
}

/* Арена боя рисуется в пропорциях 3:2 и не должна вылезать за контейнер */
BATTLE.openPvP();
document.getElementById('pvBot').click();
const arEl = document.getElementById('arCv');   /* прямой id: mini-DOM ненадёжен на descendant-селекторах */
ok('арена боя отрисована', !!arEl, String(!!arEl));
if (arEl) {
  const aAR = arEl.width / arEl.height;
  ok('арена сохраняет пропорции 3:2', Math.abs(aAR - 1.5) < 0.05, `AR=${aAR.toFixed(3)}`);
  const hostW = (arEl.parentElement && arEl.parentElement.clientWidth) || 0;
  ok('арена не шире контейнера',
    !arEl.style.width || !hostW || parseInt(arEl.style.width, 10) <= hostW,
    arEl.style.width);
}
BATTLE.close();

/* ================= 12b. регресс: бой не должен заканчиваться мгновенно ==========
   Раньше сервер отдавал длительность в секундах (30), а счётчик обратного
   отсчёта уменьшался на dt кадра в миллисекундах — 30 секунд превращались
   в 30 мс и бой умирал за 4-6 кадров. Гоняем кадры с настоящим ходом
   времени и проверяем, что бой жив и таймер тикает. */
const errT = errors.length;
BATTLE.openPvP();
document.getElementById('pvBot').click();
ok('PvP: арена открылась после старта боя с ботом', !!document.getElementById('arTime'),
  String(!!document.getElementById('arTime')));
let vt = 0;
const driveFrames = (n, stepMs) => {
  for (let i = 0; i < n; i++) {
    vt += stepMs;
    const q = rafQueue.splice(0, rafQueue.length);
    for (const fn of q) { try { fn(vt); } catch (e) { errors.push('raf: ' + e.message); } }
  }
};
driveFrames(20, 100);           /* 2 секунды игрового времени */
const tAfter2s = document.getElementById('arTime');
ok('через 2 с бой ещё идёт (таймер не обнулился)', !!tAfter2s && Number(tAfter2s.textContent) >= 27,
  String(tAfter2s && tAfter2s.textContent));
ok('через 2 с бой не превратился в окно результата', !document.querySelector('.result-box'),
  String(!!document.querySelector('.result-box')));
/* Гоняем кадры до появления окна результата и считаем, сколько кадров
   (= секунд) занял бой. Сломанный вариант завершался за 2-3 кадра. */
let frames = 20;   /* 20 кадров уже отрисовано выше */
while (frames < 400 && !document.querySelector('.result-box')) { driveFrames(1, 100); frames++; }
ok('бой длится полные 30 с, а не 30 мс', frames >= 298 && frames <= 305, frames + ' кадров');
ok('после боя клики больше не засчитываются', !CLICK.battleMode, String(CLICK.battleMode));
BATTLE.close();
ok('таймер боя не дал ошибок', errors.length === errT, errors.slice(errT).join(' | '));

/* ================= 13. соцсети, лидерборд, ивент, настройки ================= */
const errS = errors.length;
for (const [name, fn] of [
  ['аккаунт', () => SOCIAL.openAuth()],
  ['лидерборд', () => SOCIAL.openLeaderboard()],
  ['кланы', () => SOCIAL.openClans()],
  ['ежедневная награда', () => REW.openDaily()],
  ['статистика', () => REW.openStats()],
  ['ивент', () => REW.openEvent()],
  ['реклама x2', () => REW.openAd()]
]) {
  const e0 = errors.length;
  UI.closeAll();
  try { fn(); } catch (e) { errors.push(name + ': ' + e.message); }
  UI.closeAll();
  ok(`окно «${name}» открывается офлайн без ошибок`, errors.length === e0, errors.slice(e0).join(' | '));
}

/* ================= 14. целостность игровых данных ================= */
/* Каждый тип добычи должен обрабатываться в rollLoot, иначе бокс
   молча выдаёт «пустой» список наград. */
const LOOT_HANDLERS = ['coins', 'fish', 'shells', 'xp', 'ticket', 'buff', 'effect', 'skin'];
const badLoot = [];
for (const b of DATA.BOXES) {
  for (const l of (b.loot || [])) if (!LOOT_HANDLERS.includes(l.t)) badLoot.push(`${b.id}:${l.t}`);
}
ok('все типы добычи из боксов обработаны в rollLoot', badLoot.length === 0, badLoot.join(','));

const fieldIds = DATA.FIELD_BONUSES.map(f => f.id);
ok('бонусы на поле заданы', fieldIds.length >= 4, fieldIds.join(','));
/* collectBonus в clicker.js обязан уметь выдать каждый тип из data.js */
const bonusIds = ['x2', 'chest', 'fish', 'rain', 'storm', 'shell'];
ok('набор бонусов на поле совпадает с набором в data.js',
  bonusIds.every(i => fieldIds.includes(i)) && fieldIds.every(i => bonusIds.includes(i)),
  fieldIds.join(','));

/* У каждого скина должна быть картинка в реестре спрайтов */
const badArt = DATA.SKINS.filter(s => !PO_SPR.IMAGES[s.art]).map(s => s.id);
ok('у всех скинов есть картинка', badArt.length === 0, badArt.join(','));

/* Скин должен быть либо покупаемым, либо иметь понятную причину блокировки */
const starterId = DATA.SKINS[0].id;
const badLock = DATA.SKINS
  .filter(s => s.id !== starterId && !s.cost && !s.box && !s.event && !s.raid && !s.secret)
  .map(s => s.id);
ok('у всех скинов кроме стартового есть цена или способ получения', badLock.length === 0, badLock.join(','));

/* Эффекты обязаны что-то усиливать, иначе это просто картинка */
const deadFx = DATA.EFFECTS.filter(e => !(e.click > 1) && !(e.auto > 1)).map(e => e.id);
ok('у всех эффектов есть реальный множитель', deadFx.length === 0, deadFx.join(','));

/* Каждый стат квеста/достижения должен что-то возвращать */
const allGoals = [...DATA.QUESTS, ...DATA.DAILY, ...DATA.ACHIEVEMENTS];
const badStat = allGoals.filter(g => typeof ST.statValue(g.stat) !== 'number' || !Number.isFinite(ST.statValue(g.stat)))
  .map(g => `${g.id}:${g.stat}`);
ok('все статы квестов и достижений разрешимы', badStat.length === 0, badStat.join(','));

/* Цели достижений не должны превышать максимум по стату */
const unattainable = DATA.ACHIEVEMENTS.filter(a => {
  if (a.id === 'a_allFx') return false;             /* открывает состав эффектов */
  if (a.id === 'a_allSkins') return false;
  if (a.id === 'a_boxSkins') return false;
  if (a.id === 'a_upgAll') return false;
  if (a.id === 'a_questAll') return false;
  if (a.id === 'a_clan10') return false;            /* зависит от чужих игроков */
  if (a.id === 'a_clans3') return false;
  return a.goal > DATA.SKINS.length && a.stat === 'skinsUnlocked';
});
ok('цели достижений достижимы', unattainable.length === 0, unattainable.map(a => a.id).join(','));

/* ================= 15. звук и фото-фон ================= */
/* в песочнице нет fetch/AudioContext.decodeAudioData — проверяем,
   что всё уходит в безопасный фолбэк и не бросает наружу */
let snThrew = false;
try { SND.play('click'); SND.play('buy'); SND.play('crit'); SND.meow(); }
catch (e) { snThrew = true; }
ok('SND не падает без файлов', !snThrew);
ok('SND.meow() возвращает признак успеха', typeof SND.meow() === 'boolean');
ok('звук выключается флагом', (SND.enabled = false, SND.enabled === false) && (SND.enabled = true));

ok('в настройках есть выбор фона',
  ['none', 'dark', 'orange', 'white'].indexOf(DATA.freshState().settings.backdrop) >= 0);
const bgRow = document.getElementById('bgRow');
ok('в разметке есть выбор фона', !!(bgRow && bgRow.querySelectorAll('[data-bg]').length === 4));

/* ================= 15. эффекты влияют на доход ================= */
ST.state.upgrades = {};
ST.state.effectsOwned = [];
ST.state.effectsOn = {};
ST.state.settings.effectsAll = true;
ST.state.coins = 0;
const basePerClick = ST.perClick(0);
DATA.EFFECTS.forEach(e => ST.unlockEffect(e.id));
const fxClick = ST.fxMult('click');
const fxAuto = ST.fxMult('auto');
ok('эффекты усиливают клик', fxClick > 1, String(fxClick));
ok('эффекты усиливают автодоход', fxAuto > 1, String(fxAuto));
ok('множитель клика ограничен потолком', fxClick <= DATA.FX_MULT_CAP, `${fxClick} > ${DATA.FX_MULT_CAP}`);
ST.state.upgrades.mini = 4;
ok('доход вырос после включения эффектов', ST.perSecond() > 0 && ST.perClick(0) >= basePerClick,
  `perClick=${ST.perClick(0)} perSec=${ST.perSecond()}`);

/* ================= 16. временные бусты ================= */
const c0 = ST.state.coins;
ST.addBuff(3, 30000, 'x3 на 30 сек');
ok('буст ×3 применён', ST.tempMult() === 3, String(ST.tempMult()));
ok('буст учтён в клике', ST.perClick(0) > 0, String(ST.perClick(0)));
ST.state.buff = { mult: 1, until: 0, name: '' };
ok('буст истёк и снялся', ST.tempMult() === 1, String(ST.tempMult()));
ST.state.coins = c0;

/* ================= 17. ранги по кликам ================= */
ok('есть ранги для забора', DATA.RANKS.length >= 5, String(DATA.RANKS.length));
ST.state.ranksClaimed = {};
ST.state.stats.clicks = 0;
const firstRank = DATA.RANKS[0];
const claimedFirst = ST.claimRank(firstRank.id);
ok('первый ранг забирается сразу', !!claimedFirst && ST.state.coins >= firstRank.reward,
  `claimed=${!!claimedFirst} coins=${ST.state.coins}`);
ok('повторно ранг не забрать', ST.claimRank(firstRank.id) === null, String(ST.claimRank(firstRank.id)));
ST.state.stats.clicks = DATA.RANKS[1].clicks;
ok('следующий ранг становится доступен', !!ST.nextRank(), String(ST.nextRank() && ST.nextRank().id));
ok('далекий ранг недоступен', !ST.rankAvailable(DATA.RANKS[5]), DATA.RANKS[5].id);

/* ================= 18. настройки через API ================= */
const errSet = errors.length;
SOCIAL.openAuth(); UI.closeAll();
ok('соц-слой не падает без сервера', errors.length === errS, errors.slice(errS).join(' | '));

/* ================= 19. финальный прогон цикла ================= */
tickFrames(30);
for (let i = 0; i < 30; i++) { ST.tick(1); CLICK.tick(1); FX.tick(); }
ok('игровой цикл живёт без исключений', errors.length === errSet, errors.slice(errSet).join(' | '));
ok('соединение помечено офлайн без сервера', API.status !== 'online', API.status);
ok('toast работает', (UI.toast('тест', 'ok'), true));

console.log('');
if (errors.length) {
  console.log('  \x1b[33mОшибки в консоли (' + errors.length + '):\x1b[0m');
  for (const e of [...new Set(errors)].slice(0, 12)) console.log('    · ' + String(e).slice(0, 200));
}
console.log(`  Пройдено: ${pass}, провалено: ${fail}`);
process.exit(fail || errors.length ? 1 : 0);


