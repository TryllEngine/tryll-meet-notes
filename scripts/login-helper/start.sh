#!/bin/bash
set -e
export DISPLAY=:99

# Виртуальный экран + оконный менеджер
Xvfb :99 -screen 0 1440x900x24 >/tmp/xvfb.log 2>&1 &
sleep 1
fluxbox >/tmp/fluxbox.log 2>&1 &
sleep 1

# VNC поверх экрана + мост в браузер (noVNC) на :6080
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
sleep 1

# Тот же Chromium, что использует Vexa-бот; те же ключевые флаги
CHROME=$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome | head -1)
echo "launching: $CHROME"
exec "$CHROME" \
  --user-data-dir=/profile \
  --password-store=basic \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --start-maximized \
  "https://accounts.google.com"
