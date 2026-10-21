# 桌面版：把猫放到 macOS 桌面上

不是浏览器标签页里的一只网页宠物，而是**一张真正贴在桌面上的浮窗**：

- 窗口形状就是猫本身，四周全透明，没有白框、没有标题栏
- 总在其它窗口上面，但**点它不会把你正在用的软件切走**（不抢焦点、不占 Dock）
- 鼠标在猫身上才接点击，**其余透明区域点穿**，不会挡住下面的编辑器
- 鼠标不在窗口上也**照旧盯着你的光标**（眼睛跟着真实鼠标转）
- 按住就能拖着走，位置下次启动还记得
- **右键桌宠（或菜单栏 🐱 → 打开仪表盘）**，弹出真正的控制面板：
  摸头 / 蹦 / 转圈 / 睡觉 / 说话 / 回到桌上、大小滑块、散步 / 音效 / 置顶开关
- 菜单栏 🐱 还留了一份快捷菜单：仪表盘 / 藏起来 / 大小 / 置顶 / 静音 / 说话 / 重载 / 退出

## 怎么装

```bash
cd desktop/macos
./build.sh            # 打包，几秒钟
open build/乐乐桌宠.app   # 或者直接在 Finder 里双击
```

`./build.sh` 只用系统自带的 `swiftc`，**不下载任何依赖**，也不需要 Xcode。
产物是一个 1MB 的 `.app`，双击就跑。

想开机自启：系统设置 → 通用 → 登录项 → 添加 `乐乐桌宠.app`。
想彻底删掉：退出（菜单栏 🐱 → 退出乐乐），再把 `.app` 扔进废纸篓。

## 为什么不用 Electron

| | 这个原生壳 | Electron |
| --- | --- | --- |
| 依赖 | 只用系统自带 `swiftc` | `npm install electron` 约 100–150MB |
| 产物大小 | **1.0 MB** | 150 MB 起 |
| 透明 + 无边框 | 原生窗口属性直接支持 | 可以，但透明窗口在部分平台有坑 |
| 不抢焦点 | `NSPanel` + `.nonactivatingPanel` | 需要额外调 `focusable: false`，行为各平台不一致 |
| 跨平台 | ❌ 只在 macOS | ✅ |

所以：**macOS 用这个，Windows / Linux 走 Electron 或 Tauri**（见最后一节）。

## 它怎么做到的

外壳只做四件事，全部在 [`Pet.swift`](Pet.swift) 里（约 430 行，注释很密）：

### 1. 一个透明、不激活的小窗口

```swift
panel = PetPanel(contentRect: rect,
                 styleMask: [.borderless, .nonactivatingPanel],   // 无边框 + 点它不激活 App
                 backing: .buffered, defer: false)
panel.isOpaque = false
panel.backgroundColor = .clear        // 窗口底色全透明
panel.hasShadow = false               // 不要系统投影（不然会有一圈灰边）
panel.level = .floating               // 总在最前
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
```

`NSPanel` 的 `.nonactivatingPanel` 是关键：普通窗口被点会激活整个 App，
把你正在写的代码切走；这个不会。

### 2. 让 WKWebView 也透明

页面 `html/body` 已经是 `background: transparent`，但 **WKWebView 自己还会刷一层白底**，
不关掉就是「白框里一只猫」。公开 API 里没有这个开关，要用私有的 `_setDrawsBackground:`：

```swift
if web.responds(to: NSSelectorFromString("_setDrawsBackground:")) {
    web.setValue(false, forKey: "drawsBackground")   // KVC 会自动找到带下划线的 setter
}
```

判断结果：`web.isOpaque` 从 `true` 变成 `false`，窗口四角 alpha = 0。
（换 macOS 大版本时如果又出现白底，先查这个 selector 有没有改名 ——
`./build.sh` 之后跑一次 `--shot`，日志里会打 `web.isOpaque`。）

### 3. 拖拽交给原生窗口

网页里拖一只宠物，只是把它在画布上挪位置；**桌面版要挪的是窗口**。
所以组件提供了一个 `dragMode: 'external'`：它自己不动，只把事件交出来。

```js
// desktop/macos/pet.html
dragMode: 'external',
onDragStart: e => send({ cmd: 'dragStart', x: e.screenX, y: e.screenY }),
onDragMove:  e => send({ cmd: 'dragMove',  x: e.screenX, y: e.screenY }),
onDragEnd:   e => send({ cmd: 'dragEnd',   x: e.screenX, y: e.screenY })
```

Swift 侧收到后，用「当前屏幕坐标 − 按下时的屏幕坐标」去移动窗口，
松手时把窗口位置存进 `UserDefaults`。

> 注意 JS 的屏幕坐标是**左上原点、y 向下**，AppKit 是**左下原点、y 向上**，
> 所以纵向位移要取反（代码里有注释）。

### 4. 眼睛盯着真实鼠标

网页只能拿到「鼠标在窗口内」的位置。桌面版由外壳每 50ms 把真实鼠标位置推给页面：

```swift
let m = NSEvent.mouseLocation                        // AppKit 坐标（左下原点）
let top = NSScreen.screens.first?.frame.maxY ?? 0    // 转成 CSS 的左上原点
let f = panel.frame
let js = String(format: "window.petLookAt(%.1f, %.1f, %.1f, %.1f)",
                f.minX, top - f.maxY, m.x, top - m.y)   // 窗口左上角 + 鼠标
```

页面里减一下就得到「窗口内坐标」，再交给组件的 `pet.lookAt(x, y)`。
所以你在别的窗口里打字，它也会一直看着你的光标。

> **坑（踩过）**：一开始我是让页面用 `window.screenX / screenY` 自己减窗口位置。
> 但 **WKWebView 里这两个值不可信** —— 实测无论窗口在哪都恒定返回 `0` 和 `屏幕高度`，
> 于是算出来的局部坐标是错的，眼睛卡在一个方向，看着像「没有跟踪」。
> 改成由外壳把窗口位置一起送过来才对。
>
> 用 `./build.sh` 之后跑 `--probe` 可以自测：它把指针挪到窗口四边，
> 打印每个方向算出来的 gaze 值。

### 5. 点空白处「点穿」

窗口比猫大（上面要给气泡留位置），那圈透明区域不应该挡住下面的软件。做法：
页面把「猫身上那块区域」（`#hit` 的矩形）报给外壳，外壳每 1/30 秒对比一次鼠标位置：

```swift
if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
```

鼠标在猫身上 → 接点击；移出去 → 立刻变成「忽略鼠标」，点击穿到下面的 App。

### 6. 仪表盘：复用网页那一套

右键不是弹一个干巴巴的菜单，而是打开一个**控制面板**（就是上面那张截图）。
它不是原生控件拼的，而是**第二个 WKWebView** 加载 `web/dashboard.html` ——
和网页版用的是同一套 CSS 和逻辑，所以：

- 网页版有什么按钮，桌面版就有（摸头 / 蹦 / 转圈 / 睡觉 / 说话 / 回到桌上）
- 加一个开关只要改 HTML，不用碰 Swift
- 面板和桌宠之间通过两条消息通道通信：

```
  仪表盘 ──{cmd:'dash', action:'pat'}──▶ 外壳 ──desktopPet.pat(true)──▶ 桌宠页面
  仪表盘 ◀──window.dashUpdate(json)──── 外壳 ◀──读 desktopPet 状态──── 桌宠页面
```

所以面板上的「状态：在发呆」和「「呼噜呼噜…」」都是**从桌宠那边实时读的**，
不是本地缓存的假数据。面板收起方式：点别处、按 Esc、点 ✕。

一个细节：桌宠那个窗口是 **不能**成为 key window 的（不然会抢焦点），
但仪表盘需要一个能接键盘的窗口（Esc 关闭）。所以它们用了两个不同的
`NSPanel` 子类 —— 这是 `canBecomeKey` 上的差别，不是两套逻辑。

### 7. 自己散步

打开仪表盘的「自己散步」，它会沿着屏幕底部自己溜达：
平均每 12 秒挑一个新的横坐标，以 80px/s 滑过去，朝哪边走在页面上就 `face()` 朝哪边。
拖动它、或者打开仪表盘时会自动停下。实现就是外壳里的一个 20Hz 定时器在移动窗口 ——
**猫本身没有动**，动的是窗口。

## 调试

```bash
./build.sh --selftest     # 打包 + 启动 + 打印窗口/页面状态后自动退出
./build.sh --run          # 打包 + 启动
```

不用 `--selftest` 直接跑时会写一份日志到 `/tmp/lele-pet-desktop.log`：

```
panel · frame={{1337, 285}, {328, 444}} level=3 opaque=false bgAlpha=0.0
web · didFinish pet.html
page · {"pet":true,"ready":true,"mode":"rig","w":220,"bridge":true,"hit":[80,234,167,176]}
gaze · 20 次视线推送完成（鼠标位置已送达页面）
```

另外两个参数：

| 参数 | 作用 |
| --- | --- |
| `--shot` | 让 WKWebView 自己截图到 `/tmp/lele-shot.png`，并报告四角 alpha |
| `--dragtest` | 在页面里合成 pointer 事件，走完「JS → 桥 → 移动窗口」整条链，核对位移 |
| `--dashtest` | 打开仪表盘，**真的点击面板上的按钮、拖滑块**，核对桌宠反应、面板回显、窗口尺寸 |
| `--dashshot` | 把仪表盘渲染成 `/tmp/lele-dash.png`，用于确认排版没坏 |
| `--probe` | 把指针挪到窗口四边，核对眼睛朝的方向（视线跟随端到端测试） |

`--shot` 的意义：这台机器如果没给「屏幕录制」权限，`screencapture` 是拿不到图的，
但 App 可以截自己，用它验证「真的没有白底」。

## 想改什么

| 想改 | 改哪儿 |
| --- | --- |
| 大小（默认 220） | `Pet.swift` 的 `sizes` 数组和 `petWidth` |
| 仪表盘里加个按钮 | `dashboard.html` 加 `<button data-a="xxx">`，再在 `Pet.swift` 的 `handleDash` 里加一个 case |
| 猫在窗口里的位置 | `pet.html` 里的 `size` / `x` / `floor` |
| 换一只猫 | 换 `assets/` 里的四张图，再同步组件顶部常量（见项目 README） |
| 加一个菜单项 | `Pet.swift` 的 `rebuildMenu()` |
| 加一种交互（比如右键让它睡） | `pet.html` 里 `send({cmd: 'sleep'})` + Swift 里加 case |
| 气泡台词 | `pet.html` 挂载时的 `lines` 选项，或者组件里的 `LINES` |

改完重跑 `./build.sh` 即可（网页和素材会被重新拷进 `.app` 里）。

## 已知限制

- **只在 macOS 上**（用了 AppKit + WKWebView）。Windows/Linux 见下。
- 透明依赖私有 selector `_setDrawsBackground:`，系统大版本升级后可能改名。
  真变了也不致命：会退化成「白底窗口」，日志里的 `web.isOpaque` 会告诉你。
- 只是 **ad-hoc 签名**（本机自用），拷到别的 Mac 上首次打开需要在
  「系统设置 → 隐私与安全性」里点「仍要打开」。
- 不抢焦点 = 不支持键盘输入（回车逗它那套在网页版里有效，桌面版只认鼠标）。

## 藏起来之后怎么找回来

点「藏起来」/「隐藏」之后，屏幕上就没有猫了 —— 程序**没有退出**，有三个入口叫它回来：

| 方式 | macOS 原生版 | Electron 版（Linux/Windows） |
| --- | --- | --- |
| 菜单栏 / 托盘 | 点菜单栏 **🐱** →「叫出来」 | 点托盘图标 →「叫出来」（GNOME 需装 appindicator 扩展） |
| 再开一次 App | 双击 `乐乐桌宠.app` | 再运行一次 `npm start` |
| 键盘快捷键 | — | `Ctrl+Alt+L`（macOS 上是 `⌘⌥L`） |

藏起来的那一刻屏幕上方还会弹一条 4 秒的提示，写着这两个入口 ——
就是为了避免「猫没了、以为程序崩了」。

## Windows / Linux

**已经做好了**，在 `desktop/electron/`：

```bash
cd desktop/electron
npm install     # 第一次下载 Electron（约 100MB）
npm start
```

同一套网页（`pet.html` + `dashboard.html` + `assets/`），网页部分**一行都没改** ——
`preload.js` 把 `window.webkit.messageHandlers.pet/dash` 桥接成了 IPC，
所以两个平台的壳共用同一份界面。

对照一下两边的实现：

| 功能 | macOS 原生壳 | Electron 壳 |
| --- | --- | --- |
| 透明窗口 | `NSWindow` + `_setDrawsBackground(false)` | `transparent:true` + `frame:false` |
| 总在最前 | `panel.level = .floating` | `setAlwaysOnTop(true, 'screen-saver')` |
| 点穿 | `panel.ignoresMouseEvents`（30Hz） | `setIgnoreMouseEvents`（33Hz） |
| 视线跟随 | `NSEvent.mouseLocation` → `evaluateJavaScript` | `screen.getCursorScreenPoint()` → `executeJavaScript` |
| 拖拽 | `panel.setFrameOrigin` | `win.setPosition` |
| 仪表盘 | 第二个 `NSPanel` | 第二个 `BrowserWindow` |
| 托盘 | `NSStatusItem` | `Tray` |
| 体积 | 约 1 MB | 约 200 MB（自带 Chromium） |

自检命令和 mac 版一一对应：

```bash
npm run selftest   # 窗口属性 + 页面状态 + 截图
npm run dragtest   # 合成拖拽，验证位移
npm run dashtest   # 开面板 → 点摸摸头 → 验证猫的反应和面板同步
```

Linux 的几个坑（合成器、GNOME 托盘扩展、Wayland 下点穿失效、
`ELECTRON_RUN_AS_NODE` 导致 `app` 为 undefined）都写在
[`electron/README.md`](electron/README.md) 里。
