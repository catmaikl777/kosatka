/* ============================================================
   PIXEL ORCA — симулятор прохождения и поиск баланса.

   Загружает НАСТОЯЩИЕ js/data.js и js/state.js прямо в Node (боевые
   формулы, цены и множители), сажает виртуального игрока за игру и
   меряет, за сколько реальных дней он проходит её при часе игры в день.

   Улучшения покупаются по «выгоде на монету»: прирост дохода/сек,
   делённый на цену. Прирост считается аналитически (без перебора),
   поэтому можно прогонять сотни конфигураций.

   Прохождение = все улучшения на максимуме (в js/data.js у каждого
   есть поле max). Дополнительные вехи: уровень 50/100, 1e9 монет,
   1e6 кликов.

   Запуск:  node tools/balance.mjs                  таблица текущего баланса
            node tools/balance.mjs --days 400
            node tools/balance.mjs --search         подбор параметров
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');

/* ---------- боевой код в Node ---------- */
export function loadGame(upgrades) {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  for (const f of ['js/data.js', 'js/state.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  const ST = globalThis.ST, D = globalThis.DATA;
  if (upgrades) {
    D.UPGRADES.length = 0;
    for (const u of upgrades) D.UPGRADES.push(u);
  }
  return { ST, D };
}

/* ---------- уровни без цикла addXp ---------- */
const CUM_STEP = 200000;
function makeLevels(ST, cap) {
  const cum = [0];
  for (let l = 1; l <= CUM_STEP; l++) cum[l] = cum[l - 1] + ST.xpNeed(l);
  const cumulative = (L) => L <= CUM_STEP ? cum[L]
    : cum[CUM_STEP] + 60 * (Math.pow(L, 2.55) - Math.pow(CUM_STEP, 2.55)) / 2.55;
  return function levelFor(totalXp) {
    let lo = 1, hi = 2;
    while (cumulative(hi) <= totalXp && hi < 1e13) hi *= 2;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulative(mid) <= totalXp) lo = mid; else hi = mid;
    }
    return Math.min(cap || Infinity, lo);
  };
}

export const PLAYER = {
  clicksPerSec: 5, combo: 50, hoursPerDay: 1,
  offlineCapH: 8, offlineFactor: 0.5, idleHours: 23
};

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

export function simulate(opts) {
  const o = Object.assign({}, PLAYER, opts || {});
  const { ST, D } = loadGame(o.upgrades);
  if (o.xpK) D.XP_K = o.xpK;
  ST.reset();
  const levelFor = makeLevels(ST, D.MAX_LEVEL);
  const SKIN = o.skinBonus || 0;
  let totalXp = 0;

  const upv = (id) => { for (const u of D.UPGRADES) if (u.id === id) return u; return null; };
  const clickAvg = () => {
    const cc = ST.critChance(), cm = ST.critMult();
    return ST.perClick(o.combo) * (1 + cc * (cm - 1));
  };
  const income = () => ST.perSecond() + o.clicksPerSec * clickAvg();

  /* аналитический прирост дохода/сек от следующего уровня улучшения */
  function gainOf(u) {
    if (u.kind === 'clickFlat') {
      const flat = 1 + ST.up('fin') * upv('fin').val + ST.up('voice') * upv('voice').val + ST.up('echo') * upv('echo').val;
      const multPart = ST.perClick(o.combo) / flat;
      const cc = ST.critChance(), cm = ST.critMult();
      return u.val * multPart * (1 + cc * (cm - 1)) * o.clicksPerSec;
    }
    if (u.kind === 'clickMult') {
      const cc = ST.critChance(), cm = ST.critMult();
      return ST.perClick(o.combo) * (u.val - 1) * (1 + cc * (cm - 1)) * o.clicksPerSec;
    }
    if (u.kind === 'cpsAdd') {
      return u.val * ST.allMult() * (1 + SKIN) * ST.fxMult('auto') * ST.tempMult();
    }
    if (u.kind === 'allMult') {
      return income() * (u.val - 1);
    }
    if (u.kind === 'critAdd') {
      const cm = ST.critMult();
      return o.clicksPerSec * ST.perClick(o.combo) * (cm - 1) * (u.val / 100);
    }
    if (u.kind === 'critDmg') {
      const cc = ST.critChance();
      return o.clicksPerSec * ST.perClick(o.combo) * cc * u.val;
    }
    if (u.kind === 'comboAdd') {
      const c = Math.min(o.combo, 50);
      const cur = 1 + c * 0.01 * (1 + ST.up('combo') * upv('combo').val * 0.5);
      const add = c * 0.01 * u.val * 0.5;
      return o.clicksPerSec * ST.perClick(o.combo) * (add / cur);
    }
    return 0; /* удача, рыба, билет — на доход не влияют */
  }

  function chooseBuy() {
    let best = null, bestRatio = 0, fallback = null;
    for (const u of D.UPGRADES) {
      const cost = ST.upgradeCost(u.id);      /* Infinity на максимуме */
      if (!(cost <= ST.state.coins)) continue;
      const g = gainOf(u);
      if (g > 0) {
        const r = g / cost;
        if (r > bestRatio) { bestRatio = r; best = u; }
      } else if (!fallback || cost < ST.upgradeCost(fallback.id)) {
        fallback = u;                          /* удача/рыба/билет — докупаем в конце */
      }
    }
    return best || fallback;
  }

  const log = [], marks = {}, waits = [], purchases = [];
  const hourSec = Math.round(o.hoursPerDay * 3600);
  const stepSec = o.stepSec || 1;
  let activeSec = 0, lastBuyActive = 0, stopped = false;

  for (let d = 1; d <= o.days && !stopped; d++) {
    for (let t = 0; t < hourSec; t += stepSec) {
      const inc = income();
      const dCoins = inc * stepSec;
      ST.state.coins += dCoins;
      ST.state.totalCoins += dCoins;
      ST.state.stats.clicks += o.clicksPerSec * stepSec;
      totalXp += dCoins * 0.06;
      activeSec += stepSec;
      for (let guard = 0; guard < 100000; guard++) {
        const u = chooseBuy();
        if (!u) break;
        const cost = ST.upgradeCost(u.id);
        ST.buyUpgrade(u.id);
        purchases.push({ day: d, activeSec, cost, id: u.id });
        waits.push(activeSec - lastBuyActive);
        lastBuyActive = activeSec;
      }
      if (ST.maxedAll()) { stopped = true; break; }
    }
    ST.state.level = levelFor(totalXp);
    const off = ST.perSecond() * o.offlineCapH * 3600 * o.offlineFactor * (o.idleHours / 23);
    ST.state.coins += off; ST.state.totalCoins += off;

    let cheapest = Infinity;
    for (const u of D.UPGRADES) cheapest = Math.min(cheapest, ST.upgradeCost(u.id));
    const inc = income();
    const rec = {
      day: d, level: ST.state.level, totalCoins: ST.state.totalCoins,
      coins: ST.state.coins, clicks: ST.state.stats.clicks,
      perClick: clickAvg(), perSec: inc, cheapest,
      owned: Object.keys(ST.state.upgrades).filter((k) => ST.state.upgrades[k] > 0).length,
      bought: ST.state.stats.upgradesBought, upN: 0
    };
    for (const u of D.UPGRADES) rec.upN += (ST.state.upgrades[u.id] || 0);
    log.push(rec);
    if (!marks.level10 && rec.level >= 10) marks.level10 = d;
    if (!marks.level50 && rec.level >= 50) marks.level50 = d;
    if (!marks.level100 && rec.level >= 100) marks.level100 = d;
    if (!marks.maxLevel && rec.level >= D.MAX_LEVEL) marks.maxLevel = d;
    if (!marks.coin1m && rec.totalCoins >= 1e6) marks.coin1m = d;
    if (!marks.coin1b && rec.totalCoins >= 1e9) marks.coin1b = d;
    if (!marks.clicks100k && rec.clicks >= 1e5) marks.clicks100k = d;
    if (!marks.clicks1m && rec.clicks >= 1e6) marks.clicks1m = d;
    if (!marks.allUpgrades && rec.owned >= D.UPGRADES.length) marks.allUpgrades = d;
    if (!marks.allMax && ST.maxedAll()) marks.allMax = d;
  }

  let finite = true, worstWait = 0, worstDay = 0;
  for (const r of log) {
    if (!isFinite(r.perSec) || !isFinite(r.totalCoins)) finite = false;
  }
  for (let i = 0; i < waits.length; i++) {
    if (waits[i] > worstWait) { worstWait = waits[i]; worstDay = purchases[i].day; }
  }
  return {
    log, marks, waits, purchases, finite, ST, D,
    worstWait, worstDay,
    p50: pct(waits, 0.5), p90: pct(waits, 0.9),
    days: log.length, totalBuys: purchases.length
  };
}

/* ---------- CLI ---------- */
function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
  if (process.argv.includes('--search')) return search();
  const days = arg('--days', 400);
  const hasV = ['--acps', '--ratio', '--cost', '--cap', '--valscale'].some((f) => process.argv.includes(f));
  const upgrades = hasV ? buildUpgrades({
    acps: arg('--acps', 1.0), ratio: arg('--ratio', 1.0),
    costScale: arg('--cost', 1), capScale: arg('--cap', 1), valScale: arg('--valscale', 1)
  }) : undefined;
  const res = simulate({ days, upgrades, stepSec: 1, xpK: arg('--xpk', 0) });
  const ST = res.ST, D = res.D;
  if (process.argv.includes('--first')) {
    console.log('первые покупки (активное время):');
    for (const p of res.purchases.slice(0, arg('--first', 25))) {
      console.log('  день ' + String(p.day).padStart(2) + '  t=' +
        (p.activeSec < 3600 ? p.activeSec + 'с' : (p.activeSec / 3600).toFixed(1) + 'ч') +
        '  ' + p.id.padEnd(7) + ' за ' + ST.fmt(p.cost));
    }
    console.log('');
  }
  console.log('день   уровень   доход/сек        монеты      ждать  куплено');
  const show = new Set([1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 200, 270, 365]);
  for (const r of res.log) {
    if (!show.has(r.day)) continue;
    console.log(
      String(r.day).padStart(4) + String(r.level).padStart(8) +
      ('  ' + ST.fmt(r.perSec)).padStart(12) +
      ('  ' + ST.fmt(r.totalCoins)).padStart(13) +
      ('  ' + ST.fmt(r.cheapest)).padStart(11) +
      ('  ' + r.upN + '/' + totalMax(D)).padStart(10) +
      ' ' + res.totalBuys);
  }
  console.log('');
  console.log('  вехи:', JSON.stringify(res.marks));
  console.log('  числа: ' + (res.finite ? 'конечные' : 'БЕСКОНЕЧНЫЕ!'));
  console.log('  интервалы между покупками (активные): p50 ' + (res.p50 / 60).toFixed(1) +
    ' мин, p90 ' + (res.p90 / 60).toFixed(1) + ' мин, макс ' +
    (res.worstWait / 3600).toFixed(1) + ' ч (день ' + res.worstDay + ')');
  console.log('  покупок всего: ' + res.totalBuys + ' за ' + res.days + ' дней; ср. ' +
    (res.totalBuys ? (res.days * 3600 / res.totalBuys / 60).toFixed(0) : 0) + ' мин/покупка');
}

function totalMax(D) { let s = 0; for (const u of D.UPGRADES) s += (u.max || 0); return s; }

/* ---------- поиск: перебор роста цены и лимитов уровней ---------- */
function baseUpgrades() {
  const { D } = loadGame();
  return D.UPGRADES.map((u) => Object.assign({}, u));
}

function search() {
  const variants = [];
  for (const acps of [1.4, 1.43, 1.46, 1.5]) {
    for (const xpK of [1500, 3000]) {
      variants.push({ valScale: 0.18, acps, ratio: 1.05, xpK });
    }
  }
  console.log('acps — рост цены, xpK — крутизна уровней, valScale 0.18, ratio 1.05');
  console.log('acps  xpK  lvl100 maxLvl  allMax  p50м p90м макс.ч  доход  финит');
  for (const v of variants) {
    const ups = buildUpgrades(v);
    const res = simulate({ days: 800, upgrades: ups, stepSec: 5, xpK: v.xpK });
    const last = res.log[res.log.length - 1];
    console.log(
      String(v.acps).padStart(5) + String(v.xpK).padStart(5) +
      String(res.marks.level100 || '-').padStart(7) + String(res.marks.maxLevel || '-').padStart(7) +
      String(res.marks.allMax || '-').padStart(7) +
      String((res.p50 / 60).toFixed(0)).padStart(5) + String((res.p90 / 60).toFixed(0)).padStart(5) +
      String((res.worstWait / 3600).toFixed(0)).padStart(6) +
      ('  ' + res.ST.fmt(last.perSec)).padStart(10) +
      String(res.finite ? 'да' : 'НЕТ').padStart(7)
    );
  }
}

function buildUpgrades(v) {
  const ups = baseUpgrades();
  for (const u of ups) {
    if (u.kind === 'clickMult' || u.kind === 'allMult') {
      u.growth = u.val * v.ratio;      /* цена растёт чуть быстрее силы */
    } else {
      u.growth = v.acps;
    }
    if (v.valScale && v.valScale !== 1) {
      if (u.kind === 'clickFlat' || u.kind === 'cpsAdd') u.val = u.val * v.valScale;
      if (u.kind === 'clickMult' || u.kind === 'allMult') u.val = 1 + (u.val - 1) * v.valScale;
    }
    if (v.costScale) u.cost = Math.max(1, Math.round(u.cost * v.costScale));
    if (v.capScale) u.max = Math.max(1, Math.round(u.max * v.capScale));
  }
  return ups;
}

main();
