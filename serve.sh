#!/usr/bin/env bash
# serve.sh — 在本地起一个静态服务器，把「成品」和「教程站」跑起来
#
#   ./serve.sh            # 默认 8000 端口
#   ./serve.sh 5173       # 换个端口
#
# 只需要 Python 3（系统自带即可），不装任何东西。
# 按 Ctrl+C 停。

set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "找不到 python3。装一个，或者用别的静态服务器指向这个目录。" >&2
  exit 1
fi

# 端口被占就自动往后找
for _ in $(seq 1 20); do
  if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  echo "端口 $PORT 被占用，换 $((PORT + 1))"
  PORT=$((PORT + 1))
done

cat <<EOF

  乐乐桌宠 · 本地服务已启动

    教程站   http://localhost:$PORT/site/
    成品     http://localhost:$PORT/
    V5 源码  http://localhost:$PORT/build/05-物理.html

  目录     $(pwd)
  按 Ctrl+C 停止

EOF

exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
