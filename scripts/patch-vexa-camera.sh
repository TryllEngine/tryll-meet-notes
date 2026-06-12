#!/bin/sh
# Патч vexa-lite: включать виртуальную камеру бота, когда задан default_avatar_url.
# В стоковом meeting-api параметр cameraEnabled не прокинут из API (v0.10.x).
# Применять после пересоздания контейнера vexa-lite: bash scripts/patch-vexa-camera.sh
set -e
docker exec vexa-lite python3 -c "
import io
p = '/app/meeting-api/meeting_api/meetings.py'
src = io.open(p, encoding='utf-8').read()
anchor = 'bot_config[\"defaultAvatarUrl\"] = req.default_avatar_url'
patch = anchor + '\n        bot_config[\"cameraEnabled\"] = True  # tryll patch: avatar needs camera'
if 'tryll patch' in src:
    print('already patched')
elif anchor not in src:
    raise SystemExit('ANCHOR NOT FOUND — версия Vexa изменилась, патч обновить вручную')
else:
    io.open(p, 'w', encoding='utf-8').write(src.replace(anchor, patch))
    print('patched')
"
# Патч 2: аватар на весь кадр камеры (в стоке — 12% высоты, крошечная карточка)
docker exec vexa-lite python3 -c "
import io
p = '/app/vexa-bot/dist/services/screen-content.js'
src = io.open(p, encoding='utf-8').read()
anchor = 'Math.max(Math.round(canvas.height * 0.12), 100)'
if 'tryll fullframe' in src:
    print('avatar size: already patched')
elif anchor not in src:
    raise SystemExit('AVATAR ANCHOR NOT FOUND — версия Vexa изменилась')
else:
    io.open(p, 'w', encoding='utf-8').write(src.replace(anchor, 'Math.max(canvas.width, canvas.height) /* tryll fullframe */'))
    print('avatar size: patched (full-frame)')
"

# перезапуск meeting-api (supervisord поднимет сам); боты подхватят патч при следующем запуске
docker exec vexa-lite sh -c "kill \$(ps aux | grep 'meeting_api.main' | grep -v grep | awk '{print \$2}')"
echo "meeting-api перезапускается..."
