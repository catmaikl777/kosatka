/* ============================================================
   PIXEL ORCA — игровые данные и баланс
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------- улучшения ---------- */
  var UPGRADES = [
    { id: 'fin', name: 'Хвостовой плавник', desc: '+1 за клик', icon: 'img_clickup', cost: 15, growth: 1.15, kind: 'clickFlat', val: 1 },
    { id: 'voice', name: 'Голос стаи', desc: '+2 за клик', icon: 'i_siren', cost: 120, growth: 1.16, kind: 'clickFlat', val: 2 },
    { id: 'echo', name: 'Эхолокация', desc: '+5 за клик', icon: 'i_crit', cost: 1400, growth: 1.17, kind: 'clickFlat', val: 5 },
    { id: 'power', name: 'Сила стаи', desc: '×1.40 за клик', icon: 'i_magnet', cost: 600, growth: 1.55, kind: 'clickMult', val: 1.4 },
    { id: 'claw', name: 'Когти', desc: '×1.35 за клик', icon: 'i_sword', cost: 6500, growth: 1.6, kind: 'clickMult', val: 1.35 },
    { id: 'crit', name: 'Критический укус', desc: '+2% крит', icon: 'i_crit', cost: 900, growth: 1.2, kind: 'critAdd', val: 2 },
    { id: 'rage', name: 'Ярость', desc: '+25% силы крита', icon: 'i_flame', cost: 4500, growth: 1.22, kind: 'critDmg', val: 0.25 },
    { id: 'combo', name: 'Синхронность', desc: '+1 к множителю комбо', icon: 'i_ladder', cost: 12000, growth: 1.3, kind: 'comboAdd', val: 1 },
    { id: 'luck', name: 'Удачная волна', desc: '+5% к качеству лута', icon: 'i_star', cost: 7000, growth: 1.25, kind: 'luckAdd', val: 0.05 },
    { id: 'mini', name: 'Малыш-автокликер', desc: '+0.5 клика/сек', icon: 'img_autoup', cost: 100, growth: 1.13, kind: 'cpsAdd', val: 0.5 },
    { id: 'hunter', name: 'Охотник-автокликер', desc: '+2 клика/сек', icon: 'img_autoup', cost: 2800, growth: 1.14, kind: 'cpsAdd', val: 2 },
    { id: 'drone', name: 'Дрон-рыболов', desc: '+8 кликов/сек', icon: 'img_autoup', cost: 65000, growth: 1.15, kind: 'cpsAdd', val: 8 },
    { id: 'fleet', name: 'Промышленный флот', desc: '+30 кликов/сек', icon: 'img_autoup', cost: 1600000, growth: 1.16, kind: 'cpsAdd', val: 30 },
    { id: 'tide', name: 'Прилив', desc: '+3% ко всем кликам/сек', icon: 'i_magnet', cost: 95000, growth: 1.18, kind: 'allMult', val: 1.03 },
    { id: 'magnet', name: 'Магнит рыбы', desc: '+40% выручки за рыбу', icon: 'i_fish', cost: 30000, growth: 1.2, kind: 'fishMult', val: 0.4 },
    { id: 'ticket', name: 'Билет удачи', desc: 'Билет ивента за 50 кликов', icon: 'i_book', cost: 500000, growth: 1.4, kind: 'ticketDiv', val: 50 }
  ];

  /* ---------- скины (кошки из репозитория orca-clicker) ----------
     art   — ключ картинки в PO_SPR.IMAGES
     cost  — цена в косатках (0 = только за бокс/ивент/секрет)
     box   — id бокса, из которого падает
     event — награда за топ сезона
     raid  — столько побед в рейдах
     secret— открывается за 100% достижений                     */
  var SKINS = [
    { id: 'normal', name: 'Обычная', rar: 'common', art: 'img_normal', bonus: 0, cost: 0, desc: 'С чего всё начиналось.' },
    { id: 'chillcat', name: 'Чилл', rar: 'common', art: 'img_chillcat', bonus: 0.03, cost: 30000, box: 'squid', desc: 'Лежит на подоконнике и взирает в океан.' },
    { id: 'hiding', name: 'Прячущаяся', rar: 'common', art: 'img_hiding', bonus: 0.05, cost: 0, box: 'squid', desc: 'Только глаза из-под дивана.' },
    { id: 'wild', name: 'Дикая', rar: 'rare', art: 'img_wild', bonus: 0.06, cost: 90000, box: 'crystal', desc: 'Ходит по берегу и не боится волн.' },
    { id: 'beauty', name: 'Красавица', rar: 'rare', art: 'img_beauty', bonus: 0.08, cost: 400000, desc: 'Ухоженная до сияния.' },
    { id: 'interesting', name: 'Интересная', rar: 'rare', art: 'img_interesting', bonus: 0.09, cost: 0, box: 'crystal', desc: 'У неё своя история.' },
    { id: 'cute', name: 'Милашка', rar: 'epic', art: 'img_cute', bonus: 0.11, cost: 1200000, box: 'epicBox', desc: 'Мурлычет громче прибоя.' },
    { id: 'bugeyed', name: 'Глазастая', rar: 'epic', art: 'img_bugeyed', bonus: 0.12, cost: 0, box: 'epicBox', desc: 'Видит косаток за горизонтом.' },
    { id: 'cyberpunk', name: 'Киберпанк', rar: 'legend', art: 'img_cyberpunk', bonus: 0.15, cost: 0, box: 'chest', event: 1, desc: 'Неоновые глаза в дождь. Награда за топ сезона.' },
    { id: 'chonky', name: 'Пухляшка', rar: 'legend', art: 'img_chonky', bonus: 0.18, cost: 5000000, raid: 5, desc: 'Мурчит на полтоса ниже.' },
    { id: 'richi', name: 'Ричи', rar: 'legend', art: 'img_richi', bonus: 0.22, cost: 0, secret: 1, desc: 'Секретный скин: 100% достижений.' }
  ];

  var RAR_COLORS = {
    common: '#7fa8d8', rare: '#4ae0e0', epic: '#c05ae0', legend: '#ffd447'
  };
  var RAR_NAMES = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legend: 'Легендарный' };

  /* ---------- боксы ----------
     fish: true — «бонусный» бокс: только эффекты и временные бусты */
  var BOXES = [
    {
      id: 'squid', name: 'Ящик кальмара', rar: 'common', sprite: 'img_chest',
      cost: 4000, desc: 'Дешёвый ящик с мелкой добычей.',
      loot: [
        { w: 52, t: 'coins', min: 0.4, max: 1.2 },
        { w: 28, t: 'fish', min: 1, max: 4 },
        { w: 8, t: 'xp', min: 200, max: 900 },
        { w: 6, t: 'shells', min: 1, max: 1 },
        { w: 4, t: 'skin', pool: ['chillcat', 'hiding'] },
        { w: 2, t: 'buff', mult: 2, dur: 30000, name: '×2 на 30 сек' }
      ]
    },
    {
      id: 'fishbox', name: 'Рыбный бокс', rar: 'rare', sprite: 'img_fish', fish: true,
      cost: 12500, desc: 'Только эффекты и временные бусты. Ни копейки.',
      loot: [
        { w: 40, t: 'effect', rar: 'rare' },
        { w: 30, t: 'buff', mult: 2, dur: 30000, name: '×2 на 30 сек' },
        { w: 18, t: 'effect', rar: 'epic' },
        { w: 9, t: 'buff', mult: 3, dur: 25000, name: '×3 на 25 сек' },
        { w: 3, t: 'effect', rar: 'legend' }
      ]
    },
    {
      id: 'crystal', name: 'Кристальный бокс', rar: 'rare', sprite: 'boxRare',
      cost: 60000, desc: 'Редкая добыча и шанс на эффект.',
      loot: [
        { w: 43, t: 'coins', min: 1.0, max: 2.4 },
        { w: 24, t: 'fish', min: 4, max: 12 },
        { w: 12, t: 'shells', min: 1, max: 2 },
        { w: 9, t: 'effect' },
        { w: 6, t: 'skin', pool: ['wild', 'interesting'] },
        { w: 3, t: 'buff', mult: 3, dur: 25000, name: '×3 на 25 сек' },
        { w: 3, t: 'ticket', min: 1, max: 3 }
      ]
    },
    {
      id: 'epicBox', name: 'Фиолетовый саркофаг', rar: 'epic', sprite: 'boxEpic',
      cost: 250000, desc: 'Редкие скины и много ракушек.',
      loot: [
        { w: 40, t: 'coins', min: 1.6, max: 4 },
        { w: 19, t: 'fish', min: 6, max: 20 },
        { w: 22, t: 'shells', min: 1, max: 4 },
        { w: 9, t: 'effect' },
        { w: 7, t: 'skin', pool: ['cute', 'bugeyed'] },
        { w: 3, t: 'ticket', min: 1, max: 3 }
      ]
    },
    {
      id: 'chest', name: 'Золотой сундук', rar: 'legend', sprite: 'img_catdrop',
      cost: 900000, desc: 'Ракушки, легендарные скины, эффекты.',
      loot: [
        { w: 34, t: 'coins', min: 2.5, max: 6 },
        { w: 17, t: 'fish', min: 10, max: 30 },
        { w: 19, t: 'shells', min: 2, max: 5 },
        { w: 15, t: 'effect' },
        { w: 7, t: 'skin', pool: ['cyberpunk'] },
        { w: 4, t: 'buff', mult: 5, dur: 20000, name: '×5 на 20 сек' },
        { w: 4, t: 'ticket', min: 3, max: 8 }
      ]
    }
  ];

  /* ---------- визуальные эффекты ----------
     click — множитель клика, auto — множитель кликов/сек.
     Множители складываются, итог ограничен FX_MULT_CAP. */
  var FX_MULT_CAP = 100;
  var EFFECTS = [
    { id: 'e1', name: 'Золотой клик', icon: 'i_coin', rar: 'common', click: 2, auto: 1, desc: 'Клик ×2. Криты летят золотыми искрами.' },
    { id: 'e2', name: 'Неоновый свет', icon: 'i_bolt', rar: 'common', click: 1, auto: 1.5, desc: 'Доход ×1.5. Свечение вокруг кошки.' },
    { id: 'e3', name: 'Радужный след', icon: 'i_star', rar: 'rare', click: 3, auto: 1, desc: 'Клик ×3. Радужный шлейф за кликами.' },
    { id: 'e4', name: 'Частицы звёзд', icon: 'i_star', rar: 'rare', click: 1, auto: 2, desc: 'Доход ×2. Звёзды в воде вокруг вас.' },
    { id: 'e5', name: 'Волновой эффект', icon: 'i_fish', rar: 'common', click: 5, auto: 1, desc: 'Клик ×5. Кольца волн по клику.' },
    { id: 'e6', name: 'Огненное сияние', icon: 'i_flame', rar: 'epic', click: 10, auto: 1, desc: 'Клик ×10. Искры пламени поднимаются вверх.' },
    { id: 'e7', name: 'Ледяной мороз', icon: 'i_star', rar: 'rare', click: 1, auto: 2.5, desc: 'Доход ×2.5. Снежинки и иней на воде.' },
    { id: 'e8', name: 'Тёмная материя', icon: 'i_crit', rar: 'epic', click: 8, auto: 1, desc: 'Клик ×8. Тёмные пиксельные вихри.' },
    { id: 'e9', name: 'Электрический шторм', icon: 'i_bolt', rar: 'epic', click: 6, auto: 1.8, desc: 'Клик ×6, доход ×1.8. Разряды между облаками.' },
    { id: 'e10', name: 'Призрачное сияние', icon: 'i_siren', rar: 'legend', click: 1, auto: 3, desc: 'Доход ×3. Полупрозрачные силуэты кошек.' }
  ];

  /* ---------- квесты (основные, последовательные) ---------- */
  var QUESTS = [
    { id: 'q1', name: 'Первые волны', desc: 'Сделай 100 кликов', goal: 100, stat: 'clicks', reward: 500, xp: 60 },
    { id: 'q2', name: 'Обучение стаи', desc: 'Купи 5 улучшений', goal: 5, stat: 'upgradesBought', reward: 1500, xp: 120 },
    { id: 'q3', name: 'Эхо океана', desc: 'Сделай 500 кликов', goal: 500, stat: 'clicks', reward: 5000, xp: 300 },
    { id: 'q4', name: 'Сундуки из глубины', desc: 'Открой 5 боксов', goal: 5, stat: 'boxesOpened', reward: 3, fish: 3, xp: 200 },
    { id: 'q5', name: 'Рыбак', desc: 'Поймай 15 рыб', goal: 15, stat: 'fishCaught', reward: 8000, xp: 400 },
    { id: 'q6', name: 'Дельфин-уровень', desc: 'Сделай 5000 кликов', goal: 5000, stat: 'clicks', reward: 25000, xp: 900 },
    { id: 'q7', name: 'Свой облик', desc: 'Купи любой скин', goal: 1, stat: 'skinsBought', reward: 10000, xp: 600 },
    { id: 'q8', name: 'Победа в бою', desc: 'Выиграй 1 PvP-баттл', goal: 1, stat: 'pvpWins', reward: 30000, xp: 800 },
    { id: 'q9', name: 'Глубина', desc: 'Сделай 50 000 кликов', goal: 50000, stat: 'clicks', reward: 120000, xp: 2000 },
    { id: 'q10', name: 'Новый круг', desc: 'Сделай первый сброс в океан', goal: 1, stat: 'prestiges', reward: 10000, shells: 1, xp: 1500 },
    { id: 'q11', name: 'Рейд', desc: 'Сыграй 1 рейд', goal: 1, stat: 'raidPlayed', reward: 60000, xp: 1200 },
    { id: 'q12', name: 'Сундучный магнат', desc: 'Открой 50 боксов', goal: 50, stat: 'boxesOpened', reward: 400000, shells: 1, xp: 4000 },
    { id: 'q13', name: 'Не один в океане', desc: 'Вступи в клан', goal: 1, stat: 'clanJoined', reward: 50000, xp: 1000 },
    { id: 'q14', name: 'Команда мечты', desc: 'Выиграй 5 рейдов', goal: 5, stat: 'raidWins', reward: 300000, shells: 1, xp: 3000 },
    { id: 'q15', name: 'Обменяй улов', desc: 'Обменяй рыбу на косаток', goal: 1, stat: 'exchanges', reward: 150000, xp: 2500 },
    { id: 'q16', name: 'Легенда океана', desc: 'Сделай 500 000 кликов', goal: 500000, stat: 'clicks', reward: 1000000, shells: 2, xp: 5000 }
  ];

  /* ---------- ежедневные квесты (3 на день) ---------- */
  var DAILY = [
    { id: 'd_click', name: 'Много кликов', desc: 'Сделай 200 кликов', goal: 200, stat: 'clicksDaily', reward: 1500, xp: 150 },
    { id: 'd_fish', name: 'Улов дня', desc: 'Поймай 5 рыб', goal: 5, stat: 'fishCaughtDaily', reward: 2000, fish: 2, xp: 150 },
    { id: 'd_buy', name: 'Инвестор', desc: 'Купи 3 улучшения', goal: 3, stat: 'upgradesBoughtDaily', reward: 1200, xp: 120 },
    { id: 'd_box', name: 'Сокровище', desc: 'Открой 1 бокс', goal: 1, stat: 'boxesOpenedDaily', reward: 1800, xp: 130 },
    { id: 'd_pvp', name: 'Дуэлянт', desc: 'Выиграй 1 PvP-баттл', goal: 1, stat: 'pvpWinsDaily', reward: 3000, xp: 200 },
    { id: 'd_exchange', name: 'Барыга', desc: 'Обменяй рыбу на косаток', goal: 1, stat: 'exchangesDaily', reward: 2500, xp: 160 },
    { id: 'd_raid', name: 'Командный бой', desc: 'Сыграй в рейде', goal: 1, stat: 'raidPlayedDaily', reward: 4000, xp: 250 }
  ];

  /* ---------- достижения ---------- */
  var ACHIEVEMENTS = [
    { id: 'a_click100', name: 'Первая кровь', desc: '100 кликов', goal: 100, stat: 'clicks', reward: 200, xp: 50 },
    { id: 'a_click1k', name: 'Тысячник', desc: '1 000 кликов', goal: 1000, stat: 'clicks', reward: 3000, xp: 200 },
    { id: 'a_click10k', name: 'Десятитысячник', desc: '10 000 кликов', goal: 10000, stat: 'clicks', reward: 40000, xp: 800 },
    { id: 'a_click100k', name: 'Кликер-машина', desc: '100 000 кликов', goal: 100000, stat: 'clicks', reward: 600000, xp: 3000 },
    { id: 'a_click1m', name: 'Миллион кликов', desc: '1 000 000 кликов', goal: 1000000, stat: 'clicks', reward: 8000000, shells: 2, xp: 9000 },
    { id: 'a_lvl10', name: 'Новичок стаи', desc: 'Достичь 10 уровня', goal: 10, stat: 'level', reward: 5000, xp: 300 },
    { id: 'a_lvl25', name: 'Опытный кит', desc: 'Достичь 25 уровня', goal: 25, stat: 'level', reward: 50000, xp: 1200 },
    { id: 'a_lvl50', name: 'Легенда океана', desc: 'Достичь 50 уровня', goal: 50, stat: 'level', reward: 500000, xp: 4000 },
    { id: 'a_lvl100', name: 'Император глубин', desc: 'Достичь 100 уровня', goal: 100, stat: 'level', reward: 10000000, shells: 5, xp: 15000 },
    { id: 'a_coin10k', name: 'Первые 10k', desc: 'Накопить 10 000 косаток всего', goal: 10000, stat: 'totalCoins', reward: 1000, xp: 80 },
    { id: 'a_coin1m', name: 'Миллион косаток', desc: 'Накопить 1 000 000 всего', goal: 1000000, stat: 'totalCoins', reward: 20000, xp: 400 },
    { id: 'a_coin1b', name: 'Миллиард косаток', desc: 'Накопить 1 000 000 000 всего', goal: 1e9, stat: 'totalCoins', reward: 1000000, shells: 3, xp: 6000 },
    { id: 'a_cps10', name: 'Автоматизация', desc: 'Выйти на 10 кликов/сек', goal: 10, stat: 'bestCps', reward: 8000, xp: 300 },
    { id: 'a_cps100', name: 'Стая автоматов', desc: 'Выйти на 100 кликов/сек', goal: 100, stat: 'bestCps', reward: 200000, xp: 2000 },
    { id: 'a_cps1000', name: 'Морская электростанция', desc: 'Выйти на 1000 кликов/сек', goal: 1000, stat: 'bestCps', reward: 3000000, xp: 8000 },
    { id: 'a_click10', name: 'Клик за 10', desc: 'Клик даёт 10 косаток', goal: 10, stat: 'bestPerClick', reward: 5000, xp: 200 },
    { id: 'a_click1k', name: 'Клик за 1000', desc: 'Клик даёт 1000 косаток', goal: 1000, stat: 'bestPerClick', reward: 300000, xp: 2500 },
    { id: 'a_crit100', name: 'Снайпер', desc: '50 критических кликов', goal: 50, stat: 'crits', reward: 6000, xp: 250 },
    { id: 'a_crit1000', name: 'Мастер крита', desc: '1000 критических кликов', goal: 1000, stat: 'crits', reward: 200000, xp: 2000 },
    { id: 'a_crit10k', name: 'Критический ураган', desc: '10 000 критических кликов', goal: 10000, stat: 'crits', reward: 3000000, xp: 9000 },
    { id: 'a_fish10', name: 'Новичок рыбак', desc: 'Поймать 10 рыб', goal: 10, stat: 'fishCaught', reward: 1500, xp: 100 },
    { id: 'a_fish100', name: 'Рыбак', desc: 'Поймать 100 рыб', goal: 100, stat: 'fishCaught', reward: 30000, xp: 500 },
    { id: 'a_fish500', name: 'Магнат рыбы', desc: 'Поймать 500 рыб', goal: 500, stat: 'fishCaught', reward: 400000, shells: 1, xp: 2500 },
    { id: 'a_fish1000', name: 'Хозяин океана', desc: 'Поймать 1000 рыб', goal: 1000, stat: 'fishCaught', reward: 4000000, shells: 3, xp: 8000 },
    { id: 'a_fishEx', name: 'Барыга', desc: 'Обменять рыбу на косаток 25 раз', goal: 25, stat: 'exchanges', reward: 300000, xp: 1500 },
    { id: 'a_boxes5', name: 'Коллекционер', desc: 'Открыть 5 боксов', goal: 5, stat: 'boxesOpened', reward: 8000, xp: 200 },
    { id: 'a_boxes50', name: 'Скупой рыцарь', desc: 'Открыть 50 боксов', goal: 50, stat: 'boxesOpened', reward: 200000, xp: 1500 },
    { id: 'a_boxes200', name: 'Сундучный магнат', desc: 'Открыть 200 боксов', goal: 200, stat: 'boxesOpened', reward: 3000000, shells: 2, xp: 8000 },
    { id: 'a_fishbox25', name: 'Рыболов', desc: 'Открыть 25 рыбных боксов', goal: 25, stat: 'fishBoxes', reward: 500000, xp: 2500 },
    { id: 'a_bonus10', name: 'Удача', desc: 'Поймать 10 бонусов на поле', goal: 10, stat: 'bonuses', reward: 20000, xp: 600 },
    { id: 'a_bonus50', name: 'Счастливчик', desc: 'Поймать 50 бонусов на поле', goal: 50, stat: 'bonuses', reward: 400000, shells: 1, xp: 2500 },
    { id: 'a_skins3', name: 'Коллекция обликов', desc: 'Купить 3 скина', goal: 3, stat: 'skinsBought', reward: 25000, xp: 500 },
    { id: 'a_skins8', name: 'Гардероб', desc: 'Купить 8 скинов', goal: 8, stat: 'skinsBought', reward: 2000000, xp: 4000 },
    { id: 'a_allSkins', name: 'Все формы', desc: 'Открыть все скины', goal: 11, stat: 'skinsUnlocked', reward: 5000000, shells: 4, xp: 10000 },
    { id: 'a_boxSkins', name: 'Скин-коллекционер', desc: 'Собрать все скины из боксов', goal: 6, stat: 'boxSkins', reward: 2000000, shells: 2, xp: 6000 },
    { id: 'a_allFx', name: 'Художник', desc: 'Открыть все 10 эффектов', goal: 10, stat: 'effectsUnlocked', reward: 5000000, shells: 4, xp: 10000 },
    { id: 'a_upgAll', name: 'Инвестор', desc: 'Купить каждое улучшение хотя бы раз', goal: 16, stat: 'upgradesAll', reward: 1500000, xp: 5000 },
    { id: 'a_pvp1', name: 'Дебютант', desc: 'Выиграть 1 PvP', goal: 1, stat: 'pvpWins', reward: 15000, xp: 300 },
    { id: 'a_pvp10', name: 'Дуэлянт', desc: 'Выиграть 10 PvP', goal: 10, stat: 'pvpWins', reward: 200000, xp: 1500 },
    { id: 'a_pvp50', name: 'Чемпион арены', desc: 'Выиграть 50 PvP', goal: 50, stat: 'pvpWins', reward: 3000000, shells: 3, xp: 9000 },
    { id: 'a_streak3', name: 'На кураже', desc: '3 победы подряд', goal: 3, stat: 'bestWinStreak', reward: 200000, xp: 1500 },
    { id: 'a_raid5', name: 'Капитан команды', desc: 'Выиграть 5 рейдов', goal: 5, stat: 'raidWins', reward: 300000, xp: 2000 },
    { id: 'a_raid20', name: 'Флагман', desc: 'Выиграть 20 рейдов', goal: 20, stat: 'raidWins', reward: 3000000, shells: 3, xp: 9000 },
    { id: 'a_prestige1', name: 'Отпусти рыбу', desc: 'Сделать 1 сброс в океан', goal: 1, stat: 'prestiges', reward: 20000, xp: 800 },
    { id: 'a_prestige5', name: 'Круговорот', desc: 'Сделать 5 сбросов', goal: 5, stat: 'prestiges', reward: 1000000, shells: 3, xp: 6000 },
    { id: 'a_prestige20', name: 'Вечная волна', desc: 'Сделать 20 сбросов', goal: 20, stat: 'prestiges', reward: 20000000, shells: 10, xp: 30000 },
    { id: 'a_clan', name: 'Не один в океане', desc: 'Вступить в клан', goal: 1, stat: 'clanJoined', reward: 10000, xp: 200 },
    { id: 'a_clan10', name: 'Вождь племени', desc: 'Собрать клан из 10 участников', goal: 10, stat: 'clanMaxMembers', reward: 1000000, shells: 2, xp: 5000 },
    { id: 'a_clans3', name: 'Дипломат', desc: 'Побывать в 3 разных кланах', goal: 3, stat: 'clansJoined', reward: 400000, xp: 2500 },
    { id: 'a_questAll', name: 'Мастер квестов', desc: 'Выполнить все основные задания', goal: 16, stat: 'questIndex', reward: 2000000, shells: 2, xp: 6000 },
    { id: 'a_play1h', name: 'Постоянный игрок', desc: '1 час в игре', goal: 3600000, stat: 'playTime', reward: 50000, xp: 1000 },
    { id: 'a_shells10', name: 'Собиратель ракушек', desc: 'Скопить 10 ракушек', goal: 10, stat: 'shellsTotal', reward: 100000, xp: 1000 },
    { id: 'a_event1', name: 'Участник ивента', desc: 'Заработать 50 билетов ивента', goal: 50, stat: 'ticketsTotal', reward: 100000, xp: 800 },
    { id: 'a_combo30', name: 'Синхронность', desc: 'Комбо x30', goal: 30, stat: 'bestCombo', reward: 60000, xp: 1000 }
  ];

  /* ---------- ежедневная награда (серия до 90 дней) ---------- */
  var DAILY_REWARD = [
    { coins: 100, label: '100 косаток' },
    { coins: 150, label: '150 косаток' },
    { coins: 200, label: '200 косаток' },
    { coins: 250, label: '250 косаток' },
    { coins: 500, label: '500 косаток' },
    { coins: 750, label: '750 косаток' },
    { coins: 1500, label: '1 500 косаток' },
    { coins: 3000, label: '3 000 косаток' },
    { coins: 7500, label: '7 500 косаток' },
    { coins: 15000, label: '15 000 косаток' },
    { coins: 30000, label: '30 000 косаток' }
  ];

  /* ---------- рыбалка ---------- */
  var FISH_TYPES = [
    { id: 'fish', name: 'Рыбка', sprite: 'img_fish', w: 62, val: 1, speed: 1 },
    { id: 'goldfish', name: 'Золотая рыбка', sprite: 'goldfish', w: 24, val: 6, speed: 1.25 },
    { id: 'spacefish', name: 'Космо-рыба', sprite: 'spacefish', w: 10, val: 22, speed: 1.5 },
    { id: 'crab', name: 'Краб', sprite: 'crab', w: 4, val: 40, speed: 0.5 }
  ];

  /* ---------- бонусы, падающие на воду ----------
     value: 'click' | 'auto' — как считается награда
     w     — вес выпадения; удача (`luck`) сдвигает вес к rarer-концу */
  var FIELD_BONUSES = [
    { id: 'x2', name: 'x2 доход', sprite: 'starX2', color: '#ffd447', w: 22, dur: 30000, value: 'buff', mult: 2 },
    { id: 'chest', name: 'Сундук', sprite: 'img_chest', color: '#f0a030', w: 22, value: 'click', times: 15 },
    { id: 'fish', name: 'Рыбка', sprite: 'img_fish', color: '#4ae0e0', w: 26, value: 'auto' },
    { id: 'rain', name: 'Дождь x1.5', sprite: 'coin', color: '#4ad07a', w: 12, dur: 15000, value: 'buff', mult: 1.5 },
    { id: 'storm', name: 'Шторм критов', sprite: 'critSkull', color: '#e04a5a', w: 10, dur: 15000, value: 'crit' },
    { id: 'shell', name: 'Ракушка', sprite: 'shell', color: '#f0d0a0', w: 8, value: 'fixed', v: 1, gives: 'shell' }
  ];

  /* ---------- титулы по уровню (надпись в HUD) ---------- */
  var TITLES = [
    { lvl: 1, name: 'Малыш-дельфин' },
    { lvl: 5, name: 'Юный косатка' },
    { lvl: 10, name: 'Косатка-охотник' },
    { lvl: 20, name: 'Матёрый кит' },
    { lvl: 35, name: 'Капитан стаи' },
    { lvl: 50, name: 'Легенда океана' },
    { lvl: 75, name: 'Покровитель глубин' },
    { lvl: 100, name: 'Император пиксельных волн' }
  ];

  /* ---------- ранг по числу кликов (забирается один раз) ---------- */
  var RANKS = [
    { id: 'novice', name: 'Новичок', ic: 'i_book', clicks: 0, reward: 100 },
    { id: 'apprentice', name: 'Ученик', ic: 'i_ladder', clicks: 5000, reward: 250 },
    { id: 'fighter', name: 'Боец', ic: 'i_sword', clicks: 25000, reward: 500 },
    { id: 'veteran', name: 'Ветеран', ic: 'i_magnet', clicks: 100000, reward: 1000 },
    { id: 'expert', name: 'Эксперт', ic: 'i_bolt', clicks: 500000, reward: 2500 },
    { id: 'master', name: 'Мастер', ic: 'i_crown', clicks: 1000000, reward: 5000 },
    { id: 'grandmaster', name: 'Грандмастер', ic: 'i_star', clicks: 5000000, reward: 10000 },
    { id: 'legend', name: 'Легенда', ic: 'i_gift', clicks: 10000000, reward: 25000 },
    { id: 'mythic', name: 'Мифический', ic: 'i_flame', clicks: 50000000, reward: 50000 },
    { id: 'divine', name: 'Божественный', ic: 'i_siren', clicks: 100000000, reward: 100000 }
  ];

  /* ---------- ивент ---------- */
  var EVENT = {
    days: 7,
    clickDiv: 100,      /* 1 билет за 100 кликов */
    pvpClickDiv: 10,   /* 1 билет за 10 кликов в баттле */
    playerRewards: [50000, 25000, 10000],
    clanRewards: [50000, 25000, 10000]
  };

  /* ---------- кланы ---------- */
  var CLAN = {
    minLevel: 5,
    donateStep: 1000000,
    bonusPerStep: 0.01,
    maxBonus: 0.25
  };

  /* ---------- реклама ---------- */
  var AD = { coinsPerLevel: 1000, cooldownMs: 30 * 60 * 1000, viewMs: 5000 };

  /* ---------- престиж ---------- */
  var PRESTIGE = { base: 18, exp: 0.55, perShell: 0.03 };

  /* ---------- сброс прогресса ---------- */
  function freshState() {
    return {
      version: 4,
      created: Date.now(),
      lastSave: Date.now(),
      playTime: 0,
      coins: 0,
      totalCoins: 0,
      fish: 0,
      shells: 0,
      xp: 0,
      level: 1,
      skin: 'normal',
      upgrades: {},
      skinsOwned: ['normal'],
      effectsOwned: [],
      effectsOn: { e1: 1, e2: 1, e3: 1, e4: 1, e5: 1, e6: 1, e7: 1, e8: 1, e9: 1, e10: 1 },
      boxesOpened: 0,
      prestiges: 0,
      questIndex: 0,
      questsClaimed: {},
      ranksClaimed: {},
      dailyDate: '',
      dailyQuests: [],
      dailyProgress: {},
      dailyClaimed: {},
      dailyStreak: 0,
      lastDaily: 0,
      achievementsClaimed: {},
      boostUntil: 0,
      rainUntil: 0,
      buff: { mult: 1, until: 0, name: '' },
      eventTickets: 0,
      eventCoins: 0,
      eventSeasonScore: 0,
      adReady: 0,
      stats: {
        clicks: 0, crits: 0, fishCaught: 0, boxesOpened: 0,
        upgradesBought: 0, skinsBought: 0, pvpWins: 0, pvpLose: 0, pvpPlayed: 0,
        raidWins: 0, raidPlayed: 0, bestCombo: 0, bestCps: 0,
        bestPerClick: 0, exchanges: 0, shellsTotal: 0, ticketsTotal: 0,
        bestPerSec: 0, clickSeconds: 0, offlineEarned: 0,
        fishBoxes: 0, bonuses: 0, winStreak: 0, bestWinStreak: 0,
        clansJoined: 0, clanMaxMembers: 0
      },
      settings: {
        music: false, sfx: true, volume: 0.5,
        theme: 'sunset', effectsAll: true, pixelScale: 3, shake: true,
        showDamage: true, backdrop: 'dark'
      },
      account: { name: null, token: null, id: null },
      clan: { id: null, name: null, role: null, joined: 0 }
    };
  }

  root.DATA = {
    UPGRADES: UPGRADES, SKINS: SKINS, BOXES: BOXES, EFFECTS: EFFECTS,
    QUESTS: QUESTS, DAILY: DAILY, ACHIEVEMENTS: ACHIEVEMENTS,
    DAILY_REWARD: DAILY_REWARD, FISH_TYPES: FISH_TYPES,
    FIELD_BONUSES: FIELD_BONUSES, TITLES: TITLES, RANKS: RANKS,
    EVENT: EVENT, CLAN: CLAN, AD: AD, PRESTIGE: PRESTIGE,
    FX_MULT_CAP: FX_MULT_CAP,
    RAR_COLORS: RAR_COLORS, RAR_NAMES: RAR_NAMES,
    freshState: freshState
  };
})(typeof window !== 'undefined' ? window : globalThis);
