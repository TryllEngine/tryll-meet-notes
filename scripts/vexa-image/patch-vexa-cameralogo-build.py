# -*- coding: utf-8 -*-
# Build-safe патч: нормальный лого в камере (не чёрный экран).
# ПРОБЛЕМА: боту передаётся http-URL лого (GitHub), а new Image() в браузере бота
# его часто не грузит (сеть/навигация) → чёрное. Плюс прошлый рендер клал картинку
# на весь кадр (maxSize=1920) → мимо кадра.
# ФИКС: (A) размер лого ~55% высоты (крупно и в кадре); (B) http-URL игнорируем и
# берём ЛОКАЛЬНЫЙ лого (data-URI из /app/vexa-bot/assets/vexa-logo-default.png,
# который заменён на наш bot-avatar.png в Dockerfile) — надёжно, без сети.
# Идемпотентно (маркер tryll-logo).
import io, sys

P = "/app/vexa-bot/dist/services/screen-content.js"
src = io.open(P, encoding="utf-8").read()

if "tryll-logo" in src:
    print("screen-content.js: logo fix already applied")
    print("cameralogo (build): done")
    sys.exit(0)

# (A) рендер: заполнить ВЕСЬ кадр (cover) — картинка (наш лого на фоне) на весь тайл
a1 = "const scale = Math.min(maxSize / img.width, maxSize / img.height);"
r1 = "const scale = Math.max(canvas.width / img.width, canvas.height / img.height); /* tryll-logo cover: весь кадр */"
if a1 not in src:
    sys.exit("LOGO: scale anchor not found (camera patch не наложен?)")
src = src.replace(a1, r1, 1)
print("screen-content.js: render -> COVER (full frame)")

# (B) http-URL игнорируем -> берём локальный дефолт (наш лого)
a2 = "        this._customAvatarDataUri = defaultAvatarUrl;\n"
r2 = ('        this._customAvatarDataUri = (typeof defaultAvatarUrl === "string" '
      '&& defaultAvatarUrl.indexOf("data:") === 0) ? defaultAvatarUrl : null; '
      '/* tryll-logo prefer-local: http avatar URLs are flaky in bot browser */\n')
if a2 not in src:
    sys.exit("LOGO: custom-avatar anchor not found")
src = src.replace(a2, r2, 1)
print("screen-content.js: prefer local logo over flaky http URL")

io.open(P, "w", encoding="utf-8").write(src)
print("cameralogo (build): done")
