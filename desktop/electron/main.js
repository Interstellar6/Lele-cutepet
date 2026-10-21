// main.js — 乐乐桌宠 · 桌面版（Electron）
//
// 支持 Linux / Windows / macOS。网页部分和 macOS 原生壳完全共用（desktop/macos/pet.html
// 和 dashboard.html），所以两边行为一致：
//   透明无边框窗口 · 总在最前 · 点空白处穿透 · 真实鼠标喂给眼睛 · 拖拽移动窗口 · 右键仪表盘
//
// 运行：npm start          （首次会 npm install electron）
// 自检：npm run selftest   （打印窗口属性 + 页面状态 + 截图到 /tmp，然后退出）
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

const LOG = '/tmp/lele-electron.log';
function log(line) {
  const s = line + '\n';
  try { fs.appendFileSync(LOG, s); } catch (e) { /* 忽略 */ }
  process.stdout.write(s);
}

const WEB = path.join(__dirname, 'web');
const PRELOAD = path.join(__dirname, 'preload.js');

let petWin = null;
let dashWin = null;
let tray = null;

let petSize = 220;
let alwaysOnTop = true;
let muted = false;
let roamEnabled = false;

let dragFrom = null;      // 拖拽起点（屏幕坐标）
let dragWin = null;       // 拖拽开始时窗口位置
let hitArea = null;       // 猫身上那块（窗口内 CSS 像素）
let dragging = false;
let ignoringMouse = false;   // 自己记状态：Electron 没有 isIgnoringMouseEvents()
let gazeTimer = null;
let clickTimer = null;
let roamTimer = null;
let roamTarget = null;
let roamDir = 1;
let lastSaid = '';
let lastState = 'idle';
let selftest = false;

/* ─────────────── 配置持久化 ─────────────── */

const statePath = () => path.join(app.getPath('userData'), 'pet-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { return {}; }
}
function saveState(patch) {
  const s = Object.assign(loadState(), patch);
  try { fs.writeFileSync(statePath(), JSON.stringify(s, null, 2)); } catch (e) { /* 忽略 */ }
}

/* ─────────────── 尺寸 ─────────────── */

function windowSize(px) {
  const h = px * 792 / 811;
  return {
    width: Math.round(px * 1.4 + 20),
    height: Math.round(h * 1.48 + 34 + 92),
  };
}

function defaultPosition(size) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - size.width - 40, y: wa.y + wa.height - size.height - 24 };
}

/* ─────────────── 桌宠窗口 ─────────────── */

function createPetWindow() {
  const saved = loadState();
  petSize = saved.size || petSize;
  alwaysOnTop = saved.alwaysOnTop !== false;

  const size = windowSize(petSize);
  const pos = (saved.x != null && saved.y != null)
    ? { x: saved.x, y: saved.y }
    : defaultPosition(size);

  petWin = new BrowserWindow({
    ...size,
    ...pos,
    transparent: true,          // 关键：窗口透明
    backgroundColor: '#00000000',
    frame: false,               // 无边框
    hasShadow: false,
    resizable: false,
    movable: false,             // 拖拽由页面事件驱动，避免和系统拖动打架
    alwaysOnTop: alwaysOnTop,
    skipTaskbar: true,
    focusable: false,           // 点它不抢焦点（Linux/Windows 生效）
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
  petWin.setIgnoreMouseEvents(false);
  petWin.loadFile(path.join(WEB, 'pet.html'));

  petWin.once('ready-to-show', () => {
    petWin.showInactive();      // 不抢焦点地显示
    log(`pet · window ${JSON.stringify(petWin.getBounds())} transparent=${petWin.isAlwaysOnTop()}`);
  });

  petWin.on('closed', () => { petWin = null; });

  // 排查用：渲染进程崩了/无响应会悄悄吞掉 executeJavaScript
  petWin.webContents.on('render-process-gone', (_e, d) => log(`pet · render-process-gone ${JSON.stringify(d)}`));
  petWin.webContents.on('unresponsive', () => log('pet · unresponsive'));
  petWin.webContents.on('preload-error', (_e, f, err) => log(`pet · preload-error ${f} ${err.message}`));
  petWin.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) log(`pet · console[${level}] ${msg}`);
  });
}

/* ─────────────── 视线：把真实鼠标喂给页面 ─────────────── */

function startGaze() {
  let ticks = 0;
  // 关键：串行 —— 上一次 executeJavaScript 回来了才发下一次。
  // 用 setInterval 硬发会排队堆积（页面越忙越积越多），最后把别的调用也堵住。
  const loop = () => {
    if (!petWin || petWin.isDestroyed()) return;
    if (!petWin.isVisible()) { gazeTimer = setTimeout(loop, 120); return; }
    const p = screen.getCursorScreenPoint();       // DIP 屏幕坐标（左上原点）
    const b = petWin.getBounds();
    petWin.webContents.executeJavaScript(
      `window.petLookAt && window.petLookAt(${b.x}, ${b.y}, ${p.x}, ${p.y})`
    ).catch(() => {}).then(() => {
      if (++ticks === 20) log('gaze · 20 次视线推送完成');
      gazeTimer = setTimeout(loop, 45);
    });
  };
  loop();
}

/* ─────────────── 点穿：鼠标不在猫身上就让点击穿到底下 ─────────────── */

function setIgnoreMouse(ignore) {
  if (!petWin || petWin.isDestroyed() || ignoringMouse === ignore) return;
  ignoringMouse = ignore;
  // forward:true → 鼠标事件仍然转给页面，所以悬停/进出还能收到
  petWin.setIgnoreMouseEvents(ignore, { forward: true });
  log(`click-through · ignore=${ignore}`);
}

function startClickThrough() {
  clickTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed() || !petWin.isVisible() || dragging || !hitArea) return;
    const p = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const lx = p.x - b.x;
    const ly = p.y - b.y;
    const inside = lx >= hitArea.x - 6 && lx <= hitArea.x + hitArea.w + 6 &&
                   ly >= hitArea.y - 6 && ly <= hitArea.y + hitArea.h + 6;
    setIgnoreMouse(!inside);
  }, 33);
}

/* ─────────────── 散步：窗口自己溜达 ─────────────── */

function startRoam() {
  roamTimer = setInterval(() => {
    if (!roamEnabled || dragging || !petWin || petWin.isDestroyed()) return;
    if (dashWin && dashWin.isVisible()) return;

    const wa = screen.getPrimaryDisplay().workArea;
    const b = petWin.getBounds();

    if (roamTarget == null) {
      if (Math.random() < 0.004) {
        roamTarget = wa.x + Math.round(Math.random() * Math.max(1, wa.width - b.width));
      }
      return;
    }
    const dx = roamTarget - b.x;
    if (Math.abs(dx) < 2) { roamTarget = null; return; }
    const dir = dx > 0 ? 1 : -1;
    const step = dir * Math.min(Math.abs(dx), 80 * 0.05);
    petWin.setPosition(Math.round(b.x + step), b.y);
    if (dir !== roamDir) {
      roamDir = dir;
      petWin.webContents.executeJavaScript(`desktopPet.face(${dir})`).catch(() => {});
    }
  }, 50);
}

/* ─────────────── 仪表盘 ─────────────── */

const DASH = { width: 340, height: 468 };

function showDashboard() {
  if (!dashWin || dashWin.isDestroyed()) {
    dashWin = new BrowserWindow({
      ...DASH,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
    });
    dashWin.setAlwaysOnTop(true, 'screen-saver');
    dashWin.loadFile(path.join(WEB, 'dashboard.html'));
    dashWin.on('blur', () => { if (dashWin && !selftest) dashWin.hide(); });
    dashWin.on('closed', () => { dashWin = null; });
  }

  // 贴着猫的左边放，超出屏幕就翻到右边
  if (petWin) {
    const pb = petWin.getBounds();
    const wa = screen.getDisplayMatching(pb).workArea;
    let x = pb.x - DASH.width + 40;
    if (x < wa.x + 8) x = pb.x + pb.width - 40;
    x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - DASH.width - 8));
    const y = Math.max(wa.y + 8, Math.min(pb.y + 60, wa.y + wa.height - DASH.height - 8));
    dashWin.setPosition(Math.round(x), Math.round(y));
  }
  dashWin.show();
  dashWin.focus();
  pushDashState();
  log('dashboard · shown');
}

function hideDashboard() {
  if (dashWin && !dashWin.isDestroyed()) dashWin.hide();
}

function dashPayload() {
  return JSON.stringify({
    state: lastState,
    said: lastSaid,
    size: petSize,
    sound: !muted,
    roam: roamEnabled,
    top: alwaysOnTop,
  });
}

function pushDashState() {
  if (!dashWin || dashWin.isDestroyed()) return;
  const t0 = Date.now();
  dashWin.webContents.executeJavaScript(`window.dashUpdate && window.dashUpdate(${dashPayload()})`)
    .then(() => log(`dash-state · 面板侧 ${Date.now() - t0}ms`))
    .catch((e) => log(`dash-state · 面板侧 ERROR ${e.message}`));
}

function handleDash(body) {
  const action = body.action;
  const val = body.value;
  const js = (code) => petWin && !petWin.isDestroyed() && petWin.webContents.executeJavaScript(code).catch(() => {});

  switch (action) {
    case 'pat': js('desktopPet.pat(true)'); break;
    case 'hop': js('desktopPet.hop()'); break;
    case 'spin': js('desktopPet.spin()'); break;
    case 'sleep': js('desktopPet.sleep()'); break;
    case 'say': {
      const lines = ['今天也要开心呀', '我在桌面上陪你', '记得喝水', '写代码辛苦了', '别熬夜太晚'];
      const t = lines[Math.floor(Math.random() * lines.length)];
      js(`desktopPet.say(${JSON.stringify(t)})`);
      break;
    }
    case 'home': goHome(); break;
    case 'size': setPetSize(val); break;
    case 'sound':
      muted = val === false;
      js(`desktopPet.setVolume(${muted ? 0 : 0.25})`);
      break;
    case 'roam':
      roamEnabled = !!val;
      if (!roamEnabled) roamTarget = null;
      saveState({ roam: roamEnabled });
      break;
    case 'top':
      alwaysOnTop = !!val;
      petWin.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
      saveState({ alwaysOnTop });
      break;
    case 'reload': petWin.webContents.reload(); break;
    case 'hide':
      petWin.hide();
      hideDashboard();
      break;
    case 'close': hideDashboard(); break;
    case 'quit': app.quit(); break;
    default: break;
  }
  setTimeout(pushDashState, 160);
}

function goHome() {
  if (!petWin) return;
  const size = windowSize(petSize);
  const p = defaultPosition(size);
  petWin.setBounds({ ...p, ...size });
  saveState({ x: p.x, y: p.y });
  petWin.webContents.executeJavaScript("desktopPet.say('回来啦')").catch(() => {});
}

/* ─────────────── 托盘 ─────────────── */

function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(WEB, 'assets', 'lele.png'));
    if (!icon.isEmpty()) icon = icon.resize({ width: 22, height: 22 });
  } catch (e) { /* 忽略 */ }
  if (!icon || icon.isEmpty()) {
    // 兜底：一张 16x16 的粉色圆点
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('乐乐桌宠');
  rebuildTrayMenu();

  if (process.platform === 'win32' || process.platform === 'linux') {
    // 左键点托盘 = 打开仪表盘（Linux 上部分桌面只有菜单）
    tray.on('click', () => showDashboard());
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开仪表盘…', accelerator: 'CmdOrCtrl+D', click: () => showDashboard() },
    {
      label: petWin && petWin.isVisible() ? '藏起来' : '叫出来',
      click: () => {
        if (!petWin) return;
        if (petWin.isVisible()) petWin.hide(); else petWin.showInactive();
        rebuildTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '大小',
      submenu: [160, 200, 240, 280].map((px) => ({
        label: `${px}px`, type: 'radio', checked: petSize === px,
        click: () => setPetSize(px),
      })),
    },
    {
      label: '总在最前', type: 'checkbox', checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked;
        petWin.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
        saveState({ alwaysOnTop });
      },
    },
    {
      label: '静音', type: 'checkbox', checked: muted,
      click: (item) => {
        muted = item.checked;
        if (petWin) petWin.webContents.executeJavaScript(`desktopPet.setVolume(${muted ? 0 : 0.25})`).catch(() => {});
      },
    },
    { type: 'separator' },
    { label: '重新加载', click: () => petWin && petWin.webContents.reload() },
    { label: '退出乐乐', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function setPetSize(px) {
  if (!petWin) return;
  petSize = Math.max(120, Math.min(340, Math.round(px || 220)));
  const size = windowSize(petSize);
  const b = petWin.getBounds();
  petWin.setBounds({ x: Math.round(b.x + (b.width - size.width) / 2), y: b.y, ...size });
  petWin.webContents.executeJavaScript(`desktopPet.setSize(${petSize})`).catch(() => {});
  saveState({ size: petSize });
  rebuildTrayMenu();
}

/* ─────────────── 页面 → 外壳 ─────────────── */

function handlePet(body) {
  const cmd = body.cmd;
  switch (cmd) {
    case 'dragStart':
      dragging = true;
      setIgnoreMouse(false);
      dragFrom = { x: body.x, y: body.y };
      dragWin = petWin.getBounds();
      log(`msg · dragStart ${Math.round(body.x)},${Math.round(body.y)}`);
      break;

    case 'dragMove':
      if (!dragging || !dragFrom || !dragWin) return;
      petWin.setPosition(
        Math.round(dragWin.x + (body.x - dragFrom.x)),
        Math.round(dragWin.y + (body.y - dragFrom.y))
      );
      break;

    case 'dragEnd':
      dragging = false;
      if (petWin) {
        const b = petWin.getBounds();
        saveState({ x: b.x, y: b.y });
      }
      dragFrom = null;
      dragWin = null;
      break;

    case 'hitArea':
      hitArea = { x: body.x, y: body.y, w: body.w, h: body.h };
      log(`msg · hitArea ${Math.round(body.x)},${Math.round(body.y)} ${Math.round(body.w)}x${Math.round(body.h)}`);
      break;

    case 'menu':
      showDashboard();          // 右键 = 仪表盘（和 mac 版一致）
      break;

    case 'said':
      lastSaid = body.text || '';
      break;

    case 'state':
      lastState = body.state || 'idle';
      lastSaid = body.said || '';
      if (body.size) petSize = body.size;
      if (dashWin) pushDashState();
      break;

    case 'hide':
      if (petWin) petWin.hide();
      hideDashboard();
      break;

    default:
      break;
  }
}

/* ─────────────── 自检 ─────────────── */

function runSelftest() {
  selftest = true;
  setTimeout(async () => {
    const lines = [];
    lines.push('=== 乐乐桌宠 · Electron 自检 ===');
    lines.push(`platform      : ${process.platform} ${process.arch}  electron=${process.versions.electron}`);
    lines.push(`window bounds : ${JSON.stringify(petWin.getBounds())}`);
    lines.push(`transparent   : ${petWin.isAlwaysOnTop() ? 'alwaysOnTop=true' : 'alwaysOnTop=false'}`);
    lines.push(`visible       : ${petWin.isVisible()}`);
    lines.push(`hitArea       : ${JSON.stringify(hitArea)}`);

    try {
      const js = `JSON.stringify({pet: !!window.desktopPet, ready: window.desktopPet && window.desktopPet.ready,
        mode: window.desktopPet && window.desktopPet.mode, w: window.desktopPet && window.desktopPet.w,
        bridge: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pet)})`;
      const state = await petWin.webContents.executeJavaScript(js);
      lines.push(`page state    : ${state}`);

      const img = await petWin.webContents.capturePage();
      fs.writeFileSync('/tmp/lele-electron.png', img.toPNG());
      const s = img.getSize();
      lines.push(`capture       : /tmp/lele-electron.png ${s.width}x${s.height}`);
    } catch (e) {
      lines.push(`page state    : ERROR ${e.message}`);
    }

    log(lines.join('\n'));
    setTimeout(() => app.quit(), 200);
  }, 1800);
}

/* ─────────────── 拖拽端到端测试 ─────────────── */

async function runDragtest() {
  const before = petWin.getBounds();
  log(`dragtest · 起点 ${JSON.stringify(before)}`);
  const js = `(function(){
    var hit = window.desktopPet.hit, r = hit.getBoundingClientRect();
    var x = r.left + r.width/2, y = r.top + r.height/2;
    var sx = window.screenX + x, sy = window.screenY + y;
    function ev(t, cx, cy, scx, scy) {
      hit.dispatchEvent(new PointerEvent(t, {bubbles:true, cancelable:true, pointerId:1,
        isPrimary:true, clientX:cx, clientY:cy, screenX:scx, screenY:scy, pointerType:'mouse', buttons:1}));
    }
    ev('pointerdown', x, y, sx, sy);
    for (var i=1;i<=5;i++) ev('pointermove', x+i*8, y+i*8, sx+i*8, sy+i*8);
    ev('pointerup', x+40, y+40, sx+40, sy+40);
    return JSON.stringify({sx: Math.round(sx), sy: Math.round(sy), screenX: window.screenX, screenY: window.screenY});
  })()`;
  const info = await petWin.webContents.executeJavaScript(js);
  log(`dragtest · 事件派发 ${info}`);
  setTimeout(() => {
    const after = petWin.getBounds();
    const dx = after.x - before.x, dy = after.y - before.y;
    log(`dragtest · 终点 ${JSON.stringify(after)}  位移=(${dx}, ${dy})  期望=(32, 32)  ` +
        `${Math.abs(dx - 32) < 3 && Math.abs(dy - 32) < 3 ? '✓ 通过' : '✗ 不符'}`);
    setTimeout(() => app.quit(), 200);
  }, 500);
}

/* ─────────────── 启动 ─────────────── */

const wantSelftest = process.argv.includes('--selftest');
const wantDragtest = process.argv.includes('--dragtest');
const wantDashtest = process.argv.includes('--dashtest');
const wantPattest = process.argv.includes('--pattest');

app.whenReady().then(() => {
  try { fs.unlinkSync(LOG); } catch (e) { /* 忽略 */ }
  log(`launch · ${process.platform} ${process.arch} electron ${process.versions.electron}`);

  if (process.platform === 'darwin' && app.dock) app.dock.hide();   // mac 不占 Dock

  createPetWindow();
  createTray();
  startGaze();
  startClickThrough();
  startRoam();

  ipcMain.on('pet', (_e, body) => handlePet(body || {}));
  ipcMain.on('dash', (_e, body) => {
    const b = body || {};
    log(`ipc · dash ${JSON.stringify(b)}`);
    if (b.cmd === 'dash') handleDash(b);
    else if (b.cmd === 'dashReady') pushDashState();
  });

  petWin.webContents.once('did-finish-load', () => {
    log('web · didFinish pet.html');
    if (wantSelftest) runSelftest();
    if (wantDragtest) setTimeout(runDragtest, 1200);
    if (wantPattest) setTimeout(async () => {
      selftest = true;
      const t = async (tag, code) => {
        const t0 = Date.now();
        try {
          const v = await Promise.race([
            petWin.webContents.executeJavaScript(code),
            new Promise((_r, rej) => setTimeout(() => rej(new Error('TIMEOUT 5s')), 5000)),
          ]);
          log(`pattest · ${tag}  ${Date.now() - t0}ms  => ${JSON.stringify(v)}`);
        } catch (e) {
          log(`pattest · ${tag}  ${Date.now() - t0}ms  => ${e.message}`);
        }
      };
      await t('① 基础', '1+1');
      await t('② pat', 'desktopPet.pat(true) && "ok"');
      await t('③ pat 之后', '1+1');
      showDashboard();
      await new Promise((r) => setTimeout(r, 900));
      await t('④ 开面板后', '1+1');
      await t('⑤ 面板里点击', 'desktopPet.pat(true) && "ok"');
      await t('⑥ 点击后', '1+1');
      log('pattest · 完成');
      setTimeout(() => app.quit(), 300);
    }, 1200);

    if (wantDashtest) setTimeout(async () => {
      selftest = true;                       // 关掉「失焦自动隐藏」，否则测试窗口会被藏掉
      const ev = (win, code, tag) => {
        let t = null;
        return Promise.race([
          win.webContents.executeJavaScript(code)
            .then((v) => { clearTimeout(t); log(`  [${tag}] => ${JSON.stringify(v)}`); return v; })
            .catch((e) => { clearTimeout(t); log(`  [${tag}] ERROR ${e.message}`); return null; }),
          new Promise((r) => { t = setTimeout(() => { log(`  [${tag}] TIMEOUT(4s)`); r(null); }, 4000); }),
        ]);
      };

      showDashboard();
      await new Promise((r) => setTimeout(r, 900));
      log(`dashtest · 仪表盘可见=${dashWin.isVisible()} ${dashWin.isVisible() ? '✓ 通过' : '✗'}`);

      const before = await ev(petWin, "JSON.stringify({emote: desktopPet.emote && desktopPet.emote.name})", 'before');
      log(`dashtest · 点击前 ${before}`);

      const bridgeInfo = await ev(dashWin, "JSON.stringify({webkit: typeof window.webkit, dash: typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dash), post: typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dash && window.webkit.messageHandlers.dash.postMessage), dashUpdate: typeof window.dashUpdate, buttons: document.querySelectorAll('[data-a]').length})", 'bridge');
      log(`dashtest · 面板桥 ${bridgeInfo}`);
      const clicked = await ev(dashWin, "!!document.querySelector('[data-a=pat]') && (document.querySelector('[data-a=pat]').click(), 'ok')", 'click');
      log(`dashtest · 点击摸摸头 ${clicked}`);

      await new Promise((r) => setTimeout(r, 800));
      log(`dashtest · 桌宠说的话（页面主动上报）= 「${lastSaid}」 ${lastSaid ? '✓ 通过' : '✗ 没说话'}`);

      const shown = await ev(dashWin, "document.getElementById('said').textContent", 'shown');
      log(`dashtest · 面板显示 ${shown}`);

      const sizeVal = await ev(dashWin, "(document.querySelector('input[type=range]')||{}).value", 'size');
      log(`dashtest · 尺寸控件显示 ${sizeVal}`);
      const roamBox = await ev(dashWin, "Array.from(document.querySelectorAll('input[type=checkbox]')).map(function(b){return b.checked}).join(',')", 'roam');
      log(`dashtest · 散步开关 ${roamBox}`);
      log('dashtest · 完成');
      setTimeout(() => app.quit(), 300);
    }, 1200);
  });

  app.on('window-all-closed', (e) => { e.preventDefault(); });   // 关窗不退出（托盘还在）
});

app.on('before-quit', () => {
  clearTimeout(gazeTimer);
  clearInterval(clickTimer);
  clearInterval(roamTimer);
});
