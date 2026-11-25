#!/usr/bin/env bash
# dsh-weknora-panel 安装脚本（Linux / macOS）
#
#   ./install.sh                  # 装到默认 profile
#   ./install.sh --profile web    # 指定 profile
#   ./install.sh --list           # 只列出可用 profile
#
# 真正的复制/登记逻辑在 install.mjs（Node 实现，Windows 那边由 install.cmd 调同一个文件），
# 这里只负责找一个可用的 node 并把它跑起来。
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[安装失败] 找不到 node。请先装 Node.js（>=18），或把 node 放进 PATH。" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "[安装失败] 当前 Node 版本 $(node -v) 太旧，需要 >= 18。" >&2
  exit 1
fi

echo "node     : $(node -v)"
echo "DSH_HOME : ${DSH_HOME:-$HOME/.dsh}"
exec node install.mjs "$@"
