/* ============================================================
   PIXEL ORCA — набор пиксель-арт спрайтов
   Все спрайты — ASCII- grids, рендерятся в canvas 1:1,
   потом масштабируются nearest-neighbour (жёсткие пиксели).
   ============================================================ */
(function (root, factory) {
  var PO = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = PO;
  root.PO_SPR = PO;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ---------- базовая палитра ---------- */
  var BASE = {
    '.': null,        /* прозрачный */
    k: '#0a0c1c',     /* контур / тень */
    d: '#1b2a4a',     /* тёмное тело */
    m: '#2f4a7a',     /* средний тон */
    l: '#4a74b0',     /* свет */
    h: '#7fa8d8',     /* блик */
    w: '#f2f6ff',     /* белый */
    s: '#c3cfe8',     /* тень белого */
    e: '#0a0c1c',     /* глаз */
    r: '#e04a5a',     /* красный */
    R: '#a02a3c',     /* тёмно-красный */
    o: '#f09040',     /* оранж */
    O: '#c05a20',     /* тёмный оранж */
    y: '#ffd447',     /* золото */
    Y: '#c89020',     /* тёмное золото */
    g: '#4ad07a',     /* зелёный */
    G: '#2a8a4a',     /* тёмный зелёный */
    b: '#3a6fd0',     /* синий */
    B: '#1e3a80',     /* тёмный синий */
    p: '#a04ad0',     /* фиолетовый */
    P: '#5a2a90',     /* тёмный фиолет */
    c: '#4ae0e0',     /* бирюза */
    C: '#2a9090',     /* тёмная бирюза */
    n: '#5a3a2a',     /* коричневый */
    N: '#3a241a',     /* тёмный коричневый */
    x: '#ffffff',     /* искра */
    q: '#f0d0a0',     /* песок */
    v: '#2a2a3a',     /* железо */
    V: '#15151f',     /* тёмное железо */
    f: '#e8dcc0',     /* перламутр */
    z: '#7fffd4',     /* мятный */
    u: '#ff6bd6'      /* розовый */
  };

  /* ============================================================
     СПРАЙТЫ
     ============================================================ */

  /* основной спрайт: орка 16x14 */
  var ORCA_MAIN = [
    '..........dd........',
    '........dddddd......',
    '.......ddddddddd....',
    '.dddd..dddddddddd...',
    '.dddddddddddddddd...',
    '.ddddddddddddddddd..',
    '.ddd..dddddddddwwwe.',
    '.ddd..dddddddwwwwmm.',
    '.ddd..ddddddwwwwwwwd',
    'dddd.dddddddssssswwd',
    '.ddd..ddddddddsswwdd',
    '.ddddddddddd..dddd..',
    'ddd....dddd....d....',
    '........dd..........'
  ];

  var FISH_SMALL = [
    '...ccc.....',
    '.cccccc.cc.',
    'ccwccccccw.',
    'ccccceccw..',
    '.cccccc.cc.',
    '...ccc.....'
  ];

  var FISH_GOLD = [
    '...yyy.....',
    '.yyyyyy.yy.',
    'yywyyyyyyw.',
    'yyyyyeyyw..',
    '.yyyyyy.yy.',
    '...yyy.....'
  ];

  var FISH_SPACE = [
    '...ppp.....',
    '.pppppp.pp.',
    'ppwppppppwp',
    'ppppepppw..',
    '.pppppp.pp.',
    '...ppp.....'
  ];

  var CRAB = [
    '..r..r...',
    '.rrrrrrr.',
    'rrrrrrrrr',
    'reerrreer',
    'rrrrrrrrr',
    '.o.o.o.o.',
    'o..o.o..o'
  ];

  /* ---------- боксы ---------- */
  var BOX_COMMON = [
    '..NNNNNNNNNN..',
    '.NvvvvvvvvvvN.',
    'NvggggggggggvN',
    'NvgqqqqqqqqgvN',
    'NvgqwwwwwwqgvN',
    'NvgqwkkkkwqgvN',
    'NvgqwkwkwkqgvN',
    'NvgqwkkkkwqgvN',
    'NvgqqqqqqqqgvN',
    'NvgqqqqqqqqgvN',
    'NvgqqqqqqqqgvN',
    'NvggggggggggvN',
    'Nvgg.gggg.ggvN',
    '.NvvvvvvvvvvN.',
    '..NNNNNNNNNN..'
  ];

  var BOX_RARE = [
    '..BBBBBBBBBB..',
    '.BvvvvvvvvvvB.',
    '.BvcccccccccB.',
    '.BvcwwwwwwcvB.',
    '.BvcwkkkkkwcB.',
    '.BvcwkwkwkwcB.',
    '.BvcwkwkwkwcB.',
    '.BvcwkkkkkwcB.',
    '.BvcwwwwwwcvB.',
    '.BvccccvcccvB.',
    '.Bvc.cc.cccvB.',
    '.BvccccvcccvB.',
    '.BvcccccccccB.',
    '.Bvv.vv.vvvvB.',
    '..BBBBBBBBBB..'
  ];

  var BOX_EPIC = [
    '..PPPPPPPPPP..',
    '.PvvvvvvvvvvP.',
    '.PvpqqqqqqqpP.',
    '.PvpqqqqqqqpP.',
    '.PvprrrrrrrpP.',
    '.PvprwwwwwrpP.',
    '.PvprwwwwwrpP.',
    '.PvprwwwwwrpP.',
    '.PvprrrrrrrpP.',
    '.PvprrrrrrrpP.',
    '.PvpqqqqqqqpP.',
    '.PvpqqqqqqqpP.',
    '.PvpqqqqqqqpP.',
    '.Pvpq.pp.pppP.',
    '..PPPPPPPPPP..'
  ];

  var BOX_LEGEND = [
    '..OOyyyyyyOO..',
    '.OyffffffffyO.',
    '.OyffwwwwffyO.',
    '.OyfwxxxxwfyO.',
    '.OywxxxxxxwyO.',
    '.OywxxxxxxwyO.',
    '.OywxxxxxxwyO.',
    '.OywxxxxxxwyO.',
    '.OywxxxxxxwyO.',
    '.OywxxxxxxwyO.',
    '.OywxxxxxxwyO.',
    '.OyfwxxxxwfyO.',
    '.OyffwwwwffyO.',
    '.OyffffffffyO.',
    '.Oyf.o.ooffyO.',
    '..OOyyyyyyOO..'
  ];

  /* ---------- бонусы ---------- */
  var STAR_X2 = [
    '....y....',
    '...yyy...',
    'yyyyyyyyy',
    '.yyyyyyy.',
    '..yyyyy..',
    '.yyy.yyy.',
    'yyy...yyy',
    'y.......y'
  ];

  var COIN = [
    '.YYYY.',
    'YyyyyY',
    'YyeYyY',
    'YyeeYy',
    'YyyeyY',
    '.YYYY.'
  ];

  var SHELL = [
    '..f..',
    '.fff.',
    'ffwff',
    'fwwff',
    'fffff',
    '.ooo.'
  ];

  var TICKET = [
    '..pppp..',
    '.pyyyyp.',
    'pyeyyyp.',
    'pyyyyyp.',
    'pyyyyyp.',
    'pyyyp...',
    '.pppp...'
  ];

  var CRIT_SKULL = [
    '.wwww.',
    'wwwwww',
    'wewwew',
    'wwwwww',
    '.wwww.',
    'wewwew',
    '.wwww.'
  ];

  /* ---------- иконки 8x8 ---------- */
  var ICON = {
    coin: [
      '..yyyy..',
      '.ywwwwy.',
      'ywwewwy.',
      'ywweewy.',
      'ywwewwy.',
      '.ywwwwy.',
      '..yyyy..',
      '........'
    ],
    star: [
      '...y....',
      '...y....',
      'yyyyyyyy',
      '.yyyyyy.',
      '..yyyy..',
      '.yy..yy.',
      '.y....y.'
    ],
    bolt: [
      '....yyy.',
      '...yyy..',
      '..yyy...',
      'yyyyyy..',
      '...yyy..',
      '..yyy...',
      '.yyy....',
      'yy......'
    ],
    hand: [
      '..yy....',
      '.ywy.yy.',
      '.ywy.yy.',
      '.ywy.yy.',
      '.ywy.yy.',
      'yyyyyy..',
      'ywwwwy..',
      '.yyyy...'
    ],
    fish: [
      '..cc...',
      '.cccc.c',
      'cceccc.',
      '.cccc.c',
      '..cc...'
    ],
    shell: [
      '..ff..',
      '.fwwf.',
      'fwwwwf',
      'fwwwwf',
      'ffffff',
      '.oooo.'
    ],
    crit: [
      '..cccc..',
      'c....ccc',
      '..ceec..',
      'cc.ecc..',
      '..ceec..',
      'c....ccc',
      '..cccc..',
      '........'
    ],
    crown: [
      '..y..y..',
      '.y.yy.y.',
      '.yyyyyy.',
      'yyyyyyyy',
      'yyyyyyyy',
      '.oooooo.',
      '........'
    ],
    lock: [
      '.vvvv.',
      'v....v',
      'v.ww.v',
      'vvvvvv',
      'vvwwvv',
      'vvwwvv',
      'vvvvvv',
      '......'
    ],
    sword: [
      '....ww',
      '...ww.',
      '..ww..',
      '.www..',
      'rrwr..',
      '.rr...',
      'rrr...',
      'r.....'
    ],
    team: [
      'w..w..w.',
      'w..w..w.',
      'wwwwwww.',
      'wwwwwww.',
      'wwwwwww.',
      'w.ww.w..',
      'w.....w.',
      '........'
    ],
    flame: [
      '...o...',
      '..ooo..',
      '.ooroo.',
      'oorrroo',
      'orr.RRo',
      'or.RRoo',
      '.oRRo..',
      '..oo...'
    ],
    gift: [
      'rrrrrrrr',
      'rwrrrrrw',
      'rwwwwwwr',
      'rwwwwwwr',
      'rwwwwwwr',
      'rrrrrrrr',
      'rrrrrrrr',
      '........'
    ],
    heart: [
      '.rr.rr..',
      'rrrrrrr.',
      'rrrrrrr.',
      '.rrrrr..',
      '..rrr...',
      '...r....',
      '........',
      '........'
    ],
    skull: [
      '..wwww..',
      '.wwwwww.',
      'wwweeeww',
      'wwwwwwww',
      '.w.ww.w.',
      'wwweeeww',
      '..wwww..',
      '........'
    ],
    magnet: [
      'rwr..rwr',
      'rwr..rwr',
      'rwr..rwr',
      'rrrrrrrr',
      '.v....v.',
      '.v....v.',
      '.v....v.',
      '........'
    ],
    ladder: [
      'w.ww.ww.',
      'w.ww.ww.',
      'wwwwwwww',
      'w.ww.ww.',
      'w.ww.ww.',
      'wwwwwwww',
      'w.ww.ww.',
      'w.ww.ww.'
    ],
    book: [
      'rbbbbbbr',
      'rbyybbbr',
      'rbbbbbbr',
      'rbbbbbbr',
      'rbbbbbbr',
      'rbbbbbbr',
      'rrrrrrrr',
      '........'
    ],
    anvil: [
      'vvvvvvvv',
      'vvvvvvvv',
      'wwwwwwww',
      'wwwwwwww',
      '..wwww..',
      '..wwww..',
      '.wwwwww.',
      'vvvvvvvv'
    ],
    siren: [
      '...rr...',
      '..rrrr..',
      '.rr..rr.',
      'rr.ww.rr',
      'rr.ww.rr',
      '.rr..rr.',
      '..rrrr..',
      '...rr...'
    ]
  };

  var SPRITES = {
    orca: ORCA_MAIN,
    fish: FISH_SMALL,
    goldfish: FISH_GOLD,
    spacefish: FISH_SPACE,
    crab: CRAB,
    boxCommon: BOX_COMMON,
    boxRare: BOX_RARE,
    boxEpic: BOX_EPIC,
    boxLegend: BOX_LEGEND,
    starX2: STAR_X2,
    coin: COIN,
    shell: SHELL,
    ticket: TICKET,
    critSkull: CRIT_SKULL
  };
  var KEYS = Object.keys(ICON);
  for (var i = 0; i < KEYS.length; i++) SPRITES['i_' + KEYS[i]] = ICON[KEYS[i]];

  /* ============================================================
     ПАЛИТРЫ СКИНОВ
     ============================================================ */
  var SKIN_PAL = {
    normal: {},
    polar: { d: '#20304f', m: '#42597f', l: '#7f9ac0', h: '#c8d8f0', w: '#ffffff', s: '#dfe9f7' },
    golden: { d: '#6a4a10', m: '#b8860b', l: '#e0a828', h: '#ffd85c', w: '#fff2c0', s: '#e6c877' },
    neon: { d: '#0d3a4a', m: '#12a0b0', l: '#2ee0d0', h: '#9ffff0', w: '#f4ffff', s: '#a8f0e8' },
    galaxy: { d: '#2a1050', m: '#5a20a0', l: '#9a3ae0', h: '#e08aff', w: '#ffe0ff', s: '#c9a0f0' },
    pirate: { d: '#2a1a10', m: '#4a3520', l: '#6a4a2a', h: '#9a7a4a', w: '#f0e0c0', s: '#c0a880' },
    ice: { d: '#123a5a', m: '#1e6a9a', l: '#3aa0d0', h: '#7fe0f0', w: '#e8fbff', s: '#bfe8f7' },
    lava: { d: '#4a1208', m: '#a02a10', l: '#e05a1a', h: '#ffa040', w: '#ffe0a0', s: '#e0a060' },
    rainbow: { d: '#20204f', m: '#3a3a8a', l: '#5a5ac0', h: '#8a8ae0', w: '#ffffff', s: '#d0d0f0' },
    royal: { d: '#2a1040', m: '#5a1a80', l: '#9a3ac0', h: '#e070ff', w: '#ffe8ff', s: '#d0a0e0' },
    kitty: { d: '#2a1a2a', m: '#4a3a5a', l: '#7a6a90', h: '#b0a0c8', w: '#fff0fa', s: '#d8c8e0' },
    ancient: { d: '#0d3a2a', m: '#1a6a4a', l: '#2aa070', h: '#5ad0a0', w: '#e0fff0', s: '#a8e0c8' },
    cosmo: { d: '#2a2a3a', m: '#5a5a6a', l: '#9a9ab0', h: '#d0d0e0', w: '#ffffff', s: '#b8b8c8' }
  };

  /* ============================================================
     КАРТИНКИ ИЗ РЕПОЗИТОРИЯ
     ------------------------------------------------------------
     Скины и предметы — настоящие PNG из orca-clicker. Чтобы не
     спорить с пиксель-артом сцены, каждая картинка один раз
     «пережимается» в маленькую сетку пикселей с палитрой из
     N самых частых цветов — получается честный спрайт, который
     дальше масштабируется nearest-neighbour как все остальные.
     ============================================================ */
  var IMAGES = {
    /* скины (кошки) */
    img_normal: { src: 'img/skins/normal.png', h: 34, maxW: 40, colors: 16 },
    img_chillcat: { src: 'img/skins/CHILLCAT.png', h: 36, maxW: 40, colors: 16 },
    img_hiding: { src: 'img/skins/cat_hiding.png', h: 34, maxW: 36, colors: 16 },
    img_beauty: { src: 'img/skins/beauty_cat.png', h: 36, maxW: 40, colors: 16 },
    img_wild: { src: 'img/skins/wild_cat.png', h: 36, maxW: 36, colors: 16 },
    img_interesting: { src: 'img/skins/interesting.png', h: 36, maxW: 40, colors: 16 },
    img_cyberpunk: { src: 'img/skins/skin_cyberpunk.png', h: 34, maxW: 40, colors: 16 },
    img_cute: { src: 'img/skins/cute.png', h: 36, maxW: 40, colors: 16 },
    img_bugeyed: { src: 'img/skins/bug-eyed.png', h: 36, maxW: 40, colors: 16 },
    img_chonky: { src: 'img/skins/a-bit-chonky.png', h: 36, maxW: 44, colors: 16 },
    img_richi: { src: 'img/skins/richi.png', h: 36, maxW: 40, colors: 16 },
    /* предметы */
    img_chest: { src: 'img/items/bonus.png', h: 14, maxW: 16, colors: 12 },
    img_fish: { src: 'img/items/fish.png', h: 16, maxW: 18, colors: 12 },
    img_catdrop: { src: 'img/items/catdrop.png', h: 26, maxW: 30, colors: 16 },
    img_clickup: { src: 'img/items/click_booster.png', h: 8, maxW: 9, colors: 8 },
    img_autoup: { src: 'img/items/auto_booster.png', h: 8, maxW: 9, colors: 8 }
  };

  var built = {};          /* имя → canvas с пиксель-копией */
  var readyCbs = [];
  var loading = false;
  var done = false;

  /* Превращает картинку в пиксельный спрайт.
     Шаг 1 — уменьшаем до рабочего размера и ищем границы непрозрачного
     содержимого: в исходниках кошка занимает малую часть холста, и без
     кропа спрайт был бы крошечным пятном в пустоте.
     Шаг 2 — сетка берётся по пропорциям самого кропа, иначе строки
     дублируются и картинка «мылится».
     Шаг 3 — палитра из самых частых цветов, всё притягивается к ней. */
  var WORK = 128;   /* сторона рабочего холста, px */

  function squeeze(img, spec) {
    var s = Math.min(1, WORK / Math.max(img.width, img.height));
    var dw = Math.max(1, Math.round(img.width * s));
    var dh = Math.max(1, Math.round(img.height * s));
    var off = document.createElement('canvas');
    off.width = dw; off.height = dh;
    var oc = off.getContext('2d');
    oc.imageSmoothingEnabled = true;
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(img, 0, 0, dw, dh);
    var src = oc.getImageData(0, 0, dw, dh).data;

    /* 1. границы содержимого */
    var bx0 = dw, by0 = dh, bx1 = -1, by1 = -1;
    for (var cy = 0; cy < dh; cy++) {
      var rowBase = cy * dw * 4;
      for (var cx = 0; cx < dw; cx++) {
        if (src[rowBase + cx * 4 + 3] < 24) continue;
        if (cx < bx0) bx0 = cx;
        if (cx > bx1) bx1 = cx;
        if (cy < by0) by0 = cy;
        if (cy > by1) by1 = cy;
      }
    }
    if (bx1 < 0) { bx0 = 0; by0 = 0; bx1 = dw - 1; by1 = dh - 1; }
    /* отступ, чтобы тёмный контур не срезался */
    var pad = Math.max(1, Math.round(Math.max(bx1 - bx0, by1 - by0) * 0.03));
    bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad);
    bx1 = Math.min(dw - 1, bx1 + pad); by1 = Math.min(dh - 1, by1 + pad);
    var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;

    /* 2. целевая сетка — по пропорциям кропа */
    var gh = Math.max(4, spec.h);
    var gw = Math.max(4, Math.min(spec.maxW, Math.round(gh * bw / bh)));

    /* 3. бокс-фильтр: усредняем каждый пиксель целевой сетки */
    var grid = new Array(gw * gh);
    var gi = 0;
    for (var y = 0; y < gh; y++) {
      var y0 = by0 + Math.floor(y * bh / gh);
      var y1 = Math.max(y0 + 1, by0 + Math.floor((y + 1) * bh / gh));
      for (var x = 0; x < gw; x++, gi++) {
        var x0 = bx0 + Math.floor(x * bw / gw);
        var x1 = Math.max(x0 + 1, bx0 + Math.floor((x + 1) * bw / gw));
        var r = 0, g = 0, b = 0, a = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) {
          var base = yy * dw * 4;
          for (var xx = x0; xx < x1; xx++) {
            var o = base + xx * 4;
            var al = src[o + 3];
            /* premultiply: прозрачные пиксели не тянут цвет вниз */
            r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al;
            a += al; n++;
          }
        }
        if (a < n * 90) { grid[gi] = null; continue; }
        grid[gi] = [Math.round(r / a), Math.round(g / a), Math.round(b / a)];
      }
    }

    /* 2. палитра: самые частые цвета, все клетки притягиваются к ней */
    var hist = Object.create(null);
    for (var i = 0; i < grid.length; i++) {
      var c = grid[i];
      if (!c) continue;
      var key = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4);
      hist[key] = (hist[key] || 0) + 1;
    }
    var pal = Object.keys(hist)
      .map(function (k) { return { k: +k, n: hist[k] }; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, spec.colors || 16)
      .map(function (o) {
        var q = o.k;
        return [((q >> 8) & 15) * 17, ((q >> 4) & 15) * 17, (q & 15) * 17];
      });
    if (!pal.length) pal = [[255, 255, 255]];

    /* 3. рисуем */
    var cv = document.createElement('canvas');
    cv.width = gw; cv.height = gh;
    var cx = cv.getContext('2d');
    var out = cx.createImageData(gw, gh);
    var od = out.data;
    for (var g2 = 0; g2 < grid.length; g2++) {
      var cc = grid[g2];
      var p = g2 * 4;
      if (!cc) { od[p + 3] = 0; continue; }
      var best = pal[0], bd = Infinity;
      for (var k = 0; k < pal.length; k++) {
        var dr = cc[0] - pal[k][0], dg = cc[1] - pal[k][1], db = cc[2] - pal[k][2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = pal[k]; }
      }
      od[p] = best[0]; od[p + 1] = best[1]; od[p + 2] = best[2]; od[p + 3] = 255;
    }
    cx.putImageData(out, 0, 0);
    return cv;
  }

  function loadImages() {
    if (loading || done) return;
    if (typeof Image === 'undefined' || !document) { done = true; fire(); return; }
    loading = true;
    var names = Object.keys(IMAGES);
    var left = names.length;
    if (!left) { done = true; fire(); return; }
    function one() {
      if (--left > 0) return;
      loading = false; done = true;
      fire();
    }
    for (var i = 0; i < names.length; i++) {
      (function (name) {
        var spec = IMAGES[name];
        var img = new Image();
        img.onload = function () {
          try { built[name] = squeeze(img, spec); } catch (e) { built[name] = null; }
          one();
        };
        img.onerror = function () { built[name] = null; one(); };
        img.src = spec.src;
      })(names[i]);
    }
  }

  function fire() {
    /* перерисовать уже вставленные <canvas> — до этого могли отрисоваться фолбэки */
    var all = document.querySelectorAll ? document.querySelectorAll('canvas[data-spr]') : [];
    for (var i = 0; i < all.length; i++) delete all[i].dataset.painted;
    for (var j = 0; j < readyCbs.length; j++) {
      try { readyCbs[j](); } catch (e) { /* ignore */ }
    }
  }

  function onReady(fn) {
    if (done) { try { fn(); } catch (e) { /* ignore */ } return; }
    readyCbs.push(fn);
  }
  function isImage(name) { return Object.prototype.hasOwnProperty.call(IMAGES, name); }

  /* ============================================================
     РЕНДЕР
     ============================================================ */

  var cache = {};

  function build(rows, pal, outline) {
    var h = rows.length, w = 0, y, x;
    for (y = 0; y < h; y++) w = Math.max(w, rows[y].length);

    /* рисуем в сетку с отступом 1px под контур */
    var pad = outline ? 1 : 0;
    var cv = document.createElement('canvas');
    cv.width = w + pad * 2;
    cv.height = h + pad * 2;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(cv.width, cv.height);
    var data = img.data;

    function hex2rgb(hex) {
      return [
        parseInt(hex.substr(1, 2), 16),
        parseInt(hex.substr(3, 2), 16),
        parseInt(hex.substr(5, 2), 16)
      ];
    }
    var rgbCache = {};
    function put(px, py, hex) {
      if (!rgbCache[hex]) rgbCache[hex] = hex2rgb(hex);
      var c = rgbCache[hex];
      var o = (py * cv.width + px) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }

    var solid = {};
    for (y = 0; y < h; y++) {
      var row = rows[y];
      for (x = 0; x < w; x++) {
        var ch = row.charAt(x) || '.';
        var col = ch === '.' ? null : (pal[ch] || BASE[ch] || null);
        if (!col) continue;
        put(x + pad, y + pad, col);
        solid[(y + pad) * 1000 + (x + pad)] = 1;
      }
    }

    if (outline) {
      var adds = [];
      for (y = 0; y < cv.height; y++) {
        for (x = 0; x < cv.width; x++) {
          if (solid[y * 1000 + x]) continue;
          var near =
            (x > 0 && solid[y * 1000 + x - 1]) ||
            (x < cv.width - 1 && solid[y * 1000 + x + 1]) ||
            (y > 0 && solid[(y - 1) * 1000 + x]) ||
            (y < cv.height - 1 && solid[(y + 1) * 1000 + x]);
          if (near) adds.push([x, y]);
        }
      }
      for (var a = 0; a < adds.length; a++) put(adds[a][0], adds[a][1], '#05060f');
    }

    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function get(name, palKey, outline) {
    /* картинка из репозитория: палитра и контур не применяются */
    if (isImage(name)) {
      var hit = built[name];
      if (hit) return hit;
      /* ещё грузится или не загрузилась — временно показываем ASCII-заглушку */
      return ascii(name, 'i_star', true);
    }
    return ascii(name, palKey, outline);
  }
  function ascii(name, palKey, outline) {
    var key = name + '|' + (palKey || '-') + '|' + (outline ? 1 : 0);
    if (cache[key]) return cache[key];
    var rows = SPRITES[name];
    if (!rows) rows = SPRITES.i_star;
    var pal = Object.assign({}, BASE, SKIN_PAL[palKey] || {});
    var cv = build(rows, pal, !!outline);
    cache[key] = cv;
    return cv;
  }

  /* рисует спрайт; flip — зеркалить по X */
  function draw(ctx, name, x, y, scale, opts) {
    opts = opts || {};
    var cv = get(name, opts.pal, opts.outline !== false);
    scale = scale || 1;
    ctx.imageSmoothingEnabled = false;
    if (opts.flip) {
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.scale(-1, 1);
      ctx.drawImage(cv, 0, 0, cv.width * scale, cv.height * scale);
      ctx.restore();
    } else {
      ctx.drawImage(cv, Math.round(x), Math.round(y), cv.width * scale, cv.height * scale);
    }
    return { w: cv.width * scale, h: cv.height * scale };
  }

  function size(name, palKey, outline) {
    var cv = get(name, palKey, outline);
    return { w: cv.width, h: cv.height };
  }

  /* тонировка спрайта (для неона/золота и т.п.) */
  function drawTinted(ctx, name, x, y, scale, color, alpha) {
    var cv = get(name, null, true);
    scale = scale || 1;
    var t = document.createElement('canvas');
    if (!t.width) { t.width = cv.width; t.height = cv.height; }
    t.width = cv.width; t.height = cv.height;
    var c = t.getContext('2d');
    c.clearRect(0, 0, t.width, t.height);
    c.drawImage(cv, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = color;
    c.globalAlpha = alpha == null ? 0.5 : alpha;
    c.fillRect(0, 0, t.width, t.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, Math.round(x), Math.round(y), t.width * scale, t.height * scale);
  }

  /* проверка целостности (для тестов) */
  function validate() {
    var errs = [], name, rows, i, w;
    for (name in SPRITES) {
      rows = SPRITES[name];
      if (!Array.isArray(rows)) { errs.push(name + ': не массив'); continue; }
      w = 0;
      for (i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length);
      for (i = 0; i < rows.length; i++) {
        if (rows[i].length !== w) {
          errs.push(name + ': строка ' + i + ' длиной ' + rows[i].length + ' вместо ' + w);
        }
        for (var j = 0; j < rows[i].length; j++) {
          var ch = rows[i].charAt(j);
          if (BASE[ch] === undefined) errs.push(name + ': неизвестный символ "' + ch + '"');
        }
      }
    }
    return errs;
  }

  return {
    BASE: BASE,
    SPRITES: SPRITES,
    SKIN_PAL: SKIN_PAL,
    IMAGES: IMAGES,
    loadImages: loadImages,
    onReady: onReady,
    get isReady() { return done; },
    isImage: isImage,
    get: get,
    draw: draw,
    drawTinted: drawTinted,
    size: size,
    validate: validate
  };
});
