#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-sprites.py — 本项目专用的一键构建（乐乐这张图）

真正的拆图逻辑在 tools/split-sprite.py（通用脚本，换成别的猫也能用）。
这里只是把「乐乐」这组参数钉死，保证素材随时可复现：

  python3 tools/build-sprites.py

产出（都在 assets/）：
  lele.png / lele-skin.png / lele-eye-l.png / lele-eye-r.png
  lele-sprite.json   尺寸与眼睛几何（要抄进 assets/lele-pet.js 顶部常量）
  lele-fallback.jpg  原图，素材加载失败时的兜底立绘
  （外面还会更新 preview.png 对照图）

参数怎么来的：
  · 背景色 228.5,229,236 是四条边像素的中位数（通用脚本自己也能估）
  · 种子点 540,700 = 鼻头，保证灌水灌的是猫，而不是左上角那个气泡
  · 眼睛坐标是先用 `split-sprite.py --grid` 出一张带网格的图，照着眼球中心读的
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")

SRC = os.path.join(ASSETS, "lele-original.jpg")
ARGS = [
    "--src", SRC,
    "--out", ASSETS,
    "--name", "lele",
    "--bg", "228.5,229,236",
    "--tol", "22",
    "--seed", "540,700",           # 鼻头
    "--eye-l", "424,581,74,68",    # 左眼 cx,cy,rx,ry（原图坐标）
    "--eye-r", "781,595,64,62",    # 右眼
    "--eye-margin", "30",
]


def main():
    cmd = [sys.executable, os.path.join(HERE, "split-sprite.py")] + ARGS
    r = subprocess.run(cmd)
    if r.returncode:
        raise SystemExit(r.returncode)

    shutil.move(os.path.join(ASSETS, "lele.json"), os.path.join(ASSETS, "lele-sprite.json"))
    shutil.copyfile(SRC, os.path.join(ASSETS, "lele-fallback.jpg"))

    for n in ("lele.png", "lele-skin.png", "lele-eye-l.png", "lele-eye-r.png", "lele-sprite.json"):
        p = os.path.join(ASSETS, n)
        print(f"  {n:20s} {os.path.getsize(p) / 1024:7.1f} KB")


if __name__ == "__main__":
    main()
