// preload.js — 把 macOS 版用的 window.webkit.messageHandlers 桥接到 IPC
//
// 这样 desktop/macos/pet.html 和 dashboard.html **一行都不用改**：
// 它们调用的 postMessage 在这里被转成 ipcRenderer.send。
//
// 反方向（外壳 → 页面）走 webContents.executeJavaScript，
// 因为开了 contextIsolation 之后 preload 里的 window 不是页面那个 window。
const { contextBridge, ipcRenderer } = require('electron');

const chan = (name) => ({
  postMessage: (msg) => {
    try { ipcRenderer.send(name, msg); } catch (e) { /* 忽略 */ }
  },
});

// 外壳 → 页面：注册一个命令回调（页面拿到后自己处理 size/say/volume/look…）
// 为什么不用 executeJavaScript：在 Electron 里那东西在某些状态下会一直挂着不 resolve，
// 结果就是「窗口改了、猫没改」。用 IPC 推过去没有这个问题。
contextBridge.exposeInMainWorld('leleMain', {
  onDash: (fn) => {
    ipcRenderer.on('dash-state', (_e, json) => {
      try { fn(json); } catch (err) { /* 忽略 */ }
    });
  },
  onCmd: (fn) => {
    ipcRenderer.on('cmd', (_e, m) => {
      try { fn(m); } catch (err) { /* 页面自己抛的，不影响壳 */ }
    });
  },
});

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    pet: chan('pet'),
    dash: chan('dash'),
  },
});
