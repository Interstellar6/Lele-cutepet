# 乐乐桌宠 · Electron 版（Linux / Windows / macOS）

同一套网页，换一个外壳。`desktop/macos/` 那个是 Swift + AppKit 写的 —— 只有 macOS 能跑。
这个目录用 Electron，一份代码三个平台都能跑。

> 如果你只是想让猫待在 **Linux 桌面**上，用这个；macOS 上两种都行，
> 原生版更轻（1MB vs 约 200MB），功能一样。

## 跑起来

```bash
cd desktop/electron
npm install          # 第一次要下载 Electron（约 100MB）
npm start
```

`npm start` 会先跑 `prepare.js`（把 `../macos/pet.html`、`dashboard.html`
和项目根的 `assets/` 拷进 `web/`，这是构建产物，不入库），再启动窗口。

## 自检

和 mac 版一一对应，不用肉眼验证：

```bash
npm run selftest     # 打印窗口属性 / 页面状态，并把窗口截图存到 /tmp/lele-electron.png
npm run dragtest     # 合成一次拖拽，检查窗口位移是不是 32pt
npm run dashtest     # 打开仪表盘 → 点「摸摸头」→ 检查猫有没有反应、面板有没有同步
```

日志都写在 `/tmp/lele-electron.log`。

## 它做了什么

| 功能 | 实现 |
| --- | --- |
| 透明无边框窗口 | `transparent:true` + `frame:false` + `backgroundColor:'#00000000'` |
| 总在最前 | `setAlwaysOnTop(true, 'screen-saver')` |
| 不占任务栏 / Dock | `skipTaskbar:true`，mac 上 `app.dock.hide()` |
| 点它不抢焦点 | `focusable:false` + `showInactive()` |
| **点空白处能穿透** | 页面把猫身上那块矩形报上来 → 主进程每 33ms 判断鼠标是否在里面 → `setIgnoreMouseEvents` |
| **眼睛跟真实鼠标** | `screen.getCursorScreenPoint()` 每 45ms 推给页面（串行，避免排队） |
| 拖它就是拖窗口 | `movable:false`，页面发 `dragStart/dragMove`，主进程 `setPosition` |
| 右键 → 仪表盘 | 页面发 `{cmd:'menu'}` → 第二个 BrowserWindow |
| 托盘菜单 | `Tray` + 「大小 / 置顶 / 静音 / 藏起来 / 退出」 |
| 状态回灌到面板 | 宠物页每 800ms **主动上报**，外壳只做转发（不去页面里注入脚本查） |

网页那部分一行没改 —— `preload.js` 把 `window.webkit.messageHandlers.pet/dash`
桥接成了 IPC，所以 `pet.html` / `dashboard.html` 和 mac 版共用。

## 藏起来之后怎么找回来

程序不会退出，只是把窗口藏了。三个入口：

- **托盘图标** →「叫出来」（GNOME 要装 appindicator 扩展才看得到托盘）
- **再运行一次** `npm start`（单实例锁会把你连到已经跑着的那个，并自动把它叫出来）
- **`Ctrl+Alt+L`**（macOS 上 `⌘⌥L`）全局开关

藏起来时会弹一条系统通知，写明这几条路。

## Linux 上的注意事项

**透明需要合成器。** GNOME / KDE / Cinnamon / XFCE(开合成) 默认都有，没问题；
纯 X11 窗口管理器（如 i3 不配 `picom`）会看到黑底 —— 这时桌宠就不是「贴」在桌面上了。

**托盘图标**：GNOME 需要安装 **AppIndicator 扩展**（`gnome-shell-extension-appindicator`）
才能看到托盘；KDE / XFCE 原生支持。看不到托盘也能用：右键猫猫打开仪表盘。

**Wayland**：

- Electron 33 默认走 XWayland，透明和点穿都正常，只是系统认为它是 X 应用。
- 想用原生 Wayland：`ELECTRON_OZONE_PLATFORM_HINT=auto npm start`。
  原生 Wayland 下**点穿（`setIgnoreMouseEvents`）可能不生效** ——
  猫的窗口会挡住它底下的点击。如果介意，就用默认的 XWayland。

**如果窗口是黑底或者不透明**，先试试关掉 GPU 加速：

```bash
npx electron . --disable-gpu
```

（默认开着 GPU，因为现代合成器下透明更稳。）

## Windows 上的注意事项

- 透明窗口要求 `resizable:false`，已经设好了；改成 true 会变黑。
- 点穿在 Windows 上工作正常。
- 首次运行如果杀软拦，那是 `electron.exe` 的常规情况。

## 常见坑

**报 `Cannot read properties of undefined (reading 'whenReady')`**

说明 `ELECTRON_RUN_AS_NODE=1` 在这个终端里被设了（VS Code 的集成终端常见），
Electron 被当成普通 Node 跑，于是 `require('electron')` 返回的不是 API 而是可执行文件路径。

```bash
env -u ELECTRON_RUN_AS_NODE npx electron .
```

**报 `Failed to load URL ... ERR_FILE_NOT_FOUND`**

忘了跑 `prepare.js`。用 `npm start`（会自动跑），或者先 `npm run prepare:web`。

## 打包成可分发的程序（可选）

这个目录没有加打包依赖。想做成 AppImage / exe：

```bash
npm i -D electron-builder
npx electron-builder --linux AppImage --win nsis
```

（`web/` 是运行时拷进去的，打包前先 `npm run prepare:web`。）
