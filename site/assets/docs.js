/*!
 * 手搓桌宠 · 教程站脚本
 * 负责：左侧目录、顶栏面包屑、右侧页内目录、上下页、代码复制、
 *       移动端抽屉、滚动高亮、勾选清单计数、角落桌宠。
 * 零依赖，经典脚本。
 */
(function () {
  'use strict';

  /* ===================================================================
   * 一、站点结构（加一页只改这里）
   * ================================================================= */
  var NAV = [
    { g: '开始' },
    { href: 'index.html',       n: '0', title: '这只桌宠长什么样' },
    { g: '第 1 步 · 做素材（Python）' },
    { href: 'step-1-cut.html',  n: '1', title: '抠图：把猫拿出来' },
    { href: 'step-2-eye.html',  n: '2', title: '拆眼睛：眨眼的前提' },
    { g: '第 2 步 · 写代码（每版一个完整文件）' },
    { href: 'step-3-draw.html', n: 'V1', title: '第 1 版：呼吸' },
    { href: 'step-4-blink.html', n: 'V2', title: '第 2 版：眨眼' },
    { href: 'step-5-gaze.html', n: 'V3', title: '第 3 版：盯着你' },
    { href: 'step-6-touch.html', n: 'V4', title: '第 4 版：回应你' },
    { href: 'step-7-physics.html', n: 'V5', title: '第 5 版：拖拽与甩飞' },
    { g: '收尾' },
    { href: 'customize.html',   n: '6', title: '换成你的图 · 调参' },
    { href: 'ship.html',        n: '7', title: '上线前检查' },
    { href: 'desktop.html',     n: '8', title: '变成桌面桌宠（macOS）' },
    { g: '附 · 前端速成（零基础）' },
    { href: 'basics-html.html', n: 'A', title: 'HTML / CSS：结构与摆放' },
    { href: 'basics-js.html',   n: 'B', title: 'JavaScript：变量、函数、事件' },
    { href: 'basics-canvas.html', n: 'C', title: 'Canvas：坐标、变换、画图' },
    { href: 'basics-debug.html', n: 'D', title: '调试：报错怎么读' }
  ];

  var page = (location.pathname.split('/').pop() || 'index.html');
  if (page === '' ) page = 'index.html';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ===================================================================
   * 二、左侧目录
   * ================================================================= */
  function buildSidebar() {
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    var html = '<a class="brand" href="index.html"><b>手搓一只桌宠</b>' +
               '<span>从一张表情包到会动的猫</span></a><nav>';
    NAV.forEach(function (it) {
      if (it.g) { html += '<div class="grp">' + it.g + '</div>'; return; }
      var on = it.href === page ? ' class="on"' : '';
      var cur = it.href === page ? ' aria-current="page"' : '';
      html += '<a href="' + it.href + '"' + on + cur + '>' +
              '<span class="n">' + it.n + '</span><span>' + it.title + '</span></a>';
    });
    html += '</nav>';
    sb.innerHTML = html;
  }

  /* ===================================================================
   * 三、顶栏
   * ================================================================= */
  function buildTopbar() {
    var tb = document.getElementById('topbar');
    if (!tb) return;
    var cur = null;
    NAV.forEach(function (it) { if (it.href === page) cur = it; });
    tb.innerHTML =
      '<a class="iconbtn" id="menubtn" href="#" aria-label="打开目录">☰</a>' +
      '<div class="crumb"><a href="index.html">手搓桌宠</a> / <b>' +
        (cur ? cur.title : '教程') + '</b></div>' +
      '<span class="spacer"></span>' +
      '<a class="iconbtn" href="../index.html">成品</a>' +
      '<a class="iconbtn hide-sm" href="../TUTORIAL.md" title="纯 Markdown 版">长文版</a>';

    var mb = document.getElementById('menubtn');
    if (mb) mb.addEventListener('click', function (e) {
      e.preventDefault();
      document.getElementById('sidebar').classList.toggle('open');
    });
  }

  /* ===================================================================
   * 四、右侧页内目录
   * ================================================================= */
  function buildToc() {
    var art = document.querySelector('#main article');
    var toc = document.getElementById('toc');
    if (!art || !toc) return;
    var hs = art.querySelectorAll('h2, h3');
    if (hs.length < 2) { toc.remove(); document.body.classList.remove('has-toc'); return; }
    var html = '<div class="h">本页内容</div>';
    var ids = [];
    Array.prototype.forEach.call(hs, function (h, i) {
      if (!h.id) h.id = 'sec-' + i;
      ids.push(h.id);
      html += '<a class="' + (h.tagName === 'H3' ? 'lv3' : '') + '" href="#' + h.id + '">' +
              h.textContent.replace(/\s+/g, ' ').trim() + '</a>';
    });
    toc.innerHTML = html;
    document.body.classList.add('has-toc');

    var links = toc.querySelectorAll('a');
    var map = {};
    Array.prototype.forEach.call(links, function (a) { map[a.getAttribute('href').slice(1)] = a; });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = map[en.target.id];
        if (!a) return;
        if (en.isIntersecting) {
          Array.prototype.forEach.call(links, function (x) { x.classList.remove('on'); });
          a.classList.add('on');
        }
      });
    }, { rootMargin: '-70px 0px -70% 0px', threshold: 0 });
    Array.prototype.forEach.call(hs, function (h) { io.observe(h); });
  }

  /* ===================================================================
   * 五、上下页
   * ================================================================= */
  function buildPager() {
    var p = document.getElementById('pager');
    if (!p) return;
    var flat = NAV.filter(function (it) { return it.href; });
    var i = flat.findIndex(function (it) { return it.href === page; });
    var prev = i > 0 ? flat[i - 1] : null;
    var next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
    var html = '';
    html += prev
      ? '<a class="prev" href="' + prev.href + '"><span class="lbl">← 上一页</span><span class="ttl">' + prev.title + '</span></a>'
      : '<a class="prev empty"></a>';
    html += next
      ? '<a class="next" href="' + next.href + '"><span class="lbl">下一页 →</span><span class="ttl">' + next.title + '</span></a>'
      : '<a class="next empty"></a>';
    p.innerHTML = html;
  }

  /* ===================================================================
   * 六、代码块：加语言标签 + 复制按钮
   * ================================================================= */
  function enhanceCode() {
    document.querySelectorAll('#main pre').forEach(function (pre) {
      if (pre.parentNode.classList.contains('codeblock')) return;
      var wrap = el('div', 'codeblock');
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      var m = pre.className.match(/lang-(\w+)/);
      var label = pre.getAttribute('data-label') || (m ? m[1] : '');
      if (!label) wrap.className += ' nofn';
      if (pre.hasAttribute('data-src')) wrap.className += ' full';
      if (label) {
        var fn = el('div', 'fn');
        fn.innerHTML = '<span>' + label + '</span>';
        wrap.insertBefore(fn, pre);
      }
      var btn = el('button', 'copy', '复制');
      btn.type = 'button';
      wrap.appendChild(btn);
      btn.addEventListener('click', function () {
        var txt = pre.textContent;
        var done = function () {
          btn.textContent = '已复制 ✓';
          btn.classList.add('done');
          setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('done'); }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, function () { fallback(txt, done); });
        } else fallback(txt, done);
      });
    });
    function fallback(txt, done) {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  /* ===================================================================
   * 七、勾选清单
   * ================================================================= */
  function enhanceChecklist() {
    var lists = document.querySelectorAll('.checklist');
    Array.prototype.forEach.call(lists, function (ul, li) {
      var boxes = ul.querySelectorAll('input[type=checkbox]');
      var out = ul.nextElementSibling;
      var key = 'tut-check-' + (ul.getAttribute('data-key') || location.pathname.split('/').pop() + '-' + li);
      var saved = {};
      try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
      function refresh() {
        var n = 0;
        Array.prototype.forEach.call(boxes, function (b) { if (b.checked) n++; });
        if (out && out.classList.contains('done-count')) {
          out.textContent = '完成 ' + n + ' / ' + boxes.length;
        }
      }
      Array.prototype.forEach.call(boxes, function (b, i) {
        if (saved[i]) b.checked = true;
        b.addEventListener('change', function () {
          saved[i] = b.checked;
          try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) {}
          refresh();
        });
      });
      refresh();
    });
  }

  /* ===================================================================
   * 八、角落桌宠（页面上想放就放：<body data-pet="170">）
   * ================================================================= */
  function mountPet() {
    var want = document.body.getAttribute('data-pet');
    if (!want) return;
    if (window.innerWidth < 1000) return;
    if (!window.LelePet) return;

    var pet = LelePet.mount({
      base: '../assets/',
      size: parseInt(want, 10) || 170,
      x: 0.965,
      roam: false,
      sound: false,
      dock: true,
      greet: false,
      posKey: 'tut-pet-pos',
      lines: {
        idle: ['照着做，一步一步来', '卡住了就回上一页看看', '代码可以直接复制',
               '别急着一次写完，先让它动起来', '三个常量改完就能换成你的图']
      }
    });
    window.tutPet = pet;

    // 文档里任何 [data-poke] 元素都能逗它一下
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-poke]');
      if (!t) return;
      pet.show();
      pet.poke();
    });
  }

  /* ===================================================================
   * 九、启动
   * ================================================================= */
  function boot() {
    buildSidebar();
    buildTopbar();
    buildToc();
    buildPager();
    enhanceCode();
    enhanceChecklist();
    mountPet();
    document.addEventListener('click', function (e) {
      var sb = document.getElementById('sidebar');
      if (sb && sb.classList.contains('open') && !e.target.closest('#sidebar') && !e.target.closest('#menubtn')) {
        sb.classList.remove('open');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
