/* ============================================================
   PIXEL ORCA — регресс-тест баланса.

   Прогоняет боевые формулы (tools/balance.mjs) и проверяет, что
   игра остаётся «играбельной на полгода»:
     • доход конечен, не уезжает в Infinity
     • все улучшения имеют предел уровня (max) и стоят конечную цену
     • игрок не выкупает всё улучшения за первые дни (иначе «зависание»)
     • полное прохождение (все улучшения на максимуме) занимает
       ориентировочно полгода (120–300 дней) при часе игры в день
     • p90 между покупками не превышает разумного (комбо ощущается
       прогрессией, а не бесконечным ожиданием)
     • уровень не улетает выше MAX_LEVEL
   Запуск: node tools/smoke-balance.mjs
   ============================================================ */
import { simulate } from './balance.mjs';

const MIN_DAYS = 120, MAX_DAYS = 300;
const MAX_P90_MIN = 60;

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m ' + name); pass++; }
  else { console.log('  \x1b[31m✗\x1b[0m ' + name); fail++; }
};

console.log('\n\x1b[1mPIXEL ORCA — баланс прохождения\x1b[0m\n');
const res = simulate({ days: 400, stepSec: 10 });
const D = res.D;

console.log('  \x1b[1m[1]\x1b[0m структура улучшений');
let allCapped = true, allPositive = true;
for (const u of D.UPGRADES) {
  if (!(u.max > 0)) allCapped = false;
  if (!(u.cost > 0 && u.growth > 1 && u.val > 0)) allPositive = false;
}
ok(allCapped, 'у всех улучшений есть предел уровня (max)');
ok(allPositive, 'цены/рост/сила у всех улучшений корректны (>0, growth>1)');

console.log('\n  \x1b[1m[2]\x1b[0m доход и уровни');
ok(res.finite, 'доход и монеты конечны (нет Infinity/NaN)');
ok(D.MAX_LEVEL > 0 && res.log.every((r) => r.level <= D.MAX_LEVEL), 'уровень не превышает MAX_LEVEL');

console.log('\n  \x1b[1m[3]\x1b[0m темп прохождения');
const d1 = res.log[0] || { bought: 0 };
const totalLevels = D.UPGRADES.reduce((t, u) => t + u.max, 0);
const day1Share = d1.bought / totalLevels;
ok(day1Share < 0.5, 'за первый день выкупается меньше половины уровней (' +
  Math.round(day1Share * 100) + '%)');
const am = res.marks.allMax;
ok(am && am >= MIN_DAYS && am <= MAX_DAYS, 'полное прохождение за ' + (am || '—') + ' дн. (цель ' + MIN_DAYS + '–' + MAX_DAYS + ')');
ok(res.p90 / 60 <= MAX_P90_MIN, 'p90 между покупками ' + (res.p90 / 60).toFixed(0) + ' мин (макс ' + MAX_P90_MIN + ')');
ok(Number.isFinite(res.worstWait), 'худшее ожидание покупки конечно');

console.log('\n  \x1b[1m[4]\x1b[0m вехи');
ok(!!res.marks.level100, 'уровень 100 достижим (день ' + (res.marks.level100 || '—') + ')');
ok(!!res.marks.coin1b, '1e9 монет набирается (день ' + (res.marks.coin1b || '—') + ')');
ok(!!res.marks.clicks1m, '1e6 кликов набирается (день ' + (res.marks.clicks1m || '—') + ')');

console.log('\n  вехи: ' + JSON.stringify(res.marks));
console.log('  Пройдено: ' + pass + ', провалено: ' + fail);
process.exit(fail ? 1 : 0);
