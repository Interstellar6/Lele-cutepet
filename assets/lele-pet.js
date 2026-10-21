/*!
 * lele-pet.js — 「乐乐」桌宠（单文件、零依赖、经典脚本）
 * ---------------------------------------------------------------------------
 * 一只可以摸、可以拖、可以甩飞的猫。素材是这张表情包本身，没有任何额外美术：
 *   assets/lele.png       抠掉背景和「乐乐」气泡的猫（RGBA）
 *   assets/lele-skin.png  同一张图，但眼睛被抹平成一整块毛 —— 底层「皮」
 *   assets/lele-eye-l.png 左眼贴片（羽化椭圆透明边）
 *   assets/lele-eye-r.png 右眼贴片
 * 眨眼 = 把眼睛贴片纵向压扁；看人 = 把眼睛贴片朝指针方向平移几像素，
 * 空出来的边缘由「皮」上的毛自然补上。所以不需要逐帧素材，也不会出现黑框。
 *
 * 用法（两步）：
 *   <script src="assets/lele-pet.js"></script>
 *   <script>var pet = new LelePet({ base: 'assets/', size: 220 });</script>
 *
 * 交互：单击有反应 / 抚摸会打呼噜 / 拖动可以拎起来 / 快速甩出去会飞会弹 /
 *       双击翻跟头 / 长按睡觉 / 眼睛一直跟着鼠标 / 没人理它会自言自语甚至走两步。
 *
 * API：say() hop() sleep() wake() pet() poke() walkTo() setSize() show() hide()
 *      destroy()，以及 onSay / onPoke 等回调。
 * 许可：本项目自有代码，随便用；原始表情包版权归原作者。
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* =======================================================================
   * 一、素材几何（对照 tools/build-sprites.py 生成的 lele-sprite.json）
   *     坐标系 = 抠图后精灵的像素坐标（811 x 792）
   * ===================================================================== */
  var SPRITE = { w: 811, h: 792 };
  var EYES = {
    l: { box: [154, 156, 362, 352], cx: 258, cy: 254 },
    r: { box: [521, 176, 709, 360], cx: 615, cy: 268 }
  };
  // 腮红位置（精灵坐标，脸颊）
  var CHEEKS = [{ x: 186, y: 356, r: 96 }, { x: 672, y: 372, r: 92 }];

  /* =======================================================================
   * 二、台词
   * ===================================================================== */
  var LINES = {
    hello: ['乐乐来啦～', '喵！我在这儿', '在的在的'],
    poke: ['干嘛呀～', '喵？', '别戳我脸！', '再点我就咬人了', '乐乐在的', '有事吗？', '戳一下要给小鱼干的'],
    happy: ['嘿嘿～', '好开心！', '喵呜～', '被你摸到了'],
    shy: ['别、别盯着看…', '讨厌啦', '脸有点热…'],
    angry: ['哼！不理你了', '再点试试看', '生气了！', '喵喵喵！'],
    giggle: ['咯吱…痒！', '哈哈哈', '别闹别闹'],
    pat: ['呼噜呼噜…', '好舒服～', '再摸一下下', '喵～', '就是这里，继续'],
    drag: ['啊啊啊放我下来！', '我恐高！', '别晃我…', '轻一点啦'],
    fly: ['飞起来了——！', '哇哦！', '我会飞了'],
    land: ['哎哟…', '晕…', '屁股疼'],
    sleep: ['Zzz…', '困了…', '晚安喵'],
    wake: ['唔…谁呀', '我醒了！', '别吵…再睡五分钟'],
    idle: ['乐乐在看你写代码', '这个 bug 我看出来了，但我不说', '要不要摸摸我？',
           '记得保存文件哦', '该起来活动一下啦', '我也想吃小鱼干', '你打字好快',
           '写完了记得 git commit', '眼睛累了就看看我']
  };

  /* =======================================================================
   * 三、样式（一次性注入，避免使用者还要引 CSS）
   * ===================================================================== */
  var CSS = [
    '.lele-root{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;',
    'will-change:transform;user-select:none;-webkit-user-select:none;contain:layout style}',
    '.lele-root.lele-absolute{position:absolute}',
    '.lele-canvas{display:block;width:100%;height:100%;pointer-events:none}',
    '.lele-hit{position:absolute;left:14%;right:14%;top:20%;bottom:0;pointer-events:auto;',
    'cursor:grab;touch-action:none;border-radius:40% 40% 12% 12%;outline:none}',
    '.lele-hit:focus-visible{box-shadow:0 0 0 3px rgba(255,138,170,.85);border-radius:40%}',
    '.lele-root.lele-dragging .lele-hit{cursor:grabbing}',
    '.lele-bubble{position:absolute;left:50%;bottom:var(--lele-bubble-gap,100%);',
    'transform:translate(-50%,6px) scale(.86);transform-origin:bottom center;',
    'max-width:210px;min-width:44px;padding:8px 12px;border-radius:14px;',
    'background:#fff;color:#3a3550;border:2px solid #3a3550;',
    'box-shadow:0 6px 18px rgba(60,50,90,.18);font-size:13px;line-height:1.5;',
    'font-weight:600;text-align:center;word-break:break-word;',
    'opacity:0;pointer-events:none;transition:opacity .16s ease,transform .22s cubic-bezier(.2,1.5,.4,1)}',
    '.lele-bubble.lele-on{opacity:1;transform:translate(-50%,-2px) scale(1)}',
    '.lele-bubble::after{content:"";position:absolute;left:50%;bottom:-8px;width:12px;height:12px;',
    'margin-left:-6px;background:#fff;border-right:2px solid #3a3550;border-bottom:2px solid #3a3550;',
    'transform:rotate(45deg);border-radius:0 0 3px 0}',
    '.lele-bubble.lele-below{top:var(--lele-bubble-gap,100%);bottom:auto;transform-origin:top center;',
    'transform:translate(-50%,-6px) scale(.86)}',
    '.lele-bubble.lele-below.lele-on{transform:translate(-50%,2px) scale(1)}',
    '.lele-bubble.lele-below::after{bottom:auto;top:-8px;transform:rotate(225deg);border-radius:0 0 3px 0}',
    '.lele-dock{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);',
    'display:flex;gap:5px;opacity:0;visibility:hidden;transition:opacity .16s ease;pointer-events:auto}',
    '.lele-root:hover .lele-dock,.lele-root.lele-dragging .lele-dock{opacity:1;visibility:visible}',
    '.lele-dock button{border:1px solid rgba(90,80,120,.22);border-radius:999px;background:rgba(255,255,255,.94);',
    'color:#5a5470;font-size:11px;line-height:1;padding:5px 8px;cursor:pointer;font-family:inherit;',
    'box-shadow:0 2px 8px rgba(60,50,90,.14)}',
    '.lele-dock button:hover{color:#e2456f;border-color:rgba(226,69,111,.5)}',
    '.lele-img{display:block;width:100%;height:auto;pointer-events:none}',
    '@media print{.lele-root{display:none !important}}'
  ].join('');

  var cssDone = false;
  function injectCss() {
    if (cssDone || document.getElementById('lele-pet-css')) { cssDone = true; return; }
    var s = document.createElement('style');
    s.id = 'lele-pet-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    cssDone = true;
  }

  /* =======================================================================
   * 四、小工具
   * ===================================================================== */
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  var ease = {
    out: function (k) { return 1 - Math.pow(1 - k, 3); },
    inOut: function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
    back: function (k) { var c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
  };
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('load fail: ' + src)); };
      im.src = src;
    });
  }
  var reduceMotion = false;
  try {
    reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {}

  /* =======================================================================
   * 五、音效（WebAudio 现场合成，不带任何音频文件）
   * ===================================================================== */
  function Sfx(volume) {
    this.vol = volume == null ? 0.3 : volume;
    this.ctx = null;
  }
  Sfx.prototype._ac = function () {
    if (!this.vol) return null;
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (_) { return null; }
    }
    if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (_) {} }
    return this.ctx;
  };
  Sfx.prototype._noise = function (ac, dur) {
    var n = Math.max(1, Math.floor(ac.sampleRate * dur));
    var buf = ac.createBuffer(1, n, ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = ac.createBufferSource();
    src.buffer = buf;
    return src;
  };
  /** 喵：两段滑音 + 颤音 */
  Sfx.prototype.meow = function (high) {
    var ac = this._ac(); if (!ac) return;
    var t = ac.currentTime, base = high ? 1.35 : 0.95;
    var g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * this.vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    g.connect(ac.destination);
    var o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520 * base, t);
    o.frequency.exponentialRampToValueAtTime(880 * base, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(430 * base, t + 0.4);
    var lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 22; lg.gain.value = 18;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); o.start(t); lfo.start(t);
    o.stop(t + 0.45); lfo.stop(t + 0.45);
  };
  /** 呼噜：低频噪声 + 25Hz 抖动 */
  Sfx.prototype.purr = function () {
    var ac = this._ac(); if (!ac) return;
    var t = ac.currentTime, dur = 1.3;
    var src = this._noise(ac, dur);
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    var g = ac.createGain(); g.gain.value = 0;
    var lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 24; lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(g.gain);
    var env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * this.vol, t + 0.12);
    env.gain.setValueAtTime(0.5 * this.vol, t + dur - 0.25);
    env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp); lp.connect(g); g.connect(env); env.connect(ac.destination);
    src.start(t); lfo.start(t); src.stop(t + dur); lfo.stop(t + dur);
  };
  /** 弹一下 */
  Sfx.prototype.pop = function (f) {
    var ac = this._ac(); if (!ac) return;
    var t = ac.currentTime;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime((f || 760), t);
    o.frequency.exponentialRampToValueAtTime((f || 760) * 0.35, t + 0.12);
    g.gain.setValueAtTime(0.35 * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.15);
  };
  /** 落地闷响 */
  Sfx.prototype.thud = function () {
    var ac = this._ac(); if (!ac) return;
    var t = ac.currentTime;
    var src = this._noise(ac, 0.22);
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.6 * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(lp); lp.connect(g); g.connect(ac.destination); src.start(t);
  };

  /* =======================================================================
   * 六、默认配置
   * ===================================================================== */
  var SCRIPT_BASE = (function () {
    try {
      if (global.__LELE_PET_BASE__) return global.__LELE_PET_BASE__;
      var s = document.currentScript;
      if (s && s.src) return s.src.replace(/[^/?#]*$/, '');
    } catch (_) {}
    return 'assets/';
  })();

  var DEFAULTS = {
    base: SCRIPT_BASE,        // 素材目录
    size: 210,                // 显示宽度（px）
    sizeRange: null,          // [min,max]：跟随视口自适应时用
    x: null,                  // 初始中心 x（视口比例 0~1 或像素）；默认靠右
    fixed: true,              // true=固定在视口；false=随文档滚动
    floor: null,              // 地面 y（视口坐标）；数字 / 函数 / CSS 选择器 / 元素
    roam: true,               // 会不会自己散步
    sound: true,              // 音效
    volume: 0.3,
    dock: false,              // 悬停小工具条
    dragMode: 'self',         // 'self'=在页面里拖；'external'=只发回调，交给外壳（桌面版移动窗口）
    onDragStart: null, onDragMove: null, onDragEnd: null,
    greet: true,              // 出现时打个招呼
    hidden: false,            // 默认隐藏（记在本机）
    posKey: 'lele-pet-pos',   // 位置记忆（localStorage，null=不记）
    hideKey: 'lele-pet-hidden',
    zIndex: null,
    ariaLabel: '乐乐，一只可以摸、可以拖的桌宠',
    lines: null,              // 覆盖台词：{poke:[...],pat:[...]}
    onSay: null, onPoke: null, onReady: null, onAction: null
  };

  /* =======================================================================
   * 七、表情（一次性小动作）
   * ===================================================================== */
  var EMOTES = {
    joy: {
      dur: 1.2,
      bubble: 'happy',
      apply: function (p, k) {
        var w = Math.sin(k * Math.PI * 3) * (1 - k);
        p.sy *= 1 + 0.09 * w;
        p.sx *= 1 - 0.05 * w;
        p.rot += Math.sin(k * Math.PI * 4) * 0.05 * (1 - k);
        p.blush = Math.max(p.blush, 0.75 * Math.sin(k * Math.PI));
        p.bob -= Math.abs(Math.sin(k * Math.PI)) * 6;
      }
    },
    giggle: {
      dur: 0.9,
      bubble: 'giggle',
      apply: function (p, k) {
        p.rot += Math.sin(k * Math.PI * 9) * 0.07 * (1 - k);
        p.bob -= Math.abs(Math.sin(k * Math.PI * 2)) * 3;
        p.blush = Math.max(p.blush, 0.5 * Math.sin(k * Math.PI));
        p.squint = Math.max(p.squint, 0.45 * Math.sin(k * Math.PI));
      }
    },
    shy: {
      dur: 1.5,
      bubble: 'shy',
      apply: function (p, k) {
        var a = Math.sin(clamp(k * 1.6, 0, 1) * Math.PI) * (k > 0.75 ? (1 - k) / 0.25 : 1);
        p.blush = Math.max(p.blush, 0.95 * a);
        p.rot += 0.12 * a;
        p.gazeX -= 9 * a; p.gazeY += 4 * a;
        p.sy *= 1 - 0.03 * a;
      }
    },
    angry: {
      dur: 1.1,
      bubble: 'angry',
      apply: function (p, k) {
        p.rot += Math.sin(k * Math.PI * 12) * 0.05 * (1 - k);
        p.sx *= 1 + 0.04 * Math.sin(k * Math.PI * 6) * (1 - k);
        p.bob -= Math.abs(Math.sin(k * Math.PI * 3)) * 2;
      }
    },
    surprise: {
      dur: 0.9,
      apply: function (p, k) {
        var a = Math.sin(clamp(k * 3, 0, 1) * Math.PI * 0.5);
        p.eyeOpen = 1;
        p.bob -= 10 * a;
        p.sx *= 1 + 0.05 * a; p.sy *= 1 + 0.05 * a;
        p.rot += Math.sin(k * Math.PI) * -0.05;
      }
    },
    spin: {
      dur: 1.0,
      apply: function (p, k) {
        var a = Math.sin(k * Math.PI);
        p.bob -= a * 54;                        // 蹦高高
        p.rot += Math.sin(k * Math.PI * 5) * 0.16 * (1 - k * 0.6);
        p.sy *= 1 + a * 0.1; p.sx *= 1 - a * 0.07;
        p.eyeOpen = Math.max(p.eyeOpen, 1);
      }
    },
    hop: {
      dur: 0.62,
      apply: function (p, k) {
        var a = Math.sin(k * Math.PI);
        p.bob -= a * 52;
        p.sy *= 1 + a * 0.07;
        p.sx *= 1 - a * 0.05;
        p.eyeOpen = Math.max(p.eyeOpen, 1 + a * 0.08);
      }
    }
  };

  /* =======================================================================
   * 八、桌宠本体
   * ===================================================================== */
  function LelePet(opts) {
    if (!(this instanceof LelePet)) return new LelePet(opts);
    var o = this.o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS.hasOwnProperty(k) ? DEFAULTS[k] : o[k];
    if (opts) for (var k2 in opts) if (opts[k2] !== undefined) o[k2] = opts[k2];
    if (o.base && o.base.charAt(o.base.length - 1) !== '/') o.base += '/';

    this.lines = {};
    for (var lk in LINES) this.lines[lk] = LINES[lk].slice();
    if (o.lines) for (var lk2 in o.lines) if (o.lines[lk2]) this.lines[lk2] = o.lines[lk2];

    this.version = VERSION;
    this.sfx = new Sfx(o.volume);
    this.dpr = Math.min(2.5, global.devicePixelRatio || 1);
    this.ready = false;
    this.destroyed = false;
    this.paused = false;
    this._timeouts = [];

    /* 状态 */
    this.t = 0;
    this.state = 'idle';         // idle | walk | drag | fly | sleep
    this.w = Math.round(o.size);
    this.h = Math.round(this.w * SPRITE.h / SPRITE.w);
    /* 画布比精灵四周各留一圈余量：跳起来/侧倾/挤压时才不会被切掉 */
    this.padX = Math.round(this.w * 0.20);
    this.padT = Math.round(this.h * 0.32);
    this.padB = Math.round(this.h * 0.16);
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.rot = 0; this.rotV = 0;
    this.squash = null;
    this.emote = null;
    this.particles = [];
    this.gaze = { x: 0, y: 0, tx: 0, ty: 0, idleAt: 0 };
    this.blink = 0; this.blinkT = rnd(1.4, 4);
    this.blinking = null;
    this.winkR = 0;
    this.blush = 0; this.blushT = 0;
    this.patCount = 0; this.patDir = 0; this.patAt = 0; this.patCool = 0;
    this.pokes = 0; this.lastPoke = 0;
    this.idleAt = this.t;
    this.nextIdle = rnd(7, 15);
    this.nextWalk = rnd(11, 22);
    this.nextZzz = 0;
    this.dragTarget = null;
    this.pointer = { x: -9999, y: -9999, seen: 0 };
    this.speakUntil = 0;
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  LelePet.prototype.mount = function () {
    var self = this;
    /* 脚本放在 <head> 里时 body 可能还不存在，等 DOM 就绪再挂 */
    if (!document.body) {
      var p0 = new Promise(function (res) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', res, { once: true });
        else res();
      }).then(function () { return self.mount(); });
      this.readyPromise = p0;
      return p0;
    }
    injectCss();
    try {
      if (localStorage.getItem(this.o.hideKey) === '1') this.o.hidden = true;
    } catch (_) {}
    this.buildDom();
    this.bindInput();
    this.bindWindow();
    var boot = this.loadAssets().then(function (mode) {
      self.mode = mode;               // 'rig' | 'flat'
      self.start();
      self.ready = true;
      if (self.o.hidden) self.hide();
      else if (self.o.greet) self.say(pick(self.lines.hello), 2600);
      if (self.o.onReady) self.o.onReady(self);
      return self;
    })['catch'](function () {
      self.imgFallback();             // 素材全挂了：退回静态立绘 + DOM 动画
      self.start();
      self.ready = true;
      if (self.o.hidden) self.hide();
      return self;
    });
    this.readyPromise = boot;         // await pet.readyPromise 可以等它加载完
    return boot;
  };

  LelePet.prototype.imgFallback = function () {
    this.mode = 'img';
    var img = document.createElement('img');
    img.className = 'lele-img';
    img.alt = '';
    img.src = this.o.base + 'lele-fallback.jpg';
    img.style.cssText = 'width:100%;height:auto;border-radius:14px;' +
      'filter:drop-shadow(0 8px 20px rgba(60,50,90,.25));animation:lele-float 3.2s ease-in-out infinite';
    this.canvas.style.display = 'none';
    this.root.insertBefore(img, this.hit);
    this.imgEl = img;
    var s = document.createElement('style');
    s.textContent = '@keyframes lele-float{0%,100%{transform:translateY(0) rotate(-.6deg)}' +
      '50%{transform:translateY(-8px) rotate(.6deg)}}';
    document.head.appendChild(s);
  };

  LelePet.prototype.loadAssets = function () {
    var self = this, b = this.o.base;
    return Promise.all([
      loadImg(b + 'lele-skin.png'),
      loadImg(b + 'lele-eye-l.png'),
      loadImg(b + 'lele-eye-r.png')
    ]).then(function (imgs) {
      self.skin = imgs[0]; self.eyeL = imgs[1]; self.eyeR = imgs[2];
      return 'rig';
    }, function () {
      return loadImg(b + 'lele.png').then(function (im) { self.skin = im; return 'flat'; });
    });
  };

  LelePet.prototype.buildDom = function () {
    var root = document.createElement('div');
    root.className = 'lele-root' + (this.o.fixed ? '' : ' lele-absolute');
    if (this.o.zIndex) root.style.zIndex = this.o.zIndex;
    root.innerHTML =
      '<canvas class="lele-canvas"></canvas>' +
      '<div class="lele-hit" role="button" tabindex="0" aria-label="' + this.o.ariaLabel + '"></div>' +
      '<div class="lele-bubble" role="status" aria-live="polite"></div>';
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('.lele-canvas');
    this.hit = root.querySelector('.lele-hit');
    this.bubbleEl = root.querySelector('.lele-bubble');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    if (this.o.dock) this.buildDock();
  };

  LelePet.prototype.buildDock = function () {
    var self = this;
    var dock = document.createElement('div');
    dock.className = 'lele-dock';
    [['摸摸', function () { self.pat(true); }],
     ['跳跳', function () { self.hop(1); }],
     ['睡吧', function () { self.sleep(); }],
     ['隐藏', function () { self.hide(); }]].forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = it[0];
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) { e.stopPropagation(); it[1](); });
      dock.appendChild(b);
    });
    this.root.appendChild(dock);
    this.dock = dock;
  };

  LelePet.prototype.resize = function () {
    var w = this.w, h = this.h, x = this.padX, t = this.padT, b = this.padB;
    var cw = w + x * 2, ch = t + h + b;
    this.cw = cw; this.ch = ch;
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.root.style.width = cw + 'px';
    this.root.style.height = ch + 'px';
    // 命中区贴合猫的身形（不含四周留给动作的空白）
    this.hit.style.left = (x + w * 0.12) + 'px';
    this.hit.style.right = (x + w * 0.12) + 'px';
    this.hit.style.top = (t + h * 0.18) + 'px';
    this.hit.style.bottom = b + 'px';
    // 气泡锚点：正好落在耳朵上方
    this.root.style.setProperty('--lele-bubble-gap', (b + h + 8) + 'px');
  };

  LelePet.prototype.metrics = function () {
    var vw = global.innerWidth, vh = global.innerHeight;
    if (this.o.fixed) return { left: 2, right: vw - 2, floor: vh - 4, vw: vw, vh: vh };
    var sy = global.pageYOffset || 0;
    return { left: 2, right: vw - 2, floor: sy + vh - 4, vw: vw, vh: vh, scroll: sy };
  };

  LelePet.prototype.floorY = function () {
    var o = this.o, m = this.metrics();
    if (o.floor == null) return m.floor - this.h;
    var f = o.floor;
    if (typeof f === 'function') f = f(this);
    else if (typeof f === 'string') {
      var el = document.querySelector(f);
      f = el ? el.getBoundingClientRect().top + (o.fixed ? 0 : (global.pageYOffset || 0)) : m.floor;
    } else if (f && f.nodeType === 1) {
      f = f.getBoundingClientRect().top + (o.fixed ? 0 : (global.pageYOffset || 0));
    }
    return clamp(f, 0, m.floor) - this.h;
  };

  LelePet.prototype.restorePos = function () {
    var m = this.metrics(), cx = null;
    if (this.o.posKey) {
      try {
        var s = JSON.parse(localStorage.getItem(this.o.posKey) || 'null');
        if (s && typeof s.fx === 'number') {
          cx = s.fx * m.vw;
          if (s.facing === -1) this.facing = -1;
        }
      } catch (_) {}
    }
    if (cx == null) {
      if (typeof this.o.x === 'number') cx = this.o.x <= 1 ? this.o.x * m.vw : this.o.x;
      else cx = m.vw * (m.vw < 700 ? 0.5 : 0.78);
    }
    this.x = clamp(cx - this.w / 2, m.left, m.right - this.w);
    this.y = this.floorY();
  };

  LelePet.prototype.savePos = function () {
    if (!this.o.posKey) return;
    try {
      localStorage.setItem(this.o.posKey, JSON.stringify({
        fx: (this.x + this.w / 2) / this.metrics().vw, facing: this.facing
      }));
    } catch (_) {}
  };

  LelePet.prototype.start = function () {
    if (this._started) return this;
    this._started = true;
    this.restorePos();
    this.render();
    if (reduceMotion) this.o.roam = false;
    var self = this;
    this._last = performance.now();
    this._tick = function (now) {
      if (self.destroyed || self.paused) return;
      self._raf = requestAnimationFrame(self._tick);
      var dt = Math.min(0.05, Math.max(0, (now - self._last) / 1000));
      self._last = now;
      self.t += dt;
      self.update(dt);
      self.draw();
    };
    this._raf = requestAnimationFrame(this._tick);
    return this;
  };

  LelePet.prototype.destroy = function () {
    this.destroyed = true;
    cancelAnimationFrame(this._raf);
    this._timeouts.forEach(clearTimeout);
    clearTimeout(this._bubbleTimer);
    this.unbindWindow();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  LelePet.prototype.pause = function () { this.paused = true; cancelAnimationFrame(this._raf); };
  LelePet.prototype.resume = function () {
    if (!this.paused || this.destroyed) return this;
    this.paused = false;
    if (!this._started) return this.start();
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
    return this;
  };

  /* ------------------------------ 输入 ------------------------------ */

  LelePet.prototype.bindInput = function () {
    var self = this, hit = this.hit;
    var down = null, pid = null, samples = [], moved = false;

    hit.addEventListener('pointerdown', function (e) {
      if (self.destroyed) return;
      pid = e.pointerId;
      try { hit.setPointerCapture(pid); } catch (_) {}
      down = { t: performance.now(), x: e.clientX, y: e.clientY };
      samples = [{ t: down.t, x: e.clientX, y: e.clientY }];
      moved = false;
      self.markActive();
      self.sfx._ac();                   // 关键：在用户手势里唤醒音频上下文
    });

    hit.addEventListener('pointermove', function (e) {
      self.trackPointer(e);
      if (pid === null || e.pointerId !== pid) return;
      var now = performance.now();
      samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (samples.length > 2 && now - samples[0].t > 120) samples.shift();
      if (!moved) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 7) return;
        moved = true;
        self.markActive();
        if (self.o.dragMode === 'external') {
          if (self.o.onDragStart) self.o.onDragStart(e, self);
        } else {
          self.state = 'drag';
          self.root.classList.add('lele-dragging');
          if (Math.random() < 0.25) self.say(pick(self.lines.drag), 1500);
        }
      }
      /* 桌面版：位置由外壳（原生窗口）负责，这里只把事件转发出去 */
      if (self.o.dragMode === 'external') {
        if (self.o.onDragMove) self.o.onDragMove(e, self);
        e.preventDefault();
        return;
      }
      var m = self.metrics();
      var cx = e.clientX, cy = e.clientY + (self.o.fixed ? 0 : (global.pageYOffset || 0));
      self.dragTarget = {
        x: clamp(cx - self.w / 2, m.left - self.w * 0.3, m.right - self.w * 0.7),
        y: cy - self.h * 0.62
      };
      e.preventDefault();
    }, { passive: false });

    var release = function (e) {
      if (pid === null || e.pointerId !== pid) return;
      pid = null;
      var quick = !moved && performance.now() - down.t < 420;
      var wasDrag = moved;
      moved = false;
      down = null;
      self.dragTarget = null;
      self.root.classList.remove('lele-dragging');
      if (quick) { self.poke(); return; }
      if (!wasDrag) return;
      if (self.o.dragMode === 'external') {
        if (self.o.onDragEnd) self.o.onDragEnd(e, self);
        return;
      }
      var s0 = samples[0], now = performance.now();
      var dt = Math.max(16, now - s0.t) / 1000;
      var vx = (e.clientX - s0.x) / dt;
      var vy = (e.clientY - s0.y) / dt;
      if (Math.hypot(vx, vy) > 620) { self.throwOut(vx, vy); }
      else { self.state = 'fly'; self.vx = vx * 0.25; self.vy = vy * 0.25; }
    };
    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointercancel', function (e) {
      if (pid === null) return;
      pid = null; moved = false; down = null;
      self.dragTarget = null;
      self.root.classList.remove('lele-dragging');
      if (self.o.dragMode === 'external') {
        if (self.o.onDragEnd) self.o.onDragEnd(e, self);
        return;
      }
      self.state = 'fly';
    });

    hit.addEventListener('dblclick', function (e) { e.preventDefault(); self.spin(); });
    hit.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.poke(); }
    });
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); self.say(pick(self.lines.giggle), 1600); });
  };

  LelePet.prototype.trackPointer = function (e) {
    var p = this.pointer, now = performance.now();
    p.x = e.clientX;
    p.y = e.clientY + (this.o.fixed ? 0 : (global.pageYOffset || 0));
    p.seen = now;
    if (!this.gaze.idleAt) this.gaze.idleAt = now;

    /* 抚摸判定：在猫身上来回划动 3 个来回 */
    if (this.patCool > 0) { this.patDir = 0; return; }
    var r = this.root.getBoundingClientRect();
    var inside = e.clientX > r.left - 12 && e.clientX < r.right + 12 &&
                 e.clientY > r.top - 12 && e.clientY < r.bottom + 12;
    if (!inside) { this.patDir = 0; return; }
    if (p.lx == null) { p.lx = p.x; return; }
    var dx = p.x - p.lx;
    p.lx = p.x;
    if (Math.abs(dx) < 2) return;
    /* 睡着的时候被摸：摸醒它 */
    if (this.state === 'sleep') { if (Math.abs(dx) > 6) this.wake(); return; }
    var dir = dx > 0 ? 1 : -1;
    var ts = now;
    if (!this._patT || ts - this._patT > 1000) this.patCount = 0;
    this._patT = ts;
    if (this.patDir && dir !== this.patDir) {
      this.patCount++;
      if (this.patCount >= 3) { this.patCount = 0; this.pat(); return; }
    }
    this.patDir = dir;
  };

  /** 只改朝向（桌面版散步时用：窗口往左走就让猫朝左） */
  LelePet.prototype.face = function (dir) {
    this.facing = dir < 0 ? -1 : 1;
    return this;
  };

  /** 让眼睛看向视口里的某一点（桌面版由原生外壳把真实鼠标坐标喂进来） */
  LelePet.prototype.lookAt = function (x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.seen = performance.now();
    return this;
  };

  LelePet.prototype.markActive = function () {
    this.idleAt = this.t;
    if (this.state === 'sleep') this.wake();
    this.gaze.idleAt = performance.now();
  };

  LelePet.prototype.bindWindow = function () {
    var self = this;
    this._onResize = function () {
      var m = self.metrics();
      if (self.state !== 'drag' && self.state !== 'fly') self.y = self.floorY();
      self.x = clamp(self.x, m.left, m.right - self.w);
      self.render();
    };
    this._onVis = function () {
      if (self.destroyed) return;
      if (document.hidden) { cancelAnimationFrame(self._raf); }
      else if (!self.paused) { self._last = performance.now(); self.start(); }
    };
    global.addEventListener('resize', this._onResize);
    global.addEventListener('scroll', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVis);
    this._onMove = function (e) { self.trackPointer(e); };
    global.addEventListener('pointermove', this._onMove, { passive: true });
  };
  LelePet.prototype.unbindWindow = function () {
    global.removeEventListener('resize', this._onResize);
    global.removeEventListener('scroll', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    global.removeEventListener('pointermove', this._onMove);
  };

  /* ------------------------------ 每帧更新 ------------------------------ */

  LelePet.prototype.update = function (dt) {
    var t = this.t, m = this.metrics();

    /* 眨眼 */
    if (this.blinking) {
      this.blinking.t += dt;
      var k = this.blinking.t / this.blinking.dur;
      if (k >= 1) { this.blinking = null; this.blink = 0; this.blinkT = this.state === 'sleep' ? rnd(2, 5) : rnd(1.6, 5.2); }
      else {
        var c = 0.11 / this.blinking.dur, d = 0.2 / this.blinking.dur;
        this.blink = k < c ? ease.inOut(k / c) : k < c + d ? 1 : ease.inOut(1 - (k - c - d) / (1 - c - d));
      }
    } else if (this.state !== 'sleep') {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinking = { t: 0, dur: rnd(0.22, 0.34) };
        if (Math.random() < 0.16) this.winkR = 1;
      }
    }
    if (this.winkR) {
      this.winkR -= dt / 0.4;
      if (this.winkR < 0) this.winkR = 0;
    }

    /* 视线：跟着指针，没人理就自己乱看 */
    var g = this.gaze, now = performance.now();
    var eyeMidX = this.x + this.w / 2;
    var eyeMidY = this.y + this.h * 0.34;
    var fresh = now - this.pointer.seen < 4000 || now - g.idleAt < 2600;
    if (fresh && this.state !== 'sleep') {
      var dx = this.pointer.x - eyeMidX, dy = this.pointer.y - eyeMidY;
      var d = Math.hypot(dx, dy) || 1;
      var reach = clamp(d / 240, 0.25, 1);
      g.tx = clamp(dx / d, -1, 1) * 13 * reach;
      g.ty = clamp(dy / d, -1, 1) * 9 * reach;
      if (this.state === 'drag') { g.tx *= 0.5; g.ty = clamp(g.ty, -12, -2); }
    } else {
      if (now - (this._wanderAt || 0) > rnd(1800, 4200)) {
        this._wanderAt = now;
        g.tx = rnd(-11, 11); g.ty = rnd(-7, 8);
      }
    }
    if (this.state === 'sleep') { g.tx = 0; g.ty = 4; }
    var rate = Math.min(1, dt * (this.state === 'sleep' ? 2 : 9));
    g.x += (g.tx - g.x) * rate;
    g.y += (g.ty - g.y) * rate;

    /* 腮红回落 */
    if (this.blushT > 0) { this.blushT -= dt; if (this.blushT <= 0) this.blushTarget = 0; }
    this.blush += ((this.blushTarget || 0) - this.blush) * Math.min(1, dt * 5);
    /* 抚摸冷却（刚点完的一小段时间不判抚摸，避免误触） */
    if (this.patCool > 0) this.patCool = Math.max(0, this.patCool - dt);

    /* 表情进度 */
    if (this.emote) {
      this.emote.t += dt;
      if (this.emote.t >= this.emote.dur) { this.emote = null; }
    }
    /* 挤压回弹 */
    if (this.squash) {
      this.squash.t += dt;
      if (this.squash.t >= this.squash.dur) this.squash = null;
    }

    /* 状态机 */
    if (this.state === 'drag') {
      var tg = this.dragTarget || { x: this.x, y: this.y };
      var k2 = Math.min(1, dt * 16);
      var px = this.x;
      this.x += (tg.x - this.x) * k2;
      this.y += (tg.y - this.y) * k2;
      this.vx = (this.x - px) / Math.max(dt, 0.001);
      this.rotV += ((-clamp(this.vx / 2600, -0.3, 0.3)) - this.rot) * Math.min(1, dt * 8);
      this.rot += this.rotV * dt * 3;
      this.vy = 0;
    } else if (this.state === 'fly') {
      var G = 2600;
      this.vy += G * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rot += this.rotV * dt;
      this.rotV *= (1 - Math.min(1, dt * 1.6));
      var floor = this.floorY();
      if (this.y >= floor) {
        this.y = floor;
        if (Math.abs(this.vy) > 240) {
          this.vy = -this.vy * 0.42;
          this.vx *= 0.72;
          this.squash = { t: 0, dur: 0.34, amp: clamp(Math.abs(this.vy) / 1600, 0.16, 0.44) };
          this.rotV += rnd(-1.2, 1.2);
          this.spawn('dust', 5);
          this.sfx.thud();
        } else {
          this.settle();
        }
      }
      if (this.y < -this.h * 0.5) { this.y = -this.h * 0.5; this.vy = Math.abs(this.vy) * 0.5; }
      if (this.x < m.left) { this.x = m.left; this.vx = Math.abs(this.vx) * 0.55; }
      if (this.x > m.right - this.w) { this.x = m.right - this.w; this.vx = -Math.abs(this.vx) * 0.55; }
    } else {
      this.rot += (0 - this.rot) * Math.min(1, dt * 6);
      this.rotV = 0;
      this.vx = 0; this.vy = 0;
    }

    /* 散步 */
    if (this.state === 'idle') {
      if (this.walkTarget != null) {
        var dir = this.walkTarget > this.x ? 1 : -1;
        var speed = 150;
        this.x += dir * speed * dt;
        this.facing = dir;
        this._walkPhase = (this._walkPhase || 0) + dt * 9;
        if ((dir > 0 && this.x >= this.walkTarget) || (dir < 0 && this.x <= this.walkTarget)) {
          this.x = this.walkTarget;
          this.walkTarget = null;
          this.state = 'idle';
          this.savePos();
        }
      }
    }

    /* 待机调度 */
    if (this.state === 'idle' && !this.emote) {
      this.nextIdle -= dt;
      if (this.nextIdle <= 0) {
        this.nextIdle = rnd(8, 18);
        var r = Math.random();
        if (r < 0.34) this.say(pick(this.lines.idle), 4200);
        else if (r < 0.52) this.smallHop();
        else if (r < 0.62) this.gaze.tx = rnd(-14, 14);
      }
      /* 散步 */
      if (this.o.roam && !this.emote) {
        this.nextWalk -= dt;
        if (this.nextWalk <= 0) {
          this.nextWalk = rnd(14, 30);
          if (this.walkTarget == null) this.walkTo(rnd(m.left + this.w * 0.2, m.right - this.w * 1.2) + this.w / 2, true);
        }
      }
      /* 太久没人理 → 睡 */
      if (t - this.idleAt > 75 && this.state !== 'sleep') this.sleep(true);
    }
    if (this.state === 'sleep') {
      this.nextZzz -= dt;
      if (this.nextZzz <= 0) {
        this.nextZzz = rnd(2.4, 4.5);
        this.spawn('zzz', 1);
        if (Math.random() < 0.22) this.say(pick(this.lines.sleep), 2600);
      }
    }

    /* 粒子 */
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var q = this.particles[i];
      q.life -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vy += (q.g == null ? 120 : q.g) * dt;
      q.vx *= (1 - Math.min(1, dt * 0.8));
      q.rot += q.rv * dt;
      if (q.life <= 0) this.particles.splice(i, 1);
    }

    this.render();
  };

  LelePet.prototype.render = function () {
    /* this.x / this.y 始终指「精灵本体」的左上角；画布外的余量在这里抵消掉 */
    this.root.style.transform = 'translate3d(' + Math.round(this.x - this.padX) + 'px,' +
      Math.round(this.y - this.padT) + 'px,0)';
  };

  /* ------------------------------ 姿态与绘制 ------------------------------ */

  LelePet.prototype.pose = function () {
    var t = this.t, sleep = this.state === 'sleep';
    var p = {
      rot: this.rot, sx: 1, sy: 1, bob: 0, spin: 0,
      gazeX: this.gaze.x, gazeY: this.gaze.y,
      eyeOpen: 1, squint: 0, blush: this.blush, facing: this.facing
    };
    /* 呼吸 */
    var br = sleep ? 1.35 : 2.1;
    var amp = sleep ? 0.022 : 0.012;
    p.sy *= 1 + Math.sin(t * br) * amp;
    p.sx *= 1 - Math.sin(t * br) * amp * 0.7;
    p.bob -= Math.sin(t * br) * (sleep ? 2.2 : 1.4);

    /* 走路颠簸 */
    if (this.walkTarget != null && this.state === 'idle') {
      var w = Math.abs(Math.sin(this._walkPhase || 0));
      p.bob -= w * this.h * 0.045;
      p.sy *= 1 + w * 0.03;
      p.rot += Math.sin((this._walkPhase || 0) * 2) * 0.035 * this.facing;
    }
    /* 被拎着：拉长 + 随速度摆 */
    if (this.state === 'drag') {
      var stretch = clamp(Math.abs(this.vx) / 1400, 0, 0.25);
      p.sy *= 1 + stretch; p.sx *= 1 - stretch * 0.6;
      p.rot += clamp(this.vx / 3000, -0.25, 0.25);
    }
    /* 落地/起跳挤压 */
    if (this.squash) {
      var k = this.squash.t / this.squash.dur;
      var s = Math.sin(k * Math.PI) * (1 - k * 0.5) * this.squash.amp * 1.25;
      p.sy *= 1 - s; p.sx *= 1 + s * 0.9;
    }
    /* 一次性表情 */
    if (this.emote) {
      var e = EMOTES[this.emote.name];
      if (e && e.apply) e.apply(p, clamp(this.emote.t / this.emote.dur, 0, 1));
    }
    /* 眨眼 / 眯眼 */
    p.eyeOpen = clamp(p.eyeOpen - this.blink - sleep * 0.94 - p.squint, 0.06, 1);
    return p;
  };

  LelePet.prototype.draw = function () {
    var ctx = this.ctx, p = this.pose(), w = this.w, h = this.h;
    var PX = this.padX, PT = this.padT, PB = this.padB;
    var k = w / SPRITE.w;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);

    /* 影子（贴地时才明显） */
    var floor = this.floorY();
    var above = clamp((floor - this.y) / (this.h * 0.75), 0, 1);
    if (this.mode !== 'img') {
      var shA = (1 - above) * 0.30;
      if (shA > 0.01) {
        var ox = PX + w / 2, cy = PT + h + PB * 0.34;
        var rx = w * (0.42 - above * 0.12), ry = Math.max(3, PB * 0.18 * (1 - above * 0.5));
        var gsh = ctx.createRadialGradient(ox, cy, 1, ox, cy, rx);
        gsh.addColorStop(0, 'rgba(70,60,95,' + shA.toFixed(3) + ')');
        gsh.addColorStop(1, 'rgba(70,60,95,0)');
        ctx.save();
        ctx.translate(ox, cy); ctx.scale(1, ry / rx); ctx.translate(-ox, -cy);
        ctx.fillStyle = gsh;
        ctx.beginPath(); ctx.arc(ox, cy, rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    if (this.mode === 'img') return;      // 兜底立绘走 DOM，不在 canvas 上画

    ctx.save();
    ctx.translate(PX + w / 2, PT + h);             // 以「脚底中心」为锚点
    ctx.rotate(p.rot);
    ctx.scale(p.sx * p.facing, p.sy);
    ctx.translate(-w / 2, -h + p.bob);
    ctx.drawImage(this.skin, 0, 0, w, h);

    if (this.mode === 'rig') {
      this.drawEye(ctx, 'l', k, p);
      this.drawEye(ctx, 'r', k, p);
    }
    /* 腮红：只落在猫身上 */
    if (p.blush > 0.02) {
      ctx.globalCompositeOperation = 'source-atop';
      for (var i = 0; i < CHEEKS.length; i++) {
        var c = CHEEKS[i], cx = c.x * k, cy = c.y * k, r = c.r * k;
        var g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        g.addColorStop(0, 'rgba(255,120,155,' + (0.55 * p.blush).toFixed(3) + ')');
        g.addColorStop(0.55, 'rgba(255,140,170,' + (0.3 * p.blush).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,160,185,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    this.drawParticles(ctx);
  };

  LelePet.prototype.drawEye = function (ctx, key, k, p) {
    var e = EYES[key], b = e.box;
    var img = key === 'l' ? this.eyeL : this.eyeR;
    if (!img) return;
    var bx = b[0] * k, by = b[1] * k, bw = (b[2] - b[0]) * k, bh = (b[3] - b[1]) * k;
    /* 上限就是 1：放大眼角贴片会把矩形羽化边露出来，反而脏 */
    var open = clamp(p.eyeOpen, 0.06, 1);
    if (key === 'r' && this.winkR > 0) open = clamp(open * (1 - this.winkR) - this.winkR * 0.9, 0.06, 1);
    var dh = bh * open;
    /* 身体往左走时会整体镜像（scale(-1,1)），本地坐标的 +x 在屏幕上其实是往左，
       所以视线的横向偏移要乘 facing，否则镜像之后眼球就跟着反了 */
    ctx.drawImage(img, bx + p.gazeX * p.facing * k, by + p.gazeY * k + (bh - dh) / 2, bw, dh);
  };

  LelePet.prototype.drawParticles = function (ctx) {
    for (var i = 0; i < this.particles.length; i++) {
      var q = this.particles[i];
      var a = clamp(q.life / q.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a * (q.alpha == null ? 1 : q.alpha);
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.scale(q.s, q.s);
      ctx.fillStyle = q.color;
      if (q.type === 'heart') heartPath(ctx);
      else if (q.type === 'star') starPath(ctx);
      else if (q.type === 'zzz') { ctx.font = 'bold 22px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Z', 0, 0); }
      else if (q.type === 'anger') { ctx.font = 'bold 20px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💢', 0, 0); }
      else { ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  };

  function heartPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-7, -2, -5, -9, 0, -5);
    ctx.bezierCurveTo(5, -9, 7, -2, 0, 4);
    ctx.closePath(); ctx.fill();
  }
  function starPath(ctx) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? 3 : 7.5, a = Math.PI / 5 * i - Math.PI / 2;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  }

  /* ------------------------------ 粒子 ------------------------------ */

  LelePet.prototype.spawn = function (type, n, opts) {
    opts = opts || {};
    var PX = this.padX, PT = this.padT;
    for (var i = 0; i < n; i++) {
      var q = {
        type: type,
        x: PX + (opts.x != null ? opts.x : this.w * rnd(0.25, 0.75)),
        y: PT + (opts.y != null ? opts.y : this.h * rnd(0.08, 0.3)),
        vx: rnd(-40, 40), vy: rnd(-95, -35), life: rnd(0.8, 1.5),
        rot: rnd(-0.5, 0.5), rv: rnd(-2, 2), s: rnd(0.7, 1.25), g: 150,
        color: '#ff6b95'
      };
      if (type === 'star') { q.color = '#ffcc4d'; q.g = 60; q.life = rnd(0.7, 1.2); }
      if (type === 'zzz') {
        q.x = PX + this.w * 0.74; q.y = PT + this.h * 0.1;
        q.vx = rnd(12, 26); q.vy = rnd(-32, -18); q.g = 0; q.life = rnd(1.6, 2.4);
        q.s = rnd(0.7, 1.1); q.color = 'rgba(90,84,120,.75)';
      }
      if (type === 'anger') { q.color = '#ff4d4f'; q.vy = rnd(-60, -20); q.g = 200; }
      if (type === 'dust') {
        q.color = 'rgba(120,110,150,.5)'; q.vy = rnd(-40, -5); q.g = 260;
        q.x = PX + this.w * rnd(0.3, 0.7); q.y = PT + this.h * rnd(0.94, 1);
      }
      q.max = q.life;
      this.particles.push(q);
    }
  };

  /* ------------------------------ 行为 ------------------------------ */

  LelePet.prototype.say = function (text, dur) {
    if (!text || this.destroyed || !this.bubbleEl) return;
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.add('lele-on');
    var r = this.root.getBoundingClientRect();
    var below = r.top < 96;
    this.bubbleEl.classList.toggle('lele-below', below);
    clearTimeout(this._bubbleTimer);
    var self = this;
    this._bubbleTimer = setTimeout(function () {
      self.bubbleEl.classList.remove('lele-on');
    }, dur || 3000);
    if (this.o.onSay) this.o.onSay(text, this);
    return this;
  };

  LelePet.prototype.poke = function () {
    if (this.destroyed) return this;
    this.markActive();
    var now = this.t;
    if (now - this.lastPoke < 1.6) this.pokes++; else this.pokes = 1;
    this.lastPoke = now;
    var name, lineKey;
    var r = Math.random();
    if (this.pokes >= 5) { name = 'angry'; lineKey = 'angry'; }
    else if (r < 0.3) { name = 'joy'; lineKey = 'happy'; }
    else if (r < 0.5) { name = 'giggle'; lineKey = 'giggle'; }
    else if (r < 0.68) { name = 'surprise'; lineKey = 'poke'; }
    else if (r < 0.85) { name = 'shy'; lineKey = 'shy'; }
    else { name = 'joy'; lineKey = 'happy'; }

    if (this.state === 'sleep') { this.wake(); return this; }
    this.emote = { name: name, t: 0, dur: EMOTES[name].dur };
    this.patCool = 0.4;
    if (name === 'angry') { this.spawn('anger', 2); this.sfx.pop(420); }
    else if (name === 'joy') { this.spawn('heart', 4); this.sfx.meow(true); }
    else if (name === 'giggle') { this.spawn('star', 3); this.sfx.pop(920); }
    else if (name === 'shy') { this.spawn('heart', 2); this.sfx.pop(680); }
    else { this.sfx.meow(false); }
    if (lineKey && Math.random() < 0.75) this.say(pick(this.lines[lineKey]), 2600);
    if (this.o.onPoke) this.o.onPoke(name, this);
    if (this.o.onAction) this.o.onAction('poke:' + name, this);
    return this;
  };

  LelePet.prototype.pat = function (force) {
    if (this.destroyed) return this;
    if (this.patCool > 0 && !force) return this;
    this.patCool = 2.6;
    this.markActive();
    this.squash = { t: 0, dur: 0.4, amp: 0.16 };
    this.blushTarget = 1; this.blushT = 2.4;
    this.emote = { name: 'joy', t: 0, dur: 0.9 };
    this.spawn('heart', 5);
    this.sfx.purr();
    this.say(pick(this.lines.pat), 2600);
    if (this.o.onAction) this.o.onAction('pat', this);
    return this;
  };

  LelePet.prototype.smallHop = function () {
    this.emote = { name: 'hop', t: 0, dur: EMOTES.hop.dur };
    this.sfx.pop(700);
    return this;
  };

  LelePet.prototype.hop = function () {
    if (this.destroyed) return this;
    this.markActive();
    if (this.state === 'drag' || this.state === 'fly') return this;
    this.state = 'idle';
    this.walkTarget = null;
    this.emote = { name: 'hop', t: 0, dur: EMOTES.hop.dur };
    this.spawn('dust', 3);
    this.sfx.pop(820);
    if (this.o.onAction) this.o.onAction('hop', this);
    return this;
  };

  LelePet.prototype.spin = function () {
    if (this.destroyed) return this;
    this.markActive();
    this.emote = { name: 'spin', t: 0, dur: 1.0 };
    this.spawn('star', 5, { y: this.h * 0.3 });
    this.say(pick(this.lines.happy), 2200);
    this.sfx.meow(true);
    if (this.o.onAction) this.o.onAction('spin', this);
    return this;
  };

  LelePet.prototype.walkTo = function (cx, quiet) {
    if (this.destroyed || this.state === 'drag' || this.state === 'fly') return this;
    var m = this.metrics();
    var target = clamp(cx - this.w / 2, m.left, m.right - this.w);
    if (Math.abs(target - this.x) < 12) return this;
    this.state = 'idle';
    this.walkTarget = target;
    this._walkPhase = 0;
    if (!quiet && Math.random() < 0.4) this.say(pick(this.lines.idle), 2000);
    if (this.o.onAction) this.o.onAction('walk', this);
    return this;
  };

  LelePet.prototype.throwOut = function (vx, vy) {
    this.state = 'fly';
    this.vx = clamp(vx, -2600, 2600) * 0.85;
    this.vy = clamp(vy, -2600, 2600) * 0.85 - 120;
    this.rotV = clamp(vx / 900, -6, 6);
    this.say(pick(vy < -300 ? this.lines.fly : this.lines.drag), 1800);
    this.sfx.pop(560);
    if (this.o.onAction) this.o.onAction('throw', this);
    return this;
  };

  LelePet.prototype.settle = function () {
    this.state = 'idle';
    this.idleAt = this.t;
    this.y = this.floorY();
    this.vx = 0; this.vy = 0; this.rotV = 0;
    this.squash = { t: 0, dur: 0.42, amp: 0.26 };
    this.spawn('dust', 4);
    this.savePos();
    if (Math.random() < 0.45) this.say(pick(this.lines.land), 2000);
    return this;
  };

  LelePet.prototype.sleep = function (auto) {
    if (this.destroyed || this.state === 'sleep') return this;
    this.state = 'sleep';
    this.emote = null;
    this.y = this.floorY();
    this.walkTarget = null;
    this.blink = 1;
    this.say(pick(this.lines.sleep), 2600);
    if (this.o.onAction) this.o.onAction('sleep', this);
    return this;
  };

  LelePet.prototype.wake = function () {
    if (this.state !== 'sleep') return this;
    this.state = 'idle';
    this.idleAt = this.t;
    this.blink = 0;
    this.nextIdle = rnd(6, 12);
    this.say(pick(this.lines.wake), 2200);
    this.sfx.meow(false);
    if (this.o.onAction) this.o.onAction('wake', this);
    return this;
  };

  LelePet.prototype.setSize = function (px) {
    this.w = Math.round(clamp(px, 90, 460));
    this.h = Math.round(this.w * SPRITE.h / SPRITE.w);
    this.padX = Math.round(this.w * 0.20);
    this.padT = Math.round(this.h * 0.32);
    this.padB = Math.round(this.h * 0.16);
    this.resize();
    var m = this.metrics();
    this.x = clamp(this.x, m.left, m.right - this.w);
    this.y = this.floorY();
    this.render();
    return this;
  };

  LelePet.prototype.show = function () {
    this.o.hidden = false;
    try { localStorage.setItem(this.o.hideKey, '0'); } catch (_) {}
    this.root.style.display = '';
    this.resume();
    return this;
  };

  LelePet.prototype.hide = function () {
    this.o.hidden = true;
    try { localStorage.setItem(this.o.hideKey, '1'); } catch (_) {}
    this.root.style.display = 'none';
    this.pause();
    return this;
  };

  LelePet.prototype.isHidden = function () { return !!this.o.hidden; };

  LelePet.prototype.setVolume = function (v) { this.sfx.vol = v; this.o.volume = v; return this; };

  /* ------------------------------ 静态入口 ------------------------------ */

  LelePet.version = VERSION;
  LelePet.LINES = LINES;
  LelePet.SPRITE = SPRITE;
  LelePet.EYES = EYES;
  LelePet.mount = function (opts) {
    var p = new LelePet(opts);
    p.mount();
    return p;
  };
  /** 页面里带 data-lele-pet 时自动挂载：<script src="lele-pet.js" data-auto></script> */
  LelePet.autoMount = function () {
    var s = document.currentScript || document.querySelector('script[src*="lele-pet.js"]');
    var o = {};
    if (s) {
      if (s.dataset.size) o.size = parseInt(s.dataset.size, 10);
      if (s.dataset.roam != null) o.roam = s.dataset.roam !== 'false';
      if (s.dataset.sound != null) o.sound = s.dataset.sound !== 'false';
      if (s.dataset.dock != null) o.dock = s.dataset.dock !== 'false';
      if (s.dataset.base) o.base = s.dataset.base;
    }
    return LelePet.mount(o);
  };

  global.LelePet = LelePet;
  if (typeof module === 'object' && module.exports) module.exports = LelePet;
})(typeof window !== 'undefined' ? window : this);
