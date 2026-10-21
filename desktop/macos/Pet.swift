// Pet.swift — 乐乐桌宠 · 原生 macOS 外壳
//
// 做四件事：
//   1. 开一个「透明、无边框、不抢焦点、总在最前」的小窗口
//   2. 把 web/pet.html 装进这个窗口（页面本身背景全透明）
//   3. 页面拖拽时把屏幕坐标发过来，这里移动窗口
//   4. 菜单栏图标：改大小 / 置顶 / 静音 / 重新加载 / 退出
//
// 编译：./build.sh（只用系统自带的 swiftc，不下载任何依赖）
// 调试：./build.sh && "./build/乐乐桌宠.app/Contents/MacOS/LelePet" --selftest

import Cocoa
import Carbon.HIToolbox
import WebKit

// MARK: - 窗口

/// 无边框、不激活 App 的浮动小窗：点它不会把当前正在用的软件切走
final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// 仪表盘：需要接收键盘（Esc 关闭），所以允许成为 key window
final class DashPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {

    /// 把关键状态写进文件：没有截图权限时靠它做客观验证
    private let logPath = "/tmp/lele-pet-desktop.log"
    private func log(_ text: String) {
        let line = text + "\n"
        if let h = FileHandle(forWritingAtPath: logPath) {
            h.seekToEndOfFile()
            h.write(line.data(using: .utf8)!)
            try? h.close()
        } else {
            try? line.write(toFile: logPath, atomically: true, encoding: .utf8)
        }
        fputs(line, stderr)
    }


    private var panel: PetPanel!
    private var web: WKWebView!
    private var status: NSStatusItem!
    private var hotKeyRef: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?

    private var petWidth: CGFloat = 220          // 页面里桌宠的显示宽度
    private var petSizeIndex = 1
    private let sizes: [CGFloat] = [160, 200, 240, 280]

    private var dragStartScreen: NSPoint?        // 拖拽起点（屏幕坐标，左上原点）
    private var dragStartOrigin: NSPoint?        // 拖拽开始时窗口的位置
    private var dragging = false

    private var hitArea = NSRect(x: 0, y: 0, width: 0, height: 0)   // 猫身上那块（窗口坐标，左上原点）
    // 仪表盘
    private var dashPanel: DashPanel?
    private var dashWeb: WKWebView?

    // 散步
    private var roamEnabled = false
    private var roamTargetX: CGFloat?
    private var roamDir: CGFloat = 1
    private var roamTimer: Timer?

    private var gazeTimer: Timer?
    private var gazeTicks = 0
    private var clickThruTimer: Timer?
    private var alwaysOnTop = true
    private var muted = false

    // MARK: 启动

    /// 再次双击 App / 在 Finder 里点它 → 把藏起来的猫叫回来。
    /// 没有这一步的话，用户点了「隐藏」之后就只剩菜单栏一个入口，很容易找不到。
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        log("reopen · 重新打开 App → 显示桌宠")
        showPet()
        return false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? "".write(toFile: logPath, atomically: true, encoding: .utf8)   // 每次启动清空
        log("launch · screen=\(NSScreen.main?.frame.debugDescription ?? "nil")")
        log("step · before setActivationPolicy")
        NSApp.setActivationPolicy(.accessory)     // 不占 Dock、不抢焦点
        log("step · after setActivationPolicy")
        buildPanel()
        buildMenu()
        installHotKey()
        startTimers()
        startRoam()

        if CommandLine.arguments.contains("--selftest") { selftest() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        gazeTimer?.invalidate()
        clickThruTimer?.invalidate()
    }

    // MARK: 窗口 + 网页

    private func buildPanel() {
        log("build · 0 begin")
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "pet")

        log("build · 1 configure ok")
        let size = windowSize(for: petWidth)
        let origin = restoredOrigin(for: size)

        log("build · 2 size=\(size) origin=\(origin)")
        panel = PetPanel(contentRect: NSRect(origin: origin, size: size),
                         styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.ignoresMouseEvents = false
        log("build · 3 panel created")

        log("build · 4 creating webview")
        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.wantsLayer = true
        web.layer?.backgroundColor = NSColor.clear.cgColor
        // WKWebView 想真的透明，必须关掉它自己的底色。
        // 公开 API 没有这个开关，私有 selector 在近几版系统上叫 _setDrawsBackground:
        // （KVC 的 setValue(forKey:"drawsBackground") 会自动找到带下划线的那个）
        let selBg = NSSelectorFromString("_setDrawsBackground:")
        if web.responds(to: selBg) {
            web.setValue(false, forKey: "drawsBackground")
            log("build · _setDrawsBackground(false) 已调用")
        } else {
            log("build · 找不到 _setDrawsBackground:，只能靠 underPageBackgroundColor")
        }
        // 让 WKWebView 自身不打底色（公开 API，避免私有 KVC 抛异常）
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        web.enclosingScrollView?.drawsBackground = false
        log("build · 5 webview created")
        panel.contentView = web

        guard let url = Bundle.main.url(forResource: "pet", withExtension: "html", subdirectory: "web") else {
            NSLog("找不到 web/pet.html，检查 app 包结构")
            return
        }
        log("build · 6 loading \(url.path)")
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())

        panel.orderFrontRegardless()
        web.navigationDelegate = self
        log("panel · frame=\(NSStringFromRect(panel.frame)) level=\(panel.level.rawValue) opaque=\(panel.isOpaque) bgAlpha=\(panel.backgroundColor.alphaComponent)")
    }

    // MARK: 页面加载完成

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        log("web · didFinish \(web.url?.lastPathComponent ?? "nil")")
        // 等一帧再问页面自己的状态
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self = self else { return }
            self.web.evaluateJavaScript("""
            JSON.stringify({
              pet: !!window.desktopPet,
              ready: window.desktopPet && window.desktopPet.ready,
              mode: window.desktopPet && window.desktopPet.mode,
              w: window.desktopPet && window.desktopPet.w,
              bridge: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pet),
              hit: (function(){ var r = window.desktopPet && window.desktopPet.hit.getBoundingClientRect();
                     return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; })()
            })
            """) { r, e in
                self.log("page · \(r ?? e?.localizedDescription ?? "nil")")
                self.log("hitArea · \(NSStringFromRect(self.hitArea))")
                self.log("alpha · web.isOpaque=\(self.web.isOpaque) webLayerAlpha=\(self.web.layer?.backgroundColor?.alpha ?? -1) panelAlpha=\(self.panel.backgroundColor.alphaComponent) panelOpaque=\(self.panel.isOpaque)")
                self.web.evaluateJavaScript("JSON.stringify({html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor})") { r, _ in
                    self.log("alpha · 页面背景 \(r ?? "nil")")
                    self.captureOwnWindow()
                }

                if CommandLine.arguments.contains("--dragtest") { self.dragTest() }
                if CommandLine.arguments.contains("--dashtest") { self.dashTest() }
                if CommandLine.arguments.contains("--probe") { self.probeGaze() }
                if CommandLine.arguments.contains("--hidetest") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                        self.hidePet(reason: "自检")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                            self.log("hidetest · 现在再开一次 App（或按 ⌃⌥⌘L / 点 Dock）看会不会回来")
                            // 顺手验证一下热键的处理函数（不经由系统事件）
                            self.hotKeyPressed()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                                self.log("hidetest · 热键后 visible=\(self.panel.isVisible)")
                            }
                        }
                    }
                }
                if CommandLine.arguments.contains("--dashshot") {
                    self.showDashboard()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                        let cfg = WKSnapshotConfiguration()
                        cfg.rect = CGRect(origin: .zero, size: self.dashSize)
                        self.dashWeb?.takeSnapshot(with: cfg) { image, err in
                            if let image = image, let tiff = image.tiffRepresentation,
                               let rep = NSBitmapImageRep(data: tiff),
                               let png = rep.representation(using: .png, properties: [:]) {
                                try? png.write(to: URL(fileURLWithPath: "/tmp/lele-dash.png"))
                                self.log("dashshot · /tmp/lele-dash.png \(Int(rep.size.width))x\(Int(rep.size.height))")
                            } else {
                                self.log("dashshot · 失败 \(err?.localizedDescription ?? "nil")")
                            }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { exit(0) }
                        }
                    }
                }

                if CommandLine.arguments.contains("--shot") {
                    // 让 WKWebView 自己截一张（不需要屏幕录制权限）
                    let cfg = WKSnapshotConfiguration()
                    cfg.rect = CGRect(origin: .zero, size: self.panel.frame.size)
                    self.web.takeSnapshot(with: cfg) { image, error in
                        if let image = image,
                           let tiff = image.tiffRepresentation,
                           let rep = NSBitmapImageRep(data: tiff),
                           let png = rep.representation(using: .png, properties: [:]) {
                            try? png.write(to: URL(fileURLWithPath: "/tmp/lele-shot.png"))
                            self.log("shot · 已保存 /tmp/lele-shot.png  \(Int(rep.size.width))x\(Int(rep.size.height))")
                        } else {
                            self.log("shot · 失败 \(error?.localizedDescription ?? "nil")")
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { exit(0) }
                    }
                }
                if CommandLine.arguments.contains("--selftest") {
                    self.log("selftest · done, quitting")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log("web · didFail \(error.localizedDescription)")
    }

    /// 窗口大小：正好包住「留白 + 角色 + 影子的余量 + 气泡的头顶空间」
    private func windowSize(for petW: CGFloat) -> NSSize {
        let h = petW * 792.0 / 811.0
        let w = petW * 1.4 + 20            // 左右各留 20% 留白 + 10px 余量
        let hh = h * 1.48 + 34 + 92        // 上下留白 + 影子 + 气泡
        return NSSize(width: round(w), height: round(hh))
    }

    /// 点到别的地方就把仪表盘收起来（像菜单一样）
    func windowDidResignKey(_ notification: Notification) {
        if let w = notification.object as? NSWindow, w === dashPanel {
            hideDashboard()
        }
    }

    // MARK: 仪表盘

    private let dashSize = NSSize(width: 340, height: 468)

    private func buildDashboard() {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "dash")

        let p = DashPanel(contentRect: NSRect(origin: .zero, size: dashSize),
                         styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        p.level = .floating
        p.hidesOnDeactivate = false
        p.isMovable = true
        p.isMovableByWindowBackground = false
        p.isReleasedWhenClosed = false
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.delegate = self

        let w = WKWebView(frame: NSRect(origin: .zero, size: dashSize), configuration: cfg)
        w.autoresizingMask = [.width, .height]
        w.wantsLayer = true
        w.layer?.backgroundColor = NSColor.clear.cgColor
        if w.responds(to: NSSelectorFromString("_setDrawsBackground:")) {
            w.setValue(false, forKey: "drawsBackground")
        }
        if #available(macOS 12.0, *) { w.underPageBackgroundColor = .clear }
        p.contentView = w

        if let url = Bundle.main.url(forResource: "dashboard", withExtension: "html", subdirectory: "web") {
            w.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            log("dashboard · 找不到 web/dashboard.html")
        }

        dashPanel = p
        dashWeb = w
        log("dashboard · built")
    }

    private func positionDashboard() {
        guard let d = dashPanel else { return }
        let pf = panel.frame
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)

        var x = pf.minX - dashSize.width + 40          // 默认贴在桌宠左边
        if x < screen.minX + 8 { x = min(pf.maxX - 40, screen.maxX - dashSize.width - 8) }
        if x + dashSize.width > screen.maxX - 8 { x = screen.maxX - dashSize.width - 8 }

        var y = pf.minY + 60
        y = min(max(y, screen.minY + 8), screen.maxY - dashSize.height - 8)

        d.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func showDashboard() {
        if dashPanel == nil { buildDashboard() }
        positionDashboard()
        dashPanel?.makeKeyAndOrderFront(nil)
        pushDashState()
        log("dashboard · shown")
    }

    private func hideDashboard() {
        dashPanel?.orderOut(nil)
    }

    private func toggleDashboard() {
        if let d = dashPanel, d.isVisible { hideDashboard() } else { showDashboard() }
    }

    /// 把桌宠的当前状态回灌到仪表盘
    private func pushDashState() {
        guard let d = dashWeb, let p = dashPanel, p.isVisible else { return }
        let js = """
        JSON.stringify({
          state: desktopPet.state,
          said: desktopPet.bubbleEl && desktopPet.bubbleEl.classList.contains('lele-on')
                  ? desktopPet.bubbleEl.textContent : '',
          size: desktopPet.w,
          sound: !\(muted),
          roam: \(roamEnabled),
          top: \(alwaysOnTop)
        })
        """
        web.evaluateJavaScript(js) { result, _ in
            guard let json = result as? String else { return }
            d.evaluateJavaScript("window.dashUpdate && window.dashUpdate(\(json))", completionHandler: nil)
        }
    }

    // MARK: 仪表盘发来的指令

    private func handleDash(_ body: [String: Any]) {
        let action = body["action"] as? String ?? ""
        let value = (body["value"] as? NSNumber)?.doubleValue

        switch action {
        case "pat":   web.evaluateJavaScript("desktopPet.pat(true)", completionHandler: nil)
        case "hop":   web.evaluateJavaScript("desktopPet.hop()", completionHandler: nil)
        case "spin":  web.evaluateJavaScript("desktopPet.spin()", completionHandler: nil)
        case "sleep": web.evaluateJavaScript("desktopPet.sleep()", completionHandler: nil)
        case "say":
            let lines = ["今天也要开心呀", "我在桌面上陪你", "记得喝水", "写代码辛苦了",
                         "别熬夜太晚", "要不要摸摸我"]
            let t = lines.randomElement() ?? "喵"
            web.evaluateJavaScript("desktopPet.say(\(jsString(t)))", completionHandler: nil)
        case "home":
            goHome()
        case "size":
            if let v = value { setPetSize(CGFloat(v)) }
        case "sound":
            muted = !(body["value"] as? Bool ?? true)
            web.evaluateJavaScript("desktopPet.setVolume(\(muted ? 0 : 0.25))", completionHandler: nil)
        case "roam":
            roamEnabled = body["value"] as? Bool ?? false
            if !roamEnabled { roamTargetX = nil }
            log("dash · roam=\(roamEnabled)")
        case "top":
            alwaysOnTop = body["value"] as? Bool ?? true
            panel.level = alwaysOnTop ? .floating : .normal
            rebuildMenu()
        case "reload": web.reload()
        case "hide":
            hidePet(reason: "仪表盘点藏起来")
        case "close": hideDashboard()
        case "quit": NSApp.terminate(nil)
        default: break
        }

        // 操作完把最新状态推回去，仪表盘上的开关和数字才是真的
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.pushDashState() }
    }

    private func goHome() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = panel.frame.size
        let target = NSPoint(x: screen.maxX - size.width - 40, y: screen.minY + 24)
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.45
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrameOrigin(target)
        }
        saveOrigin()
        web.evaluateJavaScript("desktopPet.say('回来啦')", completionHandler: nil)
    }

    // MARK: 散步：让窗口自己在屏幕上溜达

    private func startRoam() {
        roamTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            guard self.roamEnabled, !self.dragging, self.panel.isVisible else { return }
            if let d = self.dashPanel, d.isVisible { return }      // 打开面板时别乱跑

            let f = self.panel.frame
            let screen = NSScreen.main?.visibleFrame ?? .zero

            if let target = self.roamTargetX {
                let dx = target - f.minX
                if abs(dx) < 2 {
                    self.roamTargetX = nil
                    return
                }
                let dir: CGFloat = dx > 0 ? 1 : -1
                let step = dir * min(abs(dx), 80 * 0.05)
                let nx = min(max(f.minX + step, screen.minX), screen.maxX - f.width)
                self.panel.setFrameOrigin(NSPoint(x: nx, y: f.minY))
                if dir != self.roamDir {
                    self.roamDir = dir
                    self.web.evaluateJavaScript("desktopPet.face(\(dir > 0 ? 1 : -1))", completionHandler: nil)
                }
            } else if Double.random(in: 0..<1) < 0.004 {          // 平均 12 秒挑一次新目标
                self.roamTargetX = CGFloat.random(in: screen.minX...(screen.maxX - f.width))
            }
        }
    }

    // MARK: 位置记忆

    private func restoredOrigin(for size: NSSize) -> NSPoint {
        if let s = UserDefaults.standard.string(forKey: "petOrigin") {
            var p = NSPointFromString(s)
            p = clamp(p, size: size)
            // 屏幕拔掉了就别跑到屏幕外
            if NSScreen.screens.contains(where: { $0.frame.contains(p) }) { return p }
        }
        let f = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSPoint(x: f.maxX - size.width - 40, y: f.minY + 24)
    }

    private func saveOrigin() {
        UserDefaults.standard.set(NSStringFromPoint(panel.frame.origin), forKey: "petOrigin")
    }

    private func clamp(_ p: NSPoint, size: NSSize) -> NSPoint {
        guard let f = NSScreen.main?.visibleFrame else { return p }
        return NSPoint(
            x: min(max(p.x, f.minX - size.width * 0.3), f.maxX - size.width * 0.7),
            y: min(max(p.y, f.minY - size.height * 0.2), f.maxY - size.height * 0.6)
        )
    }

    // MARK: 尺寸

    private func applySize(_ index: Int) {
        let i = max(0, min(sizes.count - 1, index))
        petSizeIndex = i
        setPetSize(sizes[i])
    }

    /// 菜单和仪表盘共用：设定桌宠宽度 → 同步窗口大小
    private func setPetSize(_ px: CGFloat) {
        petWidth = min(max(px, 120), 340)
        if let i = sizes.firstIndex(where: { abs($0 - petWidth) < 0.5 }) { petSizeIndex = i }

        // 让窗口左下角保持不动地变大变小，看起来更自然
        let old = panel.frame
        let size = windowSize(for: petWidth)
        var origin = NSPoint(x: old.midX - size.width / 2, y: old.minY)
        origin = clamp(origin, size: size)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)

        web.evaluateJavaScript("desktopPet.setSize(\(Int(petWidth)))", completionHandler: nil)
        saveOrigin()
        rebuildMenu()
    }

    // MARK: 菜单栏

    private func buildMenu() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "🐱"
        status.button?.toolTip = "乐乐桌宠"
        rebuildMenu()
        // 诊断：菜单栏图标到底有没有、多宽、在不在窗口里
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            let b = self.status.button
            self.log("status · thickness=\(NSStatusBar.system.thickness) isVisible=\(self.status.isVisible) " +
                     "len=\(self.status.length) width=\(b?.frame.width ?? -1) " +
                     "title=\(b?.title ?? "nil") window=\(b?.window != nil) " +
                     "screen=\(NSScreen.main?.frame.width ?? 0)x\(NSScreen.main?.frame.height ?? 0) " +
                     "notch=\(NSScreen.main?.safeAreaInsets.top ?? 0)")
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()

        let dash = NSMenuItem(title: "打开仪表盘…", action: #selector(openDashboardItem), keyEquivalent: "d")
        dash.target = self
        menu.addItem(dash)

        let toggle = NSMenuItem(title: panel.isVisible ? "藏起来" : "叫出来",
                                action: #selector(toggleVisible), keyEquivalent: "h")
        toggle.target = self
        menu.addItem(toggle)

        let sizeItem = NSMenuItem(title: "大小", action: nil, keyEquivalent: "")
        let sizeMenu = NSMenu()
        let names = ["小", "中", "大", "超大"]
        for (i, n) in names.enumerated() {
            let it = NSMenuItem(title: n, action: #selector(changeSize(_:)), keyEquivalent: "")
            it.target = self
            it.tag = i
            it.state = (i == petSizeIndex) ? .on : .off
            sizeMenu.addItem(it)
        }
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)

        let top = NSMenuItem(title: "总在最前", action: #selector(toggleTop), keyEquivalent: "t")
        top.target = self
        top.state = alwaysOnTop ? .on : .off
        menu.addItem(top)

        let mute = NSMenuItem(title: "静音", action: #selector(toggleMute), keyEquivalent: "m")
        mute.target = self
        mute.state = muted ? .on : .off
        menu.addItem(mute)

        menu.addItem(NSMenuItem.separator())

        let say = NSMenuItem(title: "让它说句话", action: #selector(randomLine), keyEquivalent: "s")
        say.target = self
        menu.addItem(say)

        let reload = NSMenuItem(title: "重新加载", action: #selector(reloadWeb), keyEquivalent: "r")
        reload.target = self
        menu.addItem(reload)

        menu.addItem(NSMenuItem.separator())

        let quit = NSMenuItem(title: "退出乐乐", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        status.menu = menu
    }

    @objc private func openDashboardItem() {
        panel.orderFrontRegardless()
        showDashboard()
    }

    /// 藏起来时把 Dock 图标亮出来：菜单栏图标在带刘海的屏上可能被系统挤掉，
    /// Dock 是不会被挤掉的，点它就回来了。
    private func setDockVisible(_ on: Bool) {
        let target: NSApplication.ActivationPolicy = on ? .regular : .accessory
        guard NSApp.activationPolicy() != target else { return }
        NSApp.setActivationPolicy(target)
        if on { NSApp.activate(ignoringOtherApps: true) }
        log("dock · policy=\(on ? "regular(显示图标)" : "accessory(隐藏图标)")")
    }

    /// 把猫叫回桌面（菜单栏、热键、Dock、重新打开 App 都走这里）
    private func showPet() {
        guard let panel = panel else { return }
        if !panel.isVisible { panel.orderFrontRegardless() }
        panel.ignoresMouseEvents = false
        setDockVisible(false)
        rebuildMenu()
        log("pet · shown")
    }

    private func hidePet(reason: String) {
        panel.orderOut(nil)
        hideDashboard()
        setDockVisible(true)
        rebuildMenu()
        log("pet · hidden（\(reason)）")
        Hint.show("乐乐藏起来了\n点 Dock 里的猫叫回来，或点菜单栏 🐱（⌃⌥⌘L 也行）")
    }

    /// ⌃⌥⌘L：不依赖菜单栏、也不依赖 Dock 的兜底
    func hotKeyPressed() {
        log("hotkey · ⌃⌥⌘L")
        if panel != nil && panel.isVisible { hidePet(reason: "热键") } else { showPet() }
    }

    private func installHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, userData) -> OSStatus in
            guard let userData = userData else { return noErr }
            Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue().hotKeyPressed()
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &hotKeyHandler)

        let id = EventHotKeyID(signature: OSType(0x4C454C45), id: 1)   // 'LELE'
        let st = RegisterEventHotKey(UInt32(kVK_ANSI_L),
                                     UInt32(cmdKey | optionKey | controlKey),
                                     id, GetApplicationEventTarget(), 0, &hotKeyRef)
        log("hotkey · ⌃⌥⌘L register=\(st == noErr ? "ok" : "失败(\(st))")")
    }

    @objc private func toggleVisible() {
        if panel.isVisible { hidePet(reason: "菜单栏") } else { showPet() }
    }

    @objc private func changeSize(_ sender: NSMenuItem) { applySize(sender.tag) }

    @objc private func toggleTop() {
        alwaysOnTop.toggle()
        panel.level = alwaysOnTop ? .floating : .normal
        rebuildMenu()
    }

    @objc private func toggleMute() {
        muted.toggle()
        web.evaluateJavaScript("desktopPet.setVolume(\(muted ? 0 : 0.25))", completionHandler: nil)
        rebuildMenu()
    }

    @objc private func randomLine() {
        panel.orderFrontRegardless()
        let lines = ["今天也要开心呀", "我在桌面上陪你", "记得喝水", "写代码辛苦了", "别熬夜太晚"]
        let t = lines.randomElement() ?? "喵"
        web.evaluateJavaScript("desktopPet.say(\(jsString(t)))", completionHandler: nil)
    }

    @objc private func reloadWeb() { web.reload() }

    @objc private func quit() { NSApp.terminate(nil) }

    private func jsString(_ s: String) -> String {
        let escaped = s.replacingOccurrences(of: "\\", with: "\\\\")
                       .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    // MARK: 定时任务：视线 + 点穿

    private func startTimers() {
        // 20Hz：把真实鼠标位置喂给页面，鼠标不在窗口上它也会盯着你
        gazeTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self, self.panel.isVisible else { return }
            let m = NSEvent.mouseLocation                      // AppKit 屏幕坐标（左下原点）
            let top = NSScreen.screens.first?.frame.maxY ?? 0  // 转成 CSS 的左上原点
            let f = self.panel.frame
            // 四个数一起送：窗口左上角 + 鼠标。页面里减一下就得到窗口内坐标，
            // 不依赖 window.screenX（WKWebView 里那是坏值）
            let js = String(format: "window.petLookAt && window.petLookAt(%.1f, %.1f, %.1f, %.1f)",
                            f.minX, top - f.maxY, m.x, top - m.y)
            self.web.evaluateJavaScript(js) { _, err in
                if let err = err, self.gazeTicks == 1 {
                    self.log("gaze · error \(err.localizedDescription)")
                }
            }
            self.gazeTicks += 1
            if self.gazeTicks == 20 { log("gaze · 20 次视线推送完成（鼠标位置已送达页面）") }
        }

        // 30Hz：鼠标不在猫身上时让窗口「点穿」，不挡住下面的软件
        clickThruTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            guard self.panel.isVisible, !self.dragging, self.hitArea.width > 0 else { return }
            let f = self.panel.frame
            let m = NSEvent.mouseLocation
            let local = NSPoint(x: m.x - f.minX, y: f.maxY - m.y)   // 窗口坐标，左上原点
            let inside = self.hitArea.insetBy(dx: -6, dy: -6).contains(local)
            if self.panel.ignoresMouseEvents == inside {
                self.panel.ignoresMouseEvents = !inside
            }
        }
    }

    // MARK: 页面 → 原生

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }

        if message.name == "dash" {
            if let cmd = body["cmd"] as? String, cmd == "dash" {
                handleDash(body)
            } else if (body["cmd"] as? String) == "dashReady" {
                pushDashState()
            }
            return
        }

        guard let cmd = body["cmd"] as? String else { return }
        let x = (body["x"] as? NSNumber)?.doubleValue ?? 0
        let y = (body["y"] as? NSNumber)?.doubleValue ?? 0

        switch cmd {
        case "dragStart":
            log("msg · dragStart \(x),\(y)")
            dragging = true
            dragStartScreen = NSPoint(x: x, y: y)
            dragStartOrigin = panel.frame.origin
            panel.ignoresMouseEvents = false
        log("build · 3 panel created")

        case "dragMove":
            guard dragging,
                  let s = dragStartScreen,
                  let o = dragStartOrigin else { return }
            // 页面给的是「左上原点」的屏幕坐标，这里换成窗口位移直接加
            let dx = x - s.x
            let dy = s.y - y                       // y 轴方向相反
            let size = panel.frame.size
            var p = NSPoint(x: o.x + dx, y: o.y + dy)
            p = clamp(p, size: size)
            panel.setFrameOrigin(p)

        case "dragEnd":
            dragging = false
            dragStartScreen = nil
            dragStartOrigin = nil
            saveOrigin()

        case "said":
            pushDashState()

        case "hitArea":
            log("msg · hitArea \(x),\(y) \((body["w"] as? NSNumber)?.doubleValue ?? 0)x\((body["h"] as? NSNumber)?.doubleValue ?? 0)")
            hitArea = NSRect(x: x, y: y,
                             width: (body["w"] as? NSNumber)?.doubleValue ?? 0,
                             height: (body["h"] as? NSNumber)?.doubleValue ?? 0)

        case "menu":
            // 右键桌宠：打开仪表盘（原来是弹系统菜单，功能太少）
            showDashboard()

        case "hide":
            hidePet(reason: "右键菜单")

        default:
            break
        }
    }

    /// 把窗口内容渲染成图（用于确认「有没有白底」）
    private func captureOwnWindow() {
        guard let v = panel.contentView,
              let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else {
            log("capture · 无法创建位图")
            return
        }
        v.cacheDisplay(in: v.bounds, to: rep)
        if let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: "/tmp/lele-window.png"))
            // 顺便算一下四角的 alpha：0 = 透明
            var alphaInfo: [String] = []
            for (nx, ny) in [(0.02, 0.02), (0.98, 0.02), (0.02, 0.98), (0.5, 0.5)] {
                let x = min(rep.pixelsWide - 1, Int(Double(rep.pixelsWide) * nx))
                let y = min(rep.pixelsHigh - 1, Int(Double(rep.pixelsHigh) * ny))
                let c = rep.colorAt(x: x, y: y)
                alphaInfo.append(String(format: "a=%.2f", c?.alphaComponent ?? -1))
            }
            log("capture · /tmp/lele-window.png \(rep.pixelsWide)x\(rep.pixelsHigh)  角点 \(alphaInfo.joined(separator: " "))")
        }
        if CommandLine.arguments.contains("--shot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { exit(0) }
        }
    }

    /// 真实鼠标 → 视线 的端到端测试：把指针挪到窗口的四边，看眼睛朝哪
    private func probeGaze() {
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        let f = panel.frame
        let winLeft = f.minX
        let winTop = top - f.maxY

        log("probe · 窗口=\(NSStringFromRect(f))  CSS 左上=(\(Int(winLeft)), \(Int(winTop)))")

        // 四个方向：左 / 右 / 上 / 下（都相对窗口中心）
        let cx = f.midX, cy = f.midY
        let cases: [(String, CGFloat, CGFloat, String)] = [
            ("指针在左边", f.minX + 20, cy, "gaze.x 应为负"),
            ("指针在右边", f.maxX - 20, cy, "gaze.x 应为正"),
            ("指针在上边", cx, f.maxY - 12, "gaze.y 应为负"),
            ("指针在下边", cx, f.minY + 12, "gaze.y 应为正")
        ]

        func warp(_ x: CGFloat, _ y: CGFloat) {
            CGWarpMouseCursorPosition(CGPoint(x: x, y: top - y))
        }

        var index = 0
        func next() {
            guard index < cases.count else {
                log("probe · 完成")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { exit(0) }
                return
            }
            let c = cases[index]
            index += 1
            warp(c.1, c.2)

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) {
                self.web.evaluateJavaScript("JSON.stringify({x: +desktopPet.gaze.x.toFixed(1), y: +desktopPet.gaze.y.toFixed(1)})") { r, _ in
                    self.log("probe · \(c.0)：\(r ?? "nil")   \(c.3)")
                    next()
                }
            }
        }
        next()
    }

    /// 端到端仪表盘测试：在面板里真的点按钮 / 拖滑块，看桌宠有没有反应
    private func dashTest() {
        // ① 先验证「右键桌宠」这条路：在页面里合成 contextmenu，外壳应该弹出仪表盘
        web.evaluateJavaScript("document.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:12, clientY:12}))", completionHandler: nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            self.log("dashtest · 右键后仪表盘可见=\(self.dashPanel?.isVisible ?? false)  \((self.dashPanel?.isVisible ?? false) ? "✓ 通过" : "✗ 没弹出来")")
            self.showDashboard()

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            // ① 在面板里点「摸摸头」
            self.dashWeb?.evaluateJavaScript("document.querySelector('[data-a=pat]').click()") { _, e in
                self.log("dashtest · 点击摸摸头 \(e?.localizedDescription ?? "ok")")
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                // ② 桌宠应该进入「开心 + 脸红」
                self.web.evaluateJavaScript("JSON.stringify({emote: desktopPet.emote && desktopPet.emote.name, blush: +desktopPet.blush.toFixed(2), said: desktopPet.bubbleEl.textContent})") { r, _ in
                    self.log("dashtest · 桌宠反应 \(r ?? "nil")")

                    // ③ 面板上应该显示同一句台词
                    self.dashWeb?.evaluateJavaScript("JSON.stringify({st: document.getElementById('st').textContent, said: document.getElementById('said').textContent})") { r2, _ in
                        self.log("dashtest · 面板显示 \(r2 ?? "nil")")

                        // ④ 拖滑块改大小
                        self.dashWeb?.evaluateJavaScript("var s=document.getElementById('size'); s.value=260; s.dispatchEvent(new Event('change'));") { _, _ in }

                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                            let expect = self.windowSize(for: 260)
                            let actual = self.panel.frame
                            let ok = abs(actual.width - expect.width) < 4
                            self.log("dashtest · 改大小 → 窗口 \(Int(actual.width))×\(Int(actual.height))  期望宽 \(Int(expect.width))  \(ok ? "✓ 通过" : "✗ 不符")")

                            // ⑤ 开关：散步
                            self.dashWeb?.evaluateJavaScript("var r=document.getElementById('roam'); r.checked=true; r.dispatchEvent(new Event('change'));") { _, _ in }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                self.log("dashtest · 散步开关 → roamEnabled=\(self.roamEnabled)")
                                    self.log("dashtest · 完成")
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { exit(0) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// 端到端拖拽测试：在页面里合成 pointer 事件，走完 JS → 桥 → 移动窗口
    private func dragTest() {
        let before = panel.frame.origin
        log("dragtest · 起点 \(NSStringFromPoint(before))")

        let js = """
        (function () {
          var hit = window.desktopPet.hit;
          var r = hit.getBoundingClientRect();
          var x = r.left + r.width / 2, y = r.top + r.height / 2;
          var sx = window.screenX + x, sy = window.screenY + y;
          function ev(t, cx, cy, scx, scy) {
            hit.dispatchEvent(new PointerEvent(t, {
              bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
              clientX: cx, clientY: cy, screenX: scx, screenY: scy,
              pointerType: 'mouse', buttons: 1
            }));
          }
          ev('pointerdown', x, y, sx, sy);
          for (var i = 1; i <= 5; i++) ev('pointermove', x + i * 8, y + i * 8, sx + i * 8, sy + i * 8);
          ev('pointerup', x + 40, y + 40, sx + 40, sy + 40);
          return 'dispatched';
        })()
        """
        web.evaluateJavaScript(js) { r, e in
            self.log("dragtest · 事件派发 \(r ?? e?.localizedDescription ?? "nil")")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                let after = self.panel.frame.origin
                let dx = after.x - before.x
                let dy = after.y - before.y
                // 拖拽要超过 7px 阈值才开始，基准点是「第一次 move」= +8，
                // 所以总位移是 5*8 - 8 = 32（x 往右、y 往下 → AppKit 的 y 朝上，所以 -32）
                let ok = abs(dx - 32) < 3 && abs(dy + 32) < 3
                self.log("dragtest · 终点 \(NSStringFromPoint(after))  位移=(\(Int(dx)), \(Int(dy)))  期望=(32, -32)  \(ok ? "✓ 通过" : "✗ 不符")")
                if CommandLine.arguments.contains("--selftest") { exit(0) }
            }
        }
    }

    // MARK: 自检（不依赖肉眼）

    private func selftest() {
        // 硬超时：不管发生什么，3 秒后一定退出，别把调用方卡住
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { exit(0) }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            var lines: [String] = []
            lines.append("=== 乐乐桌宠 自检 ===")
            lines.append("activationPolicy : \(NSApp.activationPolicy().rawValue)  (1 = accessory，不占 Dock)")
            lines.append("window visible   : \(self.panel.isVisible)")
            lines.append("window frame     : \(NSStringFromRect(self.panel.frame))")
            lines.append("window level     : \(self.panel.level.rawValue)  (\(self.panel.level == .floating ? "floating 置顶" : "normal"))")
            lines.append("isOpaque         : \(self.panel.isOpaque)")
            lines.append("hasShadow        : \(self.panel.hasShadow)")
            lines.append("backgroundAlpha  : \(self.panel.backgroundColor.alphaComponent)")
            lines.append("hitArea          : \(NSStringFromRect(self.hitArea))")
            lines.append("webView file     : \(self.web.url?.lastPathComponent ?? "nil")")
            print(lines.joined(separator: "\n"))
            fflush(stdout)

            self.web.evaluateJavaScript("JSON.stringify({pet: !!window.desktopPet, ready: window.desktopPet && window.desktopPet.ready, mode: window.desktopPet && window.desktopPet.mode, w: window.desktopPet && window.desktopPet.w, hit: (function(){var r=window.desktopPet&&window.desktopPet.hit.getBoundingClientRect();return r?[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]:null})()})") { r, e in
                print("page state       : \(r ?? e?.localizedDescription ?? "nil")")
                print("======================")
                fflush(stdout)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { exit(0) }
            }
        }
    }
}

// MARK: - 入口

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()

/* ────────────────────────────────────────────────────────────────
   Hint —— 藏起来之后在屏幕上方弹一个几秒钟的小提示。
   为什么需要它：一旦猫被藏起来，屏幕上就没有任何「乐乐」的痕迹了，
   用户很容易以为程序退出了。提示里写明两个回来的入口。
   ──────────────────────────────────────────────────────────────── */
enum Hint {
    private static var panel: NSPanel?

    static func show(_ text: String, seconds: Double = 4.0) {
        DispatchQueue.main.async {
            panel?.orderOut(nil)

            let label = NSTextField(labelWithString: text)
            label.font = .systemFont(ofSize: 12.5, weight: .medium)
            label.textColor = .white
            label.alignment = .center
            label.maximumNumberOfLines = 2
            label.lineBreakMode = .byWordWrapping
            label.sizeToFit()

            let padX: CGFloat = 16, padY: CGFloat = 11
            let w = min(max(label.frame.width + padX * 2, 180), 330)
            let h = max(label.frame.height + padY * 2, 40)

            let bg = NSView(frame: NSRect(x: 0, y: 0, width: w, height: h))
            bg.wantsLayer = true
            bg.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 0.92).cgColor
            bg.layer?.cornerRadius = 11
            bg.layer?.masksToBounds = true

            label.frame = NSRect(x: padX, y: padY, width: w - padX * 2, height: label.frame.height)
            bg.addSubview(label)

            let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: w, height: h),
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
            p.isOpaque = false
            p.backgroundColor = .clear
            p.hasShadow = true
            p.level = .statusBar
            p.ignoresMouseEvents = true
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
            p.contentView = bg

            if let screen = NSScreen.main {
                let f = screen.visibleFrame
                p.setFrameOrigin(NSPoint(x: f.midX - w / 2, y: f.maxY - h - 6))
            }
            p.alphaValue = 0
            p.orderFrontRegardless()
            if let fh = FileHandle(forWritingAtPath: "/tmp/lele-pet-desktop.log") {
                fh.seekToEndOfFile()
                fh.write("hint · shown \(Int(w))x\(Int(h))\n".data(using: .utf8)!)
                fh.closeFile()
            }
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.18
                p.animator().alphaValue = 1
            }, completionHandler: {
                DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
                    NSAnimationContext.runAnimationGroup({ ctx in
                        ctx.duration = 0.45
                        p.animator().alphaValue = 0
                    }, completionHandler: { p.orderOut(nil) })
                }
            })

            panel = p
        }
    }
}
