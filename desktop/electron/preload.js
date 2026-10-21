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

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    pet: chan('pet'),
    dash: chan('dash'),
  },
});
