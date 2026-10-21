#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-docs.py — 把 build/ 里的完整源码灌进文档站的代码块里

为什么要有这一步：
  教程页里贴的代码必须和 build/ 里能跑的文件**一模一样**，否则读者复制下来就跑不通。
  手抄两边迟早会不同步，所以代码块留空，由这个脚本从真实文件读进来。

用法（改完 build/ 或页面之后跑一次）：
  python3 tools/build-docs.py

页面里的写法：
  <pre data-src="../build/03-视线.html" data-label="build/03-视线.html"></pre>
  · data-src 相对该页面所在目录
  · 有 data-src 的 pre 会被整段替换成文件内容（HTML 转义后）
"""
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = os.path.join(ROOT, "site")

PRE_RE = re.compile(r'<pre([^>]*?)data-src="([^"]+)"([^>]*)>(.*?)</pre>', re.S)


def main():
    pages = sorted(f for f in os.listdir(SITE) if f.endswith(".html"))
    total = 0
    for page in pages:
        path = os.path.join(SITE, page)
        src = open(path, encoding="utf-8").read()
        changed = [0]

        def repl(m):
            attrs_before, rel, attrs_after, _old = m.groups()
            target = os.path.normpath(os.path.join(SITE, rel))
            if not os.path.exists(target):
                print(f"  ! {page}: 找不到 {rel}")
                return m.group(0)
            code = open(target, encoding="utf-8").read()
            changed[0] += 1
            return ("<pre" + attrs_before + 'data-src="' + rel + '"' + attrs_after + ">" +
                    html.escape(code.rstrip("\n")) + "</pre>")

        out = PRE_RE.sub(repl, src)
        if changed[0]:
            open(path, "w", encoding="utf-8").write(out)
            total += changed[0]
            print(f"✓ {page}: 灌入 {changed[0]} 段代码")
    if not total:
        print("没有需要更新的代码块（或者你还没在页面里写 data-src）")
    print("\n提示：改完 build/ 的源码、或改了页面里的文字，都重跑一次本脚本。")


if __name__ == "__main__":
    main()
