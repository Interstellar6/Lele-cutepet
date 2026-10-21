#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split-sprite.py — 把一张「角色 + 纯色背景」的静态图，拆成可以做桌宠的分层素材。

它做两件事（这就是让静态图活起来的关键）：
  1. 抠背景：从四边灌水，把连通的背景变透明，边缘按颜色距离做软过渡；
  2. 拆眼睛：把眼睛所在的椭圆区域抹平成一块毛（底层「皮」），
     同时把原来的眼睛剪成独立贴片。之后「眨眼」= 把贴片纵向压扁，
     「看人」= 把贴片平移，空出来的边缘由皮上的毛自然补上。

用法：
  # 最省事：什么都不给，先跑一次看看自动检测的眼睛对不对
  python3 split-sprite.py --src cat.jpg --out out/ --preview

  # 眼睛位置不对就手动指定（格式：中心x,中心y,半径x,半径y）
  python3 split-sprite.py --src cat.jpg --out out/ \
      --eye-l 424,581,74,68 --eye-r 781,595,64,62 \
      --seed 540,700 --bg 228,229,236 --tol 22 --preview

  # 眼睛坐标怎么量？加 --grid 会输出一张带坐标网格的图，照着眼中心读数即可
  python3 split-sprite.py --src cat.jpg --out out/ --grid

输出：
  <out>/pet.png        抠好的角色（RGBA）
  <out>/pet-skin.png   同尺寸的「皮」（眼睛被抹平）
  <out>/pet-eye-l.png  左眼贴片        ┐ 只有 --eye-l/--eye-r 都给了才生成
  <out>/pet-eye-r.png  右眼贴片        ┘
  <out>/pet.json       尺寸与眼睛几何（照抄进 JS）
  加 --preview 另外输出 preview.png：抠图 / 皮 / 三帧眨眼 的对照图

依赖：Pillow + numpy（Pillow 12 里 Image.fromarray 出来是只读图，
floodfill 会静默失败，所以下面凡是要原地改的都先 .copy()）
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


# ---------------------------------------------------------------- 形态学
def _pad(mask, r):
    return np.pad(mask, r, mode="constant", constant_values=False)


def dilate(mask, r):
    """方形结构元膨胀（r 次 4 邻域扩张）"""
    if r <= 0:
        return mask.copy()
    m = _pad(mask, r)
    out = m.copy()
    for _ in range(r):
        out = (out | np.roll(out, 1, 0) | np.roll(out, -1, 0)
               | np.roll(out, 1, 1) | np.roll(out, -1, 1))
    return out[r:-r, r:-r]


def erode(mask, r):
    return ~dilate(~mask, r)


def flood_from(mask, seed):
    """取连通域。用 PIL 的 floodfill，比纯 Python BFS 快很多，也不会跨边界回卷"""
    img = Image.fromarray((mask * 255).astype(np.uint8), "L").copy()  # copy 必需
    ImageDraw.floodfill(img, seed, 128, thresh=0)
    return np.asarray(img) == 128


# ---------------------------------------------------------------- 背景估计
def guess_bg(arr):
    """取四条边一圈像素的中位数当背景色（假设背景基本均匀）"""
    h, w, _ = arr.shape
    k = max(2, min(h, w) // 100)
    edge = np.concatenate([
        arr[:k].reshape(-1, 3), arr[-k:].reshape(-1, 3),
        arr[:, :k].reshape(-1, 3), arr[:, -k:].reshape(-1, 3)])
    return np.median(edge, axis=0)


# ---------------------------------------------------------------- 抠图
def cutout(arr, bg, tol, seed, grow_erode=6):
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    figure = dist > tol
    # 角色和旁边的杂物（对话气泡、贴纸）常常只差几像素细连接：
    # 先腐蚀把连接断开，从角色内部灌水，再膨胀回来取交集
    core = erode(figure, grow_erode)
    h, w = core.shape
    if not (0 <= seed[0] < w and 0 <= seed[1] < h):
        raise SystemExit(f"--seed {seed} 超出了处理区域 {w}x{h}："
                         "它应该是原图里角色身上的一个点（--crop 时也别给到裁掉的地方）")
    if not core[seed[1], seed[0]]:
        # 种子点落在被腐蚀掉的地方：就近找一个 core 里的点
        ys, xs = np.nonzero(core)
        if len(xs) == 0:
            raise SystemExit("腐蚀之后什么都不剩，把 --tol 调小一点")
        i = np.argmin((xs - seed[0]) ** 2 + (ys - seed[1]) ** 2)
        seed = (int(xs[i]), int(ys[i]))
        print(f"  ! 种子点被腐蚀掉了，自动挪到 {seed}")
    cat = dilate(flood_from(core, seed), grow_erode + 2) & figure

    # 软边：颜色离背景越近越透明，毛边/抗锯齿边才不会是硬锯齿
    soft = np.clip((dist - tol * 0.45) / (tol * 1.5), 0.0, 1.0)
    alpha = np.where(cat, soft, 0.0) * 255.0
    alpha = np.asarray(Image.fromarray(alpha.astype(np.uint8), "L")
                       .filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32)
    return alpha


# ---------------------------------------------------------------- 皮（抹平眼睛）
def inpaint(rgb, hole):
    """Jacobi 扩散补洞：只用洞外的像素，边界自然向内延伸"""
    a = np.asarray(rgb).astype(np.float32).copy()
    ys, xs = np.where(hole)
    y0, y1 = max(0, ys.min() - 3), min(a.shape[0], ys.max() + 4)
    x0, x1 = max(0, xs.min() - 3), min(a.shape[1], xs.max() + 4)
    sub, h = a[y0:y1, x0:x1], hole[y0:y1, x0:x1]
    known = ~h
    fill = sub.copy()
    fill[h] = sub[known].mean(axis=0) if known.any() else 255
    for _ in range(1500):
        nb = np.zeros_like(fill)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb += np.roll(fill, (dy, dx), (0, 1))
        avg = nb / 4.0
        new = np.where(h[..., None], avg, fill)
        new[known] = sub[known]
        if np.abs(new - fill).max() < 0.15:
            fill = new
            break
        fill = new
    sub[h] = fill[h]
    a[y0:y1, x0:x1] = sub
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def ellipse_mask(size, e, grow=0.0, blur=3.0):
    w, h = size
    m = Image.new("L", (w, h), 0)
    rx, ry = e[2] + grow, e[3] + grow
    ImageDraw.Draw(m).ellipse([e[0] - rx, e[1] - ry, e[0] + rx, e[1] + ry], fill=255)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(m).astype(np.float32) / 255.0


# ---------------------------------------------------------------- 辅助可视化
def save_grid(png_path, out_path, step=60):
    """在原图上画坐标网格，用来读眼睛中心坐标"""
    im = Image.open(png_path).convert("RGB")
    d = ImageDraw.Draw(im)
    w, h = im.size
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(255, 60, 120), width=1)
        d.text((x + 2, 4), str(x), fill=(200, 0, 60))
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(60, 160, 255), width=1)
        d.text((3, y + 2), str(y), fill=(0, 70, 200))
    im.save(out_path)
    print(f"  网格图：{out_path}（照着眼球中心读 x,y）")


def save_preview(cut, skin, eye_sprites, out_path):
    """对照图：抠图 | 皮 | 眼睛 100%/40%/10% 三档（看眨眼像不像）"""
    W, H = cut.size
    panels = []

    def checker(w, h, s=18):
        ys, xs = np.mgrid[0:h, 0:w]
        c = (((xs // s) + (ys // s)) % 2)
        a = np.full((h, w, 3), 255, np.uint8)
        a[c == 0] = 205
        return Image.fromarray(a, "RGB").convert("RGBA")

    def rig(scale):
        img = skin.copy()
        for key, (sp, box) in eye_sprites.items():
            if scale < 1:
                w, h = sp.size
                nh = max(2, int(h * scale))
                sp2 = sp.resize((w, nh), Image.LANCZOS)
                img.alpha_composite(sp2, (box[0], box[1] + (h - nh) // 2))
            else:
                img.alpha_composite(sp, (box[0], box[1]))
        return img

    for im in (cut, rig(1.0), rig(0.35), rig(0.1)):
        c = checker(W, H)
        c.alpha_composite(im)
        panels.append(c)
    gap = 16
    out = Image.new("RGBA", (W * len(panels) + gap * (len(panels) - 1), H), (255, 255, 255, 255))
    for i, p in enumerate(panels):
        out.alpha_composite(p, (i * (W + gap), 0))
    out.convert("RGB").save(out_path)
    print(f"  对照图：{out_path}（左起：抠图 / 皮+眼睛 / 眨眼 35% / 眨眼 10%）")


# ---------------------------------------------------------------- 主流程
def parse_eye(s):
    v = [float(x) for x in s.replace(" ", "").split(",")]
    if len(v) != 4:
        raise argparse.ArgumentTypeError("眼睛格式应为 cx,cy,rx,ry")
    return v


def main():
    ap = argparse.ArgumentParser(description="把静态角色图拆成桌宠分层素材")
    ap.add_argument("--src", required=True, help="原始图片")
    ap.add_argument("--out", default="pet-assets", help="输出目录")
    ap.add_argument("--bg", help="背景色 R,G,B（默认自动取四边中位数）")
    ap.add_argument("--tol", type=float, default=22, help="背景颜色容差，默认 22")
    ap.add_argument("--seed", default=None, help="角色身上的一个点 x,y（默认取图片中心）")
    ap.add_argument("--crop", default=None, help="先裁一刀 x0,y0,x1,y1（截图类图片先裁到角色）")
    ap.add_argument("--mask", default=None,
                    help="外部蒙版（白=角色，黑=背景），给了就跳过颜色抠图；"
                         "背景不干净时先用 rembg / SAM / PS 出一张")
    ap.add_argument("--eye-l", type=parse_eye, default=None, help="左眼 cx,cy,rx,ry")
    ap.add_argument("--eye-r", type=parse_eye, default=None, help="右眼 cx,cy,rx,ry")
    ap.add_argument("--eye-margin", type=int, default=30, help="眼睛贴片四周多留的毛（px）")
    ap.add_argument("--max-width", type=int, default=0, help="输出宽度上限，0=不缩放")
    ap.add_argument("--name", default="pet", help="输出文件前缀，默认 pet")
    ap.add_argument("--grid", action="store_true", help="只输出一张带坐标网格的图，用来量眼睛")
    ap.add_argument("--preview", action="store_true", help="额外输出对照图")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    src = Image.open(a.src).convert("RGB")
    crop_off = (0, 0)
    if a.crop:
        c = [int(float(v)) for v in a.crop.split(",")]
        src = src.crop(tuple(c))
        crop_off = (c[0], c[1])
        print(f"先裁到 {tuple(c)}（--seed / --eye-* 仍然按原图坐标给，脚本自己换算）")
    if a.max_width and src.width > a.max_width:
        src = src.resize((a.max_width, round(src.height * a.max_width / src.width)), Image.LANCZOS)
    arr = np.asarray(src).astype(np.float32)

    if a.grid:
        save_grid(a.src, os.path.join(a.out, "grid.png"))
        return

    if a.mask:
        m = Image.open(a.mask).convert("L")
        if m.size != src.size:
            m = m.resize(src.size, Image.LANCZOS)
        alpha = np.asarray(m).astype(np.float32)
        print(f"用外部蒙版抠图：{a.mask}（角色像素占比 {(alpha > 128).mean():.1%}）")
    else:
        bg = np.array([float(x) for x in a.bg.split(",")]) if a.bg else guess_bg(arr)
        print(f"背景色估计：{bg.round(1)}  容差 {a.tol}")
        seed = tuple(int(x) for x in a.seed.split(",")) if a.seed else (src.width // 2, int(src.height * 0.75))
        seed = (seed[0] - crop_off[0], seed[1] - crop_off[1])   # 统一按原图坐标给
        alpha = cutout(arr, bg, a.tol, seed)
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise SystemExit("什么都没抠出来：--tol 调小，或用 --seed 指到角色身上")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    print(f"角色外接框：{box}  尺寸 {box[2]-box[0]}x{box[3]-box[1]}")
    if (box[2] - box[0]) * (box[3] - box[1]) < 0.02 * src.width * src.height:
        print("  ! 抠出来的东西太小了 —— 多半是背景不干净（截图/复杂背景），"
              "试试 --seed 指到角色身上、--tol 调大，或先 --crop / --mask")

    rgb = src.crop(box)
    cut = rgb.convert("RGBA")
    cut.putalpha(Image.fromarray(alpha.astype(np.uint8), "L").crop(box))

    out = {}
    W, H = cut.size
    eyes = {}
    for key, e in (("l", a.eye_l), ("r", a.eye_r)):
        if e:
            # 用户量的是「原图」坐标 → 先减 crop 偏移，再减角色外接框偏移
            eyes[key] = [e[0] - crop_off[0] - box[0], e[1] - crop_off[1] - box[1], e[2], e[3]]

    cut.save(os.path.join(a.out, f"{a.name}.png"), optimize=True)
    print(f"  {a.name}.png        {cut.size}")

    eye_sprites = {}
    if len(eyes) == 2:
        holes = np.zeros((H, W), dtype=bool)
        for k, e in eyes.items():
            holes |= ellipse_mask((W, H), e, grow=2.0, blur=2.0) > 0.5
        skin_img = inpaint(rgb, holes)
        for k, e in eyes.items():
            m = ellipse_mask((W, H), e, grow=1.0, blur=4.0)
            mgn = a.eye_margin
            ebox = (int(e[0] - e[2] - mgn), int(e[1] - e[3] - mgn),
                    int(e[0] + e[2] + mgn), int(e[1] + e[3] + mgn))
            sp = rgb.crop(ebox).convert("RGBA")
            sp.putalpha(Image.fromarray(
                (m[ebox[1]:ebox[3], ebox[0]:ebox[2]] * 255).astype(np.uint8), "L"))
            sp.save(os.path.join(a.out, f"{a.name}-eye-{k}.png"), optimize=True)
            eye_sprites[k] = (sp, ebox)
            out.setdefault("eyes", {})[k] = {
                "box": list(ebox), "cx": e[0], "cy": e[1], "rx": e[2], "ry": e[3]}
            print(f"  {a.name}-eye-{k}.png   {sp.size}")
        skin = skin_img.convert("RGBA")
        skin.putalpha(cut.getchannel("A"))
        skin.save(os.path.join(a.out, f"{a.name}-skin.png"), optimize=True)
        print(f"  {a.name}-skin.png    {skin.size}")
    else:
        print("（没给两只眼睛的坐标 → 只出抠图，不做眨眼；补上 --eye-l/--eye-r 即可）")

    out["size"] = [W, H]
    with open(os.path.join(a.out, f"{a.name}.json"), "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"  {a.name}.json")
    print("\n把 size / eyes 抄进你的 JS：SPRITE={w:%d,h:%d}" % (W, H))

    if a.preview:
        save_preview(cut, skin if len(eyes) == 2 else cut, eye_sprites,
                     os.path.join(a.out, "preview.png"))


if __name__ == "__main__":
    main()
