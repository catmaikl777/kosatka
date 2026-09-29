/* ============================================================
   PIXEL ORCA — PvP баттл и рейды 3x3
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, API = root.API, SPR = root.PO_SPR;
  var modal = null, arena = null, actx = null;
  var mode = null;           /* 'pvp' | 'raid' */
  var myScore = 0, foeScore = 0, timeLeft = 0, running = false;
  var pendingClicks = 0, sendT = 0, lastTs = 0, lastMyClick = 0;
  var myClicks = 0;   /* клики в текущем бою — по ним считаются билеты ивента */
  var serverDraw = false;  /* ничья по мнению сервера */
  var settled = false;     /* бой уже рассчитан и награда выдана — повторно не платим */
  var raidTeam = null, foeTeam = null, teamScore = 0, foeTeamScore = 0;
  var mySlot = 0;
  var splashes = [];

  /* ================= PvP ================= */
  function openPvP() {
    mode = 'pvp';
    modal = UI.modalShell('⚔️ PvP БАТТЛ', lobbyHtml());
    wireLobby();
    refreshLobbies();
  }

  function lobbyHtml() {
    return '<div id="pvLobby" class="battle-lobby">' +
      (API.online ? '' : '<div class="warn">Сервер недоступен — доступен бой с ботом.</div>') +
      '<div class="lobby-form">' +
      '<button class="px-btn px-btn-small" id="pvCreateOpen">СОЗДАТЬ ОТКРЫТОЕ</button>' +
      '<button class="px-btn px-btn-small" id="pvCreateClosed">СОЗДАТЬ С КОДОМ</button>' +
      '<button class="px-btn px-btn-small" id="pvRefresh">ОБНОВИТЬ</button>' +
      '<button class="px-btn px-btn-small" id="pvCode">ПО КОДУ</button>' +
      (API.online ? '' : '<button class="px-btn px-btn-small px-btn-primary" id="pvBot">БОЙ С БОТОМ</button>') +
      '</div>' +
      '<div id="pvMyLobby" class="my-lobby"></div>' +
      '<h4 class="sec-h">Открытые лобби</h4><div id="pvList" class="lobby-list">—</div></div>' +
      '<div id="pvArena" class="battle-arena hide"></div>';
  }

  function wireLobby() {
    var m = modal;
    m.querySelector('#pvCreateOpen').addEventListener('click', function () { API.pvpCreate('open').then(refreshLobbies).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); }); });
    m.querySelector('#pvCreateClosed').addEventListener('click', function () { API.pvpCreate('closed').then(refreshLobbies).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); }); });
    m.querySelector('#pvRefresh').addEventListener('click', refreshLobbies);
    m.querySelector('#pvCode').addEventListener('click', function () {
      UI.prompt('Войти по коду', 'Код лобби').then(function (v) {
        if (!v) return;
        API.pvpJoinCode(v.toUpperCase()).then(refreshLobbies).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
    var bot = m.querySelector('#pvBot');
    if (bot) bot.addEventListener('click', function () { startBotMatch(); });
  }

  function refreshLobbies() {
    var box = modal && modal.querySelector('#pvList');
    if (!box) return;
    if (!API.online) { box.innerHTML = '<div class="dim">Сервер недоступен</div>'; return; }
    box.innerHTML = 'загрузка…';
    API.pvpLobbies().then(renderLobbies).catch(function (e) {
      var b = modal && modal.querySelector('#pvList');
      if (b) b.innerHTML = '<div class="dim">Не удалось получить список лобби</div>';
      void e;
    });
  }

  /* Рендер уже полученных строк. Важно: обработчик события 'pvp:lobbies' должен
     вызывать именно renderLobbies, а не refreshLobbies — иначе клиент бесконечно
     переспрашивает список у сервера, пока открыто окно PvP. */
  function renderLobbies(rows) {
    var box = modal && modal.querySelector('#pvList');
    if (!box) return;
    if (!rows || !rows.length) { box.innerHTML = '<div class="dim">Лобби пока пусты. Создай своё!</div>'; return; }
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      h += '<div class="lobby-row"><b>' + UI.escapeHtml(r.owner) + '</b>' +
        (r.type === 'closed' ? ' <i>закрытое</i>' : ' <i>открытое</i>') +
        '<span>' + (r.ready ? 'готов' : 'ждёт') + '</span>' +
        '<button class="px-btn px-btn-small" data-join="' + r.id + '">В БОЙ</button></div>';
    }
    box.innerHTML = h;
    box.querySelectorAll('[data-join]').forEach(function (b) {
      b.addEventListener('click', function () {
        API.pvpJoin(+b.dataset.join).then(refreshLobbies).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
  }

  function showMyLobby(lb) {
    var box = modal && modal.querySelector('#pvMyLobby');
    if (!box) return;
    if (!lb) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="my-lobby-box"><b>Твоё лобби</b>' +
      '<div>Владелец: ' + UI.escapeHtml(lb.owner) + '</div>' +
      (lb.code ? '<div>Код: <b class="clan-code">' + lb.code + '</b></div>' : '') +
      '<div>Соперник: ' + (lb.opponent ? UI.escapeHtml(lb.opponent) : 'ожидание…') + '</div>' +
      '<div class="lobby-row">' +
      '<button class="px-btn px-btn-small px-btn-primary" id="pvReady">' + (lb.ready ? 'ГОТОВ ✅' : 'Я ГОТОВ') + '</button>' +
      '<button class="px-btn px-btn-small px-btn-danger" id="pvLeave">ВЫЙТИ</button>' +
      (lb.owner === (ST.state.account.name || '') ? '<button class="px-btn px-btn-small" id="pvStart">НАЧАТЬ</button>' : '') +
      '</div></div>';
    var r = box.querySelector('#pvReady');
    if (r) r.addEventListener('click', function () { API.pvpReady(!lb.ready); });
    var l = box.querySelector('#pvLeave');
    if (l) l.addEventListener('click', function () { API.pvpLeave(); refreshLobbies(); });
    var s = box.querySelector('#pvStart');
    if (s) s.addEventListener('click', function () { API.send('pvp:start').catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); }); });
  }

  /* ================= АРЕНА ================= */
  function buildArena(foeName, foeSkin, mySkin, duration, kind) {
    var m = modal;
    if (!m) return;
    /* у дуэли контейнеры pvLobby/pvArena, у рейда — rdLobby/rdArena */
    var lobbyEl = m.querySelector(kind === 'raid' ? '#rdLobby' : '#pvLobby');
    var box = m.querySelector(kind === 'raid' ? '#rdArena' : '#pvArena');
    if (lobbyEl) lobbyEl.classList.add('hide');
    if (!box) { root.UI.toast('Не найден экран арены', 'bad', 'i_lock'); return; }
    box.classList.remove('hide');
    box.innerHTML =
      '<div class="arena-head"><div class="arena-time" id="arTime">' + duration + '</div>' +
      '<div class="arena-kind">' + (kind === 'raid' ? 'РЕЙД 3x3' : 'ДУЭЛЬ') + '</div></div>' +
      '<canvas id="arCv" class="arena-cv"></canvas>' +
      '<div class="arena-sides">' +
      '<div class="arena-side me"><b>' + UI.escapeHtml(ST.state.account.name || 'Ты') + '</b><div class="arena-score" id="arMe">0</div><div class="arena-cps" id="arMeCps">0 к/с</div></div>' +
      '<div class="arena-vs">VS</div>' +
      '<div class="arena-side foe"><b>' + UI.escapeHtml(foeName || 'Соперник') + '</b><div class="arena-score" id="arFoe">0</div><div class="arena-cps" id="arFoeCps">0 к/с</div></div>' +
      '</div>' +
      '<button class="arena-btn" id="arBtn">КЛИКАЙ!!!</button>' +
      (kind === 'raid' ? '<div class="arena-teams" id="arTeams"></div>' : '');
    arena = box.querySelector('#arCv');
    actx = arena.getContext('2d');
    box.querySelector('#arBtn').addEventListener('pointerdown', function (e) { e.preventDefault(); battleClick(); });
    resizeArena();
  }

  function resizeArena() {
    if (!arena) return;
    var px = 3;
    var host = arena.parentElement || modal;
    var bw = (host && host.clientWidth) || 320;
    var w = Math.max(120, Math.floor(bw / px));
    /* Арена рисуется в пропорциях 3:2. Раньше ширину расширяли
       Math.max(180, …), а высоту держали 66 — на узком экране канвас
       растягивался по горизонтали и ора в нём выглядела сплющенной.
       Теперь минимум расширяется с сохранением пропорций 3:2. */
    var h = Math.round(w * 2 / 3);
    if (h < 40) { h = 40; w = Math.round(h * 3 / 2); }
    arena.width = w; arena.height = h;
    /* ширину ограничиваем контейнером, чтобы арена не вылезала за экран */
    var cssW = Math.min(w * px, bw);
    arena.style.width = cssW + 'px';
    arena.style.height = Math.round(cssW * 2 / 3) + 'px';
    actx.imageSmoothingEnabled = true;
    actx.imageSmoothingQuality = 'high';
  }

  var myCpsWin = [], foeCpsWin = [];
  function battleClick() {
    if (!running || !modal) return;
    myScore++;
    myClicks++;
    pendingClicks++;
    lastMyClick = Date.now();   /* свой орка чуть подпрыгивает после клика */
    root.SND.play('click');
    var r = arena.getBoundingClientRect();
    splash(Math.random() * r.width / 3 + 40, Math.random() * r.height / 3 + 20, '#ffffff');
    flushClicks(false);
    updateScore();
  }

  /* Клики отправляем пачками раз в ~100мс, а не по одному сообщению на клик:
     при 20-30 кликах в секунду поток «выбивал» лимит запросов на сервере. */
  function flushClicks(force) {
    if (!pendingClicks) return;
    var now = Date.now();
    if (!force && now - sendT < 100) return;
    sendT = now;
    /* сервер принимает максимум 50 кликов за сообщение — режем крупными пачками */
    while (pendingClicks > 0) {
      var n = Math.min(50, pendingClicks);
      pendingClicks -= n;
      if (mode === 'pvp') API.pvpClicks(n);
      else API.raidClicks(n);
    }
  }

  function updateScore() {
    if (!modal) return;
    var me = modal.querySelector('#arMe'), foe = modal.querySelector('#arFoe');
    if (!me) return;
    if (mode === 'pvp') {
      me.textContent = ST.fmt(myScore);
      foe.textContent = ST.fmt(foeScore);
    } else {
      me.textContent = ST.fmt(teamScore);
      foe.textContent = ST.fmt(foeTeamScore);
    }
    var now = Date.now();
    myCpsWin.push(now); foeCpsWin.push(now);
  }
  function cps(arr) {
    var now = Date.now(), n = 0;
    for (var i = arr.length - 1; i >= 0; i--) if (now - arr[i] < 1000) n++; else arr.splice(i, 1);
    return n;
  }

  function splash(x, y, c) {
    splashes.push({ x: x, y: y, c: c, life: 300, max: 300 });
  }

  /* Длительность по протоколу приходит В СЕКУНДАХ (так шлёт сервер:
     server.js отдаёт PVP_MS/1000 и RAID_MS/1000), а счётчик обратного
     отсчёта уменьшается на dt кадра, то есть в миллисекундах. Раньше
     30 секунд попадали в счётчик как 30 мс — бой умирал за 4-6 кадров,
     то есть выглядел как мгновенный. Здесь единый перевод в мс. */
  function toMs(v, fallbackSec) {
    var n = Number(v);
    if (!(n > 0)) n = Number(fallbackSec) || 30;
    return n * 1000;
  }

  function startMatch(duration, foeName, foeSkin, kind) {
    myScore = 0; foeScore = 0; teamScore = 0; foeTeamScore = 0;
    myClicks = 0;
    serverDraw = false;
    timeLeft = toMs(duration, kind === 'raid' ? 60 : 30);
    pendingClicks = 0;
    lastMyClick = 0;
    lastTickSec = -1;
    splashes = [];
    settled = false;
    myCpsWin = []; foeCpsWin = [];   /* без сброса «к/с» считались по всем боям подряд */
    buildArena(foeName, foeSkin, skinPal(), duration, kind);
    root.CLICK.battleMode = true;
    root.CLICK.battleCallback = battleClick;
    running = true;
    lastTs = 0;
    requestAnimationFrame(loop);
    root.SND.play('battle');
  }

  function skinPal() {
    var s = ST.skin(ST.state.skin);
    return s ? s.pal : 'normal';
  }

  var foeSkin = 'normal';
  var foeName = '';
  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(100, ts - lastTs);
    lastTs = ts;
    timeLeft -= dt;
    var t = ts / 1000;
    if (!botMode) flushClicks(false);      /* раз в кадр: отправка накопленных кликов */
    if (modal) {
      var tel = modal.querySelector('#arTime');
      if (tel) {
        var s = Math.max(0, Math.ceil(timeLeft / 1000));
        tel.textContent = s;
        tel.className = 'arena-time' + (s <= 5 ? ' danger' : '');
        if (s <= 5 && s !== lastTickSec) { lastTickSec = s; root.SND.play('tick'); }
      }
      var mc = modal.querySelector('#arMeCps'), fc = modal.querySelector('#arFoeCps');
      if (mc) mc.textContent = cps(myCpsWin) + ' к/с';
      if (fc) fc.textContent = (mode === 'pvp' ? cps(foeCpsWin) + ' к/с' : foeTeamScore + ' очк.');
    }
    /* бот */
    if (botMode) {
      botCps = Math.max(2, Math.min(14, botCps + (Math.random() - 0.5) * 0.6));
      botAcc += botCps * dt / 1000;
      while (botAcc >= 1) {
        botAcc -= 1;
        if (mode === 'pvp') foeScore += ST.perClick(0);
        else foeTeamScore += ST.perClick(0) * 3;
      }
      if (Math.random() < 0.3) splash(Math.random() * 120 + 60, Math.random() * 60 + 20, '#e04a5a');
    }
    updateScore();
    for (var i = splashes.length - 1; i >= 0; i--) {
      splashes[i].life -= dt;
      if (splashes[i].life <= 0) splashes.splice(i, 1);
    }
    drawArena(t);
    if (timeLeft <= 0) { finish(); return; }
    requestAnimationFrame(loop);
  }
  var lastTickSec = -1;

  function drawArena(t) {
    if (!actx) return;
    var W = arena.width, H = arena.height;
    /* вода */
    for (var y = 0; y < H; y += 2) {
      actx.fillStyle = y < H * 0.5 ? '#1e5a8a' : (y < H * 0.75 ? '#164a78' : '#0e3560');
      actx.fillRect(0, y, W, 2);
    }
    actx.fillStyle = '#2a5a9a';
    for (var x = 0; x < W; x += 3) {
      var wy = H * 0.5 + Math.sin(x * 0.07 + t * 2) * 2;
      actx.fillRect(x, Math.round(wy), 3, 1);
    }
    /* бойцы */
    var sc = 3;
    var myY = H * 0.28 + Math.sin(t * 2) * 2;
    var foeY = H * 0.28 + Math.sin(t * 2 + 1) * 2;
    var bob1 = Math.sin(t * 6) * (Date.now() - (lastMyClick || 0) < 120 ? 1 : 0);
    SPR.draw(actx, 'orca', W * 0.16, myY - bob1, sc, { pal: skinPal(), outline: true, flip: true });
    SPR.draw(actx, 'orca', W * 0.62, foeY, sc, { pal: foeSkin, outline: true, flip: false });
    if (mode === 'raid') {
      for (var m = 0; m < 2; m++) {
        SPR.draw(actx, 'orca', W * 0.05, H * 0.62 + m * 18, 2, { pal: skinPal(), outline: true, flip: true });
        SPR.draw(actx, 'orca', W * 0.72, H * 0.62 + m * 18, 2, { pal: foeSkin, outline: true });
      }
    }
    actx.globalAlpha = 0.9;
    root.FX.drawTextC(actx, 'VS', W / 2, H * 0.22, '#ffd447', 3);
    actx.globalAlpha = 1;
    /* всплески */
    for (var i = 0; i < splashes.length; i++) {
      var s = splashes[i];
      actx.globalAlpha = s.life / s.max;
      actx.fillStyle = s.c;
      actx.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
    }
    actx.globalAlpha = 1;
  }

  var botMode = false, botCps = 5, botAcc = 0;
  function startBotMatch() {
    botMode = true;
    foeName = ['Бот-Китовый', 'Бот-Морской волк', 'Бот-Ихтиандр', 'Бот-Пиксель'][Math.floor(Math.random() * 4)];
    foeSkin = ['pirate', 'lava', 'ice', 'neon', 'galaxy'][Math.floor(Math.random() * 5)];
    startMatch(30, foeName, foeSkin, 'pvp');
  }

  function finish() {
    if (!running) return;
    running = false;
    settled = true;        /* награда выдаётся ровно один раз за бой */
    /* досылаем накопленные клики, чтобы последние не потерялись */
    if (!botMode && mode) flushClicks(true);
    root.CLICK.battleMode = false;
    root.CLICK.battleCallback = null;

    var my, foe;
    if (mode === 'pvp') { my = myScore; foe = foeScore; }
    else { my = teamScore; foe = foeTeamScore; }
    /* равный счёт — это ничья, а не победа */
    var draw = serverDraw || Math.round(my) === Math.round(foe);
    var win = !draw && my > foe;
    var lose = !win && !draw;
    serverDraw = false;

    var reward = Math.floor((win ? 2000 : draw ? 900 : 400) * ST.state.level * (mode === 'raid' ? 3 : 1));
    ST.addCoins(reward, true);

    if (mode === 'pvp') {
      ST.state.stats.pvpPlayed++;
      ST.bump('pvpPlayed');
      if (win) { ST.state.stats.pvpWins++; ST.bump('pvpWins'); }
      else if (lose) ST.state.stats.pvpLose = (ST.state.stats.pvpLose || 0) + 1;
    } else {
      ST.state.stats.raidPlayed++;
      ST.bump('raidPlayed');
      if (win) { ST.state.stats.raidWins++; ST.bump('raidWins'); }
    }

    /* серия побед (для достижения «На кураже») */
    if (win) {
      ST.state.stats.winStreak = (ST.state.stats.winStreak || 0) + 1;
      ST.bump('winStreak');
      if (ST.state.stats.winStreak > (ST.state.stats.bestWinStreak || 0)) {
        ST.state.stats.bestWinStreak = ST.state.stats.winStreak;
        ST.bump('bestWinStreak');
      }
    } else {
      ST.state.stats.winStreak = 0;
    }

    /* скин за 5 побед в рейдах — ищем по флагу, а не по захардкоженному id */
    if (win && mode === 'raid') {
      for (var i = 0; i < D.SKINS.length; i++) {
        var s = D.SKINS[i];
        if (s.raid && ST.state.stats.raidWins >= s.raid && ST.state.skinsOwned.indexOf(s.id) < 0) {
          ST.unlockSkin(s.id);
        }
      }
    }

    /* билеты ивента — за клики в самом бою */
    var tickets = Math.floor(myClicks / D.EVENT.pvpClickDiv);
    ST.save();
    if (tickets > 0) ST.addTickets(tickets);

    root.SND.play(win ? 'win' : lose ? 'lose' : 'click');
    var title = win ? 'ПОБЕДА!' : draw ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ';
    var cls = win ? 'banner-good' : lose ? 'banner-bad' : 'banner-info';
    UI.banner(title, cls, 1800);

    var html = '<div class="result-box">' +
      '<div class="result-score">' + ST.fmt(my) + ' : ' + ST.fmt(foe) + '</div>' +
      '<div class="result-reward">Награда: ' + ST.fmt(reward) + ' косаток</div>' +
      '<div class="result-tickets">Билеты ивента: +' + tickets +
      ' <span class="dim">(' + myClicks + ' кликов / ' + D.EVENT.pvpClickDiv + ')</span></div></div>';
    /* Арену закрываем сразу — бой окончен, а updateScore/drawArena больше
       не нужны. Раньше окно результата не запоминалось в modal, поэтому
       closeModal() через 2.6с закрывал арену, а «ПОБЕДА» оставалось висеть. */
    if (modal) { UI.closeEl(modal); modal = null; }
    arena = null; actx = null;

    var m = UI.modalShell(win ? 'ПОБЕДА' : draw ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ', html,
      { footer: '<button class="px-btn px-btn-primary" data-close="1">В меню</button>' });
    modal = m;
    if (root.QUESTS) root.QUESTS.check();
    setTimeout(function () { if (modal === m) closeModal(); }, 2600);
  }

  function closeModal() {
    if (modal) { UI.closeEl(modal); modal = null; }
    arena = null; actx = null; running = false;
    root.CLICK.battleMode = false;
    root.CLICK.battleCallback = null;
    /* mode/botMode ОБЯЗАТЕЛЬНО сбрасываем: иначе через 30 секунд придёт
       серверный pvp:end, его обработчик увидит mode === 'pvp' и начислит
       награду повторно — бой уже рассчитан локально в finish(). */
    mode = ''; botMode = false;
  }

  /* ================= РЕЙДЫ ================= */
  function openRaid() {
    mode = 'raid';
    modal = UI.modalShell('⚔️ РЕЙД 3x3', '<div id="rdLobby" class="battle-lobby">' +
      (API.online ? '' : '<div class="warn">Сервер недоступен — рейд с ботом доступен всегда.</div>') +
      '<div class="lobby-form">' +
      '<button class="px-btn px-btn-small" id="rdCreate">СОЗДАТЬ КОМАНДУ</button>' +
      '<button class="px-btn px-btn-small" id="rdRefresh">ОБНОВИТЬ</button>' +
      '<button class="px-btn px-btn-small px-btn-primary" id="rdSearch">ИСКАТЬ БОЙ</button>' +
      '<button class="px-btn px-btn-small" id="rdBot">РЕЙД С БОТАМИ</button>' +
      '</div>' +
      '<div id="rdMyTeam" class="my-lobby"></div>' +
      '<h4 class="sec-h">Открытые команды</h4><div id="rdList" class="lobby-list">—</div></div>' +
      '<div id="rdArena" class="battle-arena hide"></div>');
    refreshTeams();
    modal.querySelector('#rdCreate').addEventListener('click', function () {
      API.raidCreate(true).then(refreshTeams).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
    });
    modal.querySelector('#rdRefresh').addEventListener('click', refreshTeams);
    modal.querySelector('#rdSearch').addEventListener('click', function () {
      API.raidSearch().then(function (r) {
        if (r && r.status === 'searching') UI.toast('Ищем соперников…', 'info', 'i_team');
        else if (r && r.status === 'need') UI.toast('Нужен противник', 'bad', 'i_lock');
      }).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
    });
    modal.querySelector('#rdBot').addEventListener('click', function () {
      botMode = true;
      foeName = 'Боты';
      foeSkin = 'pirate';
      startMatch(60, 'Боты', foeSkin, 'raid');
    });
  }

  function refreshTeams() {
    var box = modal && modal.querySelector('#rdList');
    if (!box) return;
    if (!API.online) { box.innerHTML = '<div class="dim">Сервер недоступен</div>'; return; }
    /* полный ответ {rows, my}: список команд для #rdList и «моя команда»
       для панели #rdMyTeam (ранее my терялся — после создания комнаты
       игрок не видел её и не мог выйти/удалить) */
    API.raidTeams().then(function (m) {
      renderTeams((m && m.rows) || []);
      showMyTeam((m && m.my) || null);
    }).catch(function () {
      var b = modal && modal.querySelector('#rdList');
      if (b) b.innerHTML = '<div class="dim">Не удалось получить список команд</div>';
    });
  }

  /* как и в PvP: событие 'raid:teams' рендерит, а не переспрашивает сервер */
  function renderTeams(rows) {
    var box = modal && modal.querySelector('#rdList');
    if (!box) return;
    if (!rows || !rows.length) { box.innerHTML = '<div class="dim">Команд пока нет</div>'; return; }
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      h += '<div class="lobby-row"><b>' + UI.escapeHtml(r.owner) + '</b><span>' + r.players + '/3</span>' +
        '<button class="px-btn px-btn-small" data-join="' + r.id + '">ВСТУПИТЬ</button></div>';
    }
    box.innerHTML = h;
    box.querySelectorAll('[data-join]').forEach(function (b) {
      b.addEventListener('click', function () {
        API.raidJoin(+b.dataset.join).then(refreshTeams).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
  }

  function showMyTeam(team) {
    var box = modal && modal.querySelector('#rdMyTeam');
    if (!box) return;
    if (!team) { box.innerHTML = ''; return; }
    /* server.js teamView отдаёт players как ЧИСЛО участников,
       а список имён лежит в names. Раньше код брал team.players[i]
       и цикл не выполнялся — состав команды был всегда пуст. */
    var names = team.names || [];
    var h = '<div class="my-lobby-box"><b>Команда ' + UI.escapeHtml(team.owner) + '</b>' +
      '<div class="dim">участников: ' + (team.players || 0) + '/3</div><div class="raid-mem">';
    for (var i = 0; i < names.length; i++) {
      h += '<span>' + UI.escapeHtml(names[i]) + '</span>';
    }
    h += '</div><button class="px-btn px-btn-small px-btn-danger" id="rdLeave">ВЫЙТИ ИЗ КОМАНДЫ</button>' +
      '<button class="px-btn px-btn-small px-btn-primary" id="rdGo">В БОЙ</button></div>';
    box.innerHTML = h;
    box.querySelector('#rdLeave').addEventListener('click', function () { API.raidLeave(); refreshTeams(); });
    box.querySelector('#rdGo').addEventListener('click', function () { API.raidSearch(); });
  }

  /* ================= серверные события ================= */
  function initServerEvents() {
    API.on('pvp:lobbies', function (m) {
      /* сервер сам рассылает список при изменениях — рисуем его, не переспрашивая */
      if (modal && mode === 'pvp') { renderLobbies(m.rows); }
      if (m.my) showMyLobby(m.my);
    });
    API.on('pvp:joined', function (m) {
      if (modal && mode === 'pvp') { showMyLobby(m.lobby); refreshLobbies(); }
      root.SND.play('ui');
    });
    API.on('pvp:start', function (m) {
      botMode = false;
      foeName = m.foe;
      foeSkin = m.foeSkin || 'normal';
      /* сервер может начать бой, даже если игрок закрыл окно или был в другом экране —
         тогда окно надо открыть заново, иначе buildArena упадёт на null */
      if (!modal || mode !== 'pvp') { closeModal(); openPvP(); }
      startMatch(m.duration || 30, m.foe, foeSkin, 'pvp');
    });
    API.on('pvp:tick', function (m) {
      if (mode !== 'pvp' || !running) return;
      if (m.you != null) { myScore = m.you; foeScore = m.foe; }
      /* сервер шлёт оставшееся время в секундах; без проверки undefined
         счётчик ушёл бы в NaN и бой не закончился бы никогда */
      if (m.time != null) timeLeft = toMs(m.time, 30);
    });
    API.on('pvp:end', function (m) {
      if (mode !== 'pvp') return;
      if (m.you != null) { myScore = m.you; foeScore = m.foe; }
      if (running) { finish(); return; }
      /* бой уже рассчитан локально — повторно платить нельзя, иначе игрок
         забирает награду дважды: от своего таймера и от серверного итога */
      if (settled) return;
      {
        /* бой закончился, пока окно лобби ещё было открыто */
        settled = true;
        var isDraw = !!m.draw;
        ST.addCoins(Math.floor((m.win ? 2000 : isDraw ? 900 : 400) * ST.state.level), true);
        if (m.win) { ST.state.stats.pvpWins++; ST.bump('pvpWins'); }
        else if (!isDraw) ST.state.stats.pvpLose = (ST.state.stats.pvpLose || 0) + 1;
        ST.state.stats.pvpPlayed++;
        ST.bump('pvpPlayed');
        var tk = Math.floor((m.yourClicks || 0) / D.EVENT.pvpClickDiv);
        if (tk > 0) ST.addTickets(tk);
        ST.save();
        root.SND.play(m.win ? 'win' : isDraw ? 'ui' : 'lose');
        UI.banner(m.win ? 'ПОБЕДА!' : isDraw ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ',
          m.win ? 'banner-good' : isDraw ? 'banner-info' : 'banner-bad', 1600);
      }
    });
    API.on('pvp:left', function () { if (modal && mode === 'pvp') { showMyLobby(null); refreshLobbies(); } });

    API.on('raid:teams', function (m) {
      if (modal && mode === 'raid') { renderTeams((m && m.rows) || []); showMyTeam((m && m.my) || null); }
    });
    API.on('raid:team', function (m) { if (modal && mode === 'raid') showMyTeam(m.team); });
    API.on('raid:start', function (m) {
      botMode = false;
      foeName = 'Команда ' + (m.foe && m.foe.owner ? m.foe.owner : '?');
      foeSkin = (m.foe && m.foe.skin) || 'pirate';
      /* как и в дуэли: бой мог начаться без открытого окна */
      if (!modal || mode !== 'raid') { closeModal(); openRaid(); }
      startMatch(m.duration || 60, foeName, foeSkin, 'raid');
    });
    API.on('raid:tick', function (m) {
      if (mode !== 'raid' || !running) return;
      if (m.you != null) { teamScore = m.you; foeTeamScore = m.foe; }
      if (m.time != null) timeLeft = toMs(m.time, 60);
    });
    API.on('raid:end', function (m) {
      if (mode !== 'raid') return;
      if (settled) return;
      if (m.you != null) { teamScore = m.you; foeTeamScore = m.foe; }
      serverDraw = !!m.draw;
      if (running) finish();
    });
  }

  root.BATTLE = {
    openPvP: openPvP, openRaid: openRaid, initServerEvents: initServerEvents,
    close: closeModal
  };
})(typeof window !== 'undefined' ? window : globalThis);
