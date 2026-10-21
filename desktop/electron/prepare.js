// prepare.js — 把 macos/ 里那两个页面和素材拷进 web/（构建产物，不入库）
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const MACOS = path.join(HERE, '..', 'macos');
const WEB = path.join(HERE, 'web');
const ASSETS = path.join(WEB, 'assets');

fs.rmSync(WEB, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

for (const f of ['pet.html', 'dashboard.html']) {
  fs.copyFileSync(path.join(MACOS, f), path.join(WEB, f));
}
// 和 mac 版共用同一份素材（项目根 assets/）
const ROOT_ASSETS = path.join(HERE, '..', '..', 'assets');
for (const f of ['lele-pet.js', 'lele-skin.png', 'lele-eye-l.png', 'lele-eye-r.png',
                 'lele.png', 'lele-fallback.jpg']) {
  fs.copyFileSync(path.join(ROOT_ASSETS, f), path.join(ASSETS, f));
}
console.log('✓ web/ 已准备：' + fs.readdirSync(WEB).join(', '));
