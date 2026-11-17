@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  dsh-weknora-panel 安装
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 node 命令。请先安装 Node.js（DeepSeek Harness 自带的环境也行）。
  pause
  exit /b 1
)
node "%~dp0install.mjs" %*
echo.
pause
