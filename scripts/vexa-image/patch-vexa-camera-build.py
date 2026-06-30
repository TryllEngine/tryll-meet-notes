# -*- coding: utf-8 -*-
# Build-safe версия камер-патча (без docker exec) — для вшивания в свой образ.
# Идентична scripts/patch-vexa-camera.sh, но запускается прямо в сборке:
#   1) meeting-api: cameraEnabled=True когда задан defaultAvatarUrl (в стоке не прокинут)
#   2) аватар на ВЕСЬ кадр (в стоке крошечная карточка 12%)
#   3) contentHint=detail на видеотреке камеры (кодек бережёт грани/текст лого)
# Идемпотентно (маркеры tryll patch / tryll fullframe / tryll detail).
import io

# 1) meetings.py — включить камеру под аватар
p = '/app/meeting-api/meeting_api/meetings.py'
s = io.open(p, encoding='utf-8').read()
anchor = 'bot_config["defaultAvatarUrl"] = req.default_avatar_url'
if 'tryll patch' in s:
    print('meetings.py: already')
elif anchor not in s:
    raise SystemExit('CAMERA: meetings.py anchor not found')
else:
    io.open(p, 'w', encoding='utf-8').write(
        s.replace(anchor, anchor + '\n        bot_config["cameraEnabled"] = True  # tryll patch: avatar needs camera'))
    print('meetings.py: patched (cameraEnabled)')

# 2) + 3) screen-content.js — полный кадр + contentHint
p = '/app/vexa-bot/dist/services/screen-content.js'
s = io.open(p, encoding='utf-8').read()

a2 = 'Math.max(Math.round(canvas.height * 0.12), 100)'
if 'tryll fullframe' in s:
    print('screen-content: fullframe already')
elif a2 not in s:
    raise SystemExit('CAMERA: avatar size anchor not found')
else:
    s = s.replace(a2, 'Math.max(canvas.width, canvas.height) /* tryll fullframe */')
    print('screen-content: fullframe patched')

if 'tryll detail' in s:
    print('screen-content: contentHint already')
else:
    for var in ['const stream = canvas.captureStream(30);',
                'const freshStream = canvas.captureStream(30);',
                'const canvasStream = canvas.captureStream(30);']:
        name = var.split('=')[0].replace('const', '').strip()
        s = s.replace(var, var + ' try { ' + name + ".getVideoTracks()[0].contentHint = 'detail'; } catch (e) {} /* tryll detail */")
    print('screen-content: contentHint patched')

io.open(p, 'w', encoding='utf-8').write(s)
print('camera (build): done')
