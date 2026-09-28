/* ============================================================
   PIXEL ORCA — точка входа, HUD, настройки, главный цикл
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, FX = root.FX;
  var api = root.API;
  var els = {};
  var lastSaveT = 0;

  function boot() {
    ST.load();
    cacheEls();
    /* картинки кошек грузим сразу: пока их нет — рисуются ASCII-заглушки */
    root.PO_SPR.loadImages();
    FX.init(els.scene);
    root.CLICK.init(els.scene);
    root.QUESTS.init();
    root.QUESTS.initClicks();
    root.SHOP.initClicks();
    root.BATTLE.initServerEvents();
    applySettings();
    wireMenu();
    wireSettings();
    wireStatus();
    wireCurGuide();
    api.connect();
    api.on('status', function (s) { paintStatus(s); });
    paintStatus({ status: api.status });

    /* оффлайн-доход */
    var off = ST.offlineInfo;
    if (off && off.coins > 0) {
      UI.modalShell('С ВОЗВРАЩЕНИЕМ!',
        '<div class="offline-box"><div class="offline-ic">' + root.SHOP.SPRHTML('coin', 3) + '</div>' +
        '<p>Пока тебя не было, стая наловила:</p>' +
        '<div class="offline-num">+' + ST.fmt(off.coins) + ' косаток</div>' +
        '<p class="dim">Офлайн-доход: ' + ST.fmtTime(off.capped) + ' (копится максимум 8 часов)</p></div>');
    }
    /* ежедневная награда */
    if (root.REW.dailyState().can) {
      setTimeout(function () { root.REW.openDaily(); }, 700);
    }
    /* рефреш */
    setInterval(function () { paintHUD(); root.SHOP.tick(); }, 120);
    setInterval(function () {
      if (api.online && api.account) api.pushSave(ST.state);
      else ST.save();
    }, 20000);
    window.addEventListener('beforeunload', function () { ST.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) ST.flush();
    });
    registerSW();

    /* главный цикл */
    var last = Date.now();
    var nextRain = Date.now() + 180000 + Math.random() * 240000;
    setInterval(function () {
      var now = Date.now();
      var dt = now - last;
      last = now;
      ST.tick();
      FX.tick();
      if (ST.state.boostUntil && ST.state.boostUntil < now) {
        UI.toast('Удвоение закончилось', 'info', 'coin');
      }
      /* морской дождь: редкий buff x1.5 на 5 минут */
      if (now > nextRain) {
        nextRain = now + 300000 + Math.random() * 240000;
        if (Math.random() < 0.4 && ST.perSecond() > 0) {
          ST.state.rainUntil = now + 300000;
          ST.save();
          root.SND.play('levelUp');
          UI.banner('МОРСКОЙ ДОЖДЬ! x1.5', 'banner-rare', 2200);
        }
      }
      FX.rain(ST.state.rainUntil > now);
    }, 100);
  }

  function cacheEls() {
    var ids = ['scene', 'hudCoins', 'hudLevel', 'hudClick', 'hudSec', 'hudFish', 'hudShells',
      'hudSeason', 'hudRank', 'hudCur',
      'xpBar', 'xpTxt', 'connDot', 'connTxt', 'ticketCnt', 'adBtn', 'boostTag', 'comboTag',
      'dailyDot', 'clanTag', 'menuBtns', 'toastRoot'];
    ids.forEach(function (id) { els[id] = document.getElementById(id); });
  }

  /* ---------- HUD ---------- */
  function paintHUD() {
    var s = ST.state;
    set(els.hudCoins, ST.fmt(s.coins));
    set(els.hudLevel, s.level);
    set(els.hudClick, ST.fmt(ST.perClick(root.CLICK.combo)));
    set(els.hudSec, ST.fmt(ST.perSecond()));
    set(els.hudFish, ST.fmt(s.fish));
    set(els.hudShells, ST.fmt(s.shells || 0));
    set(els.hudSeason, ST.fmt(s.eventSeasonScore || 0));
    set(els.hudRank, ST.rank());
    set(els.ticketCnt, ST.fmt(s.eventTickets || 0));
    if (els.xpBar) {
      var need = ST.xpNeed(s.level);
      els.xpBar.style.width = Math.min(100, s.xp / need * 100).toFixed(2) + '%';
      set(els.xpTxt, ST.fmt(s.xp) + '/' + ST.fmt(need));
    }
    if (els.boostTag) {
      var left = Math.max(s.boostUntil - Date.now(), root.CLICK.buffX2 - Date.now());
      els.boostTag.classList.toggle('hide', left <= 0);
      if (left > 0) set(els.boostTag, 'x2 ' + ST.fmtTime(left));
    }
    if (els.comboTag) {
      var c = root.CLICK.combo;
      els.comboTag.classList.toggle('hide', c < 3);
      if (c >= 3) set(els.comboTag, 'x' + c);
    }
    if (els.clanTag) {
      var c2 = api.clan;
      els.clanTag.classList.toggle('hide', !c2);
      if (c2) set(els.clanTag, c2.name);
    }
    if (els.dailyDot) {
      els.dailyDot.classList.toggle('hide', !root.REW.dailyState().can);
    }
    if (els.adBtn) {
      var cd = root.REW.adCooldown();
      els.adBtn.classList.toggle('dim', cd > 0);
      set(els.adBtn, cd > 0 ? '📺 ' + ST.fmtTime(cd) : '📺 РЕКЛАМА');
    }
  }
  function set(el, v) { if (el && el.textContent !== String(v)) el.textContent = v; }
  function setId(id, v) { set(document.getElementById(id), v); }

  /* ---------- пояснения к валютам ----------
     Каждая валюта в HUD кликабельна: тап открывает короткое объяснение,
     зачем она нужна и где тратится. */
  var CUR_GUIDE = {
    coins: {
      ic: '🐋', name: 'КОСАТКИ', color: 'var(--gold)',
      text: '<b>Основная валюта.</b> Капает за клики, за пассивный доход, из боксов и за победы в PvP.<br><br>' +
        '<b>Тратится на:</b> улучшения, скины, боксы и рекламу за монеты.<br>' +
        '<b>Как быстрее копить:</b> держи комбо, прокачивай автодоход и меняй рыбу на косатки.'
    },
    fish: {
      ic: '🐟', name: 'РЫБА', color: 'var(--cyan)',
      text: '<b>Рыба — из рыбалки.</b> Не тонет сама: бросай крючок и кликай, пока не сорвалась.<br><br>' +
        '<b>Тратится на:</b> обмен на косатки прямо в окне рыбалки (кнопка «ОБМЕНЯТЬ»).<br>' +
        '<b>Как поднять цену:</b> улучшение «Магнит» увеличивает стоимость каждой рыбы.'
    },
    shells: {
      ic: '🐚', name: 'РАКУШКИ', color: '#7fe6c0',
      text: '<b>Постоянная валюта сброса.</b> Каждая ракушка даёт <b>+3% ко всему доходу</b> навсегда — и клику, и автодоходу.<br><br>' +
        '<b>Откуда:</b> престиж (сброс) и редкий дроп из боксов.<br>' +
        '<b>Важно:</b> ракушки не тратятся и не обнуляются. Чем больше накопил перед сбросом — тем быстрее новый виток.'
    },
    tickets: {
      ic: '🎫', name: 'БИЛЕТЫ ИВЕНТА', color: 'var(--purple)',
      text: '<b>Валюта сезонного ивента.</b> Капает автоматически: <b>1 билет за каждые 100 кликов</b>, плюс 1 билет за 10 кликов в баттле, плюс падает из боксов.<br><br>' +
        '<b>Тратится на:</b> вход в ивент и пожертвование клану.<br>' +
        '<b>Билеты не сгорают</b> — копите к следующему сезону.'
    },
    season: {
      ic: '🏆', name: 'ОЧКИ СЕЗОНА', color: '#ff9a5c',
      text: '<b>Рейтинг ивента.</b> Растёт от кликов, PvP и активности клана. Обнуляется в конце сезона.<br><br>' +
        '<b>Зачем:</b> первые места сезона получают крупные призы, а лидеры — легендарные награды и скины.'
    }
  };
  function wireCurGuide() {
    var row = els.hudCur;
    if (!row) return;
    row.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cur]');
      if (!b) return;
      root.SND.resume();
      root.SND.play('ui');
      var c = CUR_GUIDE[b.dataset.cur];
      if (!c) return;
      UI.modalShell(c.ic + ' ' + c.name,
        '<p class="dialog-text" style="line-height:1.7">' + c.text + '</p>');
    });
  }

  /* ---------- статус соединения ---------- */
  function wireStatus() {
    api.on('account', function (a) {
      var el = document.getElementById('accName');
      set(el, a ? '@' + a.name : 'Гость · прогресс только на этом устройстве');
      paintHUD();
      if (a) {
        /* подтягиваем облачное сохранение */
        api.pullSave().then(function (cloud) {
          if (!cloud) { api.pushSave(ST.state); return; }
          var localCoins = ST.state.totalCoins, cloudCoins = (cloud.stats && cloud.coins) || cloud.coins || 0;
          if (cloudCoins > localCoins * 1.2) {
            UI.confirm('Загрузить облачный прогресс?',
              'В облаке: ' + ST.fmt(cloudCoins) + ' всего, на устройстве: ' + ST.fmt(localCoins) + '. Загрузить облако?',
              'Загрузить').then(function (y) {
                if (!y) return;
                location.reload();
              });
            window.__cloudState = cloud;
          } else {
            api.pushSave(ST.state);
          }
        });
      }
    });
    api.on('clan', function () { paintHUD(); });
    api.on('authError', function (m) { UI.toast('Ошибка входа: ' + m, 'bad', 'i_lock'); });
  }
  function paintStatus(s) {
    var dot = els.connDot, txt = els.connTxt;
    if (!dot) return;
    var map = { online: ['#4ad07a', 'СЕРВЕР: ОНЛАЙН'], connecting: ['#ffd447', 'ПОДКЛЮЧЕНИЕ…'], offline: ['#e04a5a', 'СЕРВЕР: ОФЛАЙН'] };
    var v = map[s.status] || map.offline;
    dot.style.background = v[0];
    set(txt, v[1]);
  }

  /* ---------- меню ---------- */
  var MENU = [
    { id: 'shop', ic: 'i_coin', name: 'МАГАЗИН', fn: function () { UI.open('shop'); root.SHOP.showTab('upgrades'); } },
    { id: 'boxes', ic: 'i_gift', name: 'БОКСЫ', fn: function () { UI.open('shop'); root.SHOP.showTab('boxes'); } },
    { id: 'skins', ic: 'i_crown', name: 'СКИНЫ', fn: function () { UI.open('shop'); root.SHOP.showTab('skins'); } },
    { id: 'fish', ic: 'fish', name: 'РЫБАЛКА', fn: function () { root.FISH.open(); } },
    { id: 'quests', ic: 'i_book', name: 'КВЕСТЫ', fn: function () { UI.open('quests'); root.QUESTS.render(); } },
    { id: 'ach', ic: 'i_star', name: 'ДОСТИЖЕНИЯ', fn: function () { UI.open('achievements'); root.QUESTS.render(); } },
    { id: 'howto', ic: 'i_book', name: 'КАК ИГРАТЬ', fn: function () { UI.open('howto'); } },
    { id: 'pvp', ic: 'i_sword', name: 'PvP', fn: function () { root.BATTLE.openPvP(); } },
    { id: 'raid', ic: 'i_team', name: 'РЕЙД 3x3', fn: function () { root.BATTLE.openRaid(); } },
    { id: 'clans', ic: 'i_team', name: 'КЛАНЫ', fn: function () { root.SOCIAL.openClans(); } },
    { id: 'lb', ic: 'i_ladder', name: 'ЛИДЕРЫ', fn: function () { root.SOCIAL.openLeaderboard(); } },
    { id: 'event', ic: 'ticket', name: 'ИВЕНТ', fn: function () { root.REW.openEvent(); } },
    { id: 'stats', ic: 'i_ladder', name: 'СТАТИСТИКА', fn: function () { root.REW.openStats(); } },
    { id: 'daily', ic: 'i_gift', name: 'НАГРАДА', fn: function () { root.REW.openDaily(); }, dot: 'dailyDot' },
    { id: 'prestige', ic: 'shell', name: 'СБРОС', fn: function () { openPrestige(); } },
    { id: 'auth', ic: 'i_lock', name: 'АККАУНТ', fn: function () { root.SOCIAL.openAuth(); } },
    { id: 'settings', ic: 'i_anvil', name: 'НАСТРОЙКИ', fn: function () { UI.open('settings'); syncSettingsUI(); } }
  ];

  function wireMenu() {
    var box = els.menuBtns;
    if (!box) return;
    var html = '';
    for (var i = 0; i < MENU.length; i++) {
      var m = MENU[i];
      html += '<button class="menu-btn" data-menu="' + m.id + '">' +
        '<span class="mb-ic">' + root.SHOP.SPRHTML(m.ic, 2) + '</span>' +
        '<span class="mb-name">' + m.name + '</span>' +
        (m.dot ? '<span class="mb-dot hide" id="' + m.dot + '"></span>' : '') + '</button>';
    }
    box.innerHTML = html;
    root.SHOP.paintIcons(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-menu]');
      if (!b) return;
      root.SND.resume();
      for (var i = 0; i < MENU.length; i++) if (MENU[i].id === b.dataset.menu) { MENU[i].fn(); break; }
    });
  }

  function openPrestige() {
    UI.open('prestige');
    root.SHOP.renderPrestige(document.getElementById('prestigeBox'));
  }

  /* ---------- настройки ---------- */
  function applySettings() {
    var s = ST.state.settings;
    root.SND.enabled = s.sfx;
    root.SND.music = s.music;
    root.SND.volume = s.volume;
    FX.setTheme(s.theme);
    if (FX.size.px !== s.pixelScale) FX.setPixelScale(s.pixelScale);
    if (document.body) document.body.setAttribute('data-bg', s.backdrop || 'none');
  }

  function wireSettings() {
    var bind = function (id, ev, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };
    bind('setMusic', 'change', function () {
      ST.state.settings.music = this.checked;
      root.SND.music = this.checked;
      ST.save();
    });
    bind('setSfx', 'change', function () {
      ST.state.settings.sfx = this.checked;
      root.SND.enabled = this.checked;
      ST.save();
      if (this.checked) root.SND.play('ui');
    });
    bind('setVolume', 'input', function () {
      ST.state.settings.volume = this.value / 100;
      root.SND.volume = this.value / 100;
      set(document.getElementById('volTxt'), this.value);
      ST.save();
    });
    bind('setEffectsAll', 'change', function () {
      ST.state.settings.effectsAll = this.checked;
      ST.save();
    });
    bind('setShake', 'change', function () { ST.state.settings.shake = this.checked; ST.save(); });
    bind('setDamage', 'change', function () { ST.state.settings.showDamage = this.checked; ST.save(); });
    bind('setPixel', 'change', function () {
      FX.setPixelScale(+this.value);
      syncSettingsUI();
    });
    /* темы */
    var themes = document.getElementById('themeRow');
    if (themes) {
      themes.addEventListener('click', function (e) {
        var b = e.target.closest('[data-theme]');
        if (!b) return;
        ST.state.settings.theme = b.dataset.theme;
        ST.save();
        FX.setTheme(b.dataset.theme);
        FX.setPixelScale(+document.getElementById('setPixel').value);
        syncSettingsUI();
      });
    }
    /* фото-фон страницы */
    var bgRow = document.getElementById('bgRow');
    if (bgRow) {
      bgRow.addEventListener('click', function (e) {
        var b = e.target.closest('[data-bg]');
        if (!b) return;
        ST.state.settings.backdrop = b.dataset.bg;
        ST.save();
        if (document.body) document.body.setAttribute('data-bg', b.dataset.bg);
        syncSettingsUI();
      });
    }
    /* эффекты */
    var fxRow = document.getElementById('fxToggleList');
    if (fxRow) {
      fxRow.addEventListener('click', function (e) {
        var b = e.target.closest('[data-fx]');
        if (!b) return;
        var id = b.dataset.fx;
        if (!ST.hasEffect(id)) { root.SND.play('deny'); UI.toast('Эффект ещё не открыт', 'bad', 'i_lock'); return; }
        var v = !ST.state.effectsOn[id];
        ST.state.effectsOn[id] = v ? 1 : 0;
        ST.save();
        root.SND.play('ui');
        syncSettingsUI();
      });
    }
    /* сохранение/сброс */
    bind('btnSave', 'click', function () {
      var ok = ST.flush();
      if (ok) {
        root.SND.play('buy');
        set(document.getElementById('saveTxt'), 'Сохранено: ' + new Date().toLocaleTimeString('ru-RU'));
        UI.toast('Прогресс сохранён', 'good', 'i_star');
      } else UI.toast('Не удалось сохранить', 'bad', 'i_lock');
    });
    bind('btnReset', 'click', function () {
      UI.confirm('Сбросить ВСЁ?', 'Прогресс будет удалён навсегда. Ракушки, скины и достижения тоже слетят.', 'СБРОСИТЬ')
        .then(function (y) {
          if (!y) return;
          ST.reset();
          location.reload();
        });
    });
    bind('btnExport', 'click', function () {
      var data = btoa(unescape(encodeURIComponent(JSON.stringify(ST.state))));
      var m = UI.modalShell('ЭКСПОРТ СЕЙВА', '<p class="dialog-text">Скопируй код и вставь в «Импорт» на другом устройстве.</p>' +
        '<textarea class="px-input code" id="expTxt" readonly></textarea>');
      m.querySelector('#expTxt').value = data;
      m.querySelector('#expTxt').focus();
    });
    bind('btnImport', 'click', function () {
      UI.prompt('Импорт сейва', 'Вставь код сейва', '', 99999).then(function (v) {
        if (!v) return;
        try {
          var obj = JSON.parse(decodeURIComponent(escape(atob(v.trim()))));
          UI.confirm('Импортировать?', 'Текущий прогресс будет заменён.', 'Импортировать').then(function (y) {
            if (!y) return;
            localStorage.setItem(ST.KEY, JSON.stringify(obj));
            location.reload();
          });
        } catch (e) { UI.toast('Код повреждён', 'bad', 'i_lock'); }
      }, 32);
    });
  }

  function syncSettingsUI() {
    var s = ST.state.settings;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v; };
    var chk = function (id, v) { var e = document.getElementById(id); if (e) e.checked = !!v; };
    chk('setMusic', s.music);
    chk('setSfx', s.sfx);
    var vol = Math.round(s.volume * 100);
    setId('setVolume', vol);
    var volRange = document.getElementById('setVolume');
    if (volRange) volRange.value = vol;
    set(document.getElementById('volTxt'), vol);
    chk('setEffectsAll', s.effectsAll);
    chk('setShake', s.shake);
    chk('setDamage', s.showDamage);
    setId('setPixel', s.pixelScale);
    document.querySelectorAll('#themeRow [data-theme]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.theme === s.theme);
    });
    document.querySelectorAll('#bgRow [data-bg]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.bg === s.backdrop);
    });
    if (document.body) document.body.setAttribute('data-bg', s.backdrop || 'none');
    var fl = document.getElementById('fxToggleList');
    if (fl) {
      if (!fl.dataset.built) {
        var h = '';
        for (var i = 0; i < D.EFFECTS.length; i++) {
          var e = D.EFFECTS[i];
          h += '<div class="fx-toggle" data-fx="' + e.id + '">' +
            '<span class="fx-ic">' + root.SHOP.SPRHTML(e.icon, 2) + '</span>' +
            '<span class="fx-name">' + e.name + '</span>' +
            '<span class="fx-sw" data-sw></span></div>';
        }
        fl.innerHTML = h;
        fl.dataset.built = '1';
        root.SHOP.paintIcons(fl);
      }
      fl.querySelectorAll('[data-fx]').forEach(function (row) {
        var id = row.dataset.fx;
        var owned = ST.hasEffect(id);
        var on = ST.effectOn(id);
        row.classList.toggle('locked', !owned);
        row.classList.toggle('on', owned && on);
        var sw = row.querySelector('[data-sw]');
        if (sw) sw.textContent = !owned ? '🔒' : (on ? 'ВКЛ' : 'ВЫКЛ');
      });
    }
  }

  /* Service worker: офлайн-кэш оболочки. Любая ошибка регистрации не должна
     влиять на игру — поэтому всё под try/catch и только на https/localhost. */
  function registerSW() {
    try {
      if (!root.navigator || !root.navigator.serviceWorker) return;
      var cfg = root.PO_CONFIG || {};
      if (cfg.serviceWorker === false) return;
      var secure = location.protocol === 'https:' ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!secure) return;
      var hadController = !!root.navigator.serviceWorker.controller;
      var scope = cfg.swScope || './';
      var swUrl = new URL('sw.js', new URL(scope, location.href)).href;
      root.navigator.serviceWorker.register(swUrl, { scope: scope, updateViaCache: 'none' })
        .then(function (reg) {
          if (cfg.debug) console.log('[sw] зарегистрирован:', reg.scope);
        })
        .catch(function (e) { if (cfg.debug) console.log('[sw] отключён:', e.message); });
      /* новая версия SW перехватила страницу — перезагружаем один раз,
         чтобы игрок не остался на старом коде после деплоя */
      var reloaded = false;
      root.navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });
    } catch (e) { /* service worker не обязателен */ }
  }

  root.MAIN = { boot: boot, paintHUD: paintHUD, syncSettingsUI: syncSettingsUI, applySettings: applySettings };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
