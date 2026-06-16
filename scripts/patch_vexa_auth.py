# -*- coding: utf-8 -*-
"""
Патч Vexa-бота под authenticated-режим БЕЗ S3:
  - брать залогиненный профиль из /master-profile (доменный аккаунт socials@),
  - на каждый мит делать СВОЮ копию профиля (/tmp/bd-<uniq>) — чтобы параллельные
    боты не дрались за один lock-файл Chrome,
  - не дёргать S3 при выходе (его у нас нет).

Запуск внутри контейнера vexa-lite:
  docker cp scripts/patch_vexa_auth.py vexa-lite:/tmp/patch_vexa_auth.py
  docker exec vexa-lite python3 /tmp/patch_vexa_auth.py
Идемпотентно (повторный запуск ничего не ломает). Переприменять после
пересоздания контейнера vexa-lite.
"""
import io
import sys

PATH = "/app/vexa-bot/dist/index.js"

ANCHOR_LAUNCH = (
    "    if (botConfig.authenticated && botConfig.userdataS3Path) {\n"
    "        (0, utils_1.log)('[Bot] Authenticated mode: downloading userdata from S3...');\n"
    "        (0, s3_sync_1.ensureBrowserDataDir)();\n"
    "        (0, s3_sync_1.syncBrowserDataFromS3)(botConfig);\n"
    "        (0, s3_sync_1.cleanStaleLocks)(s3_sync_1.BROWSER_DATA_DIR);\n"
    "        const authArgs = (0, constans_1.getAuthenticatedBrowserArgs)();\n"
    "        const context = await playwright_extra_1.chromium.launchPersistentContext(s3_sync_1.BROWSER_DATA_DIR, {\n"
)

REPLACE_LAUNCH = (
    "    if (botConfig.authenticated) { /* tryll local profile */\n"
    "        const __cp = require('child_process');\n"
    "        const __botDir = '/tmp/bd-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);\n"
    "        (0, utils_1.log)('[Bot] Authenticated mode (tryll local profile) -> ' + __botDir);\n"
    "        __cp.execSync('mkdir -p \"' + __botDir + '\" && cp -a /master-profile/. \"' + __botDir + '/\" && find \"' + __botDir + '\" -name \"Singleton*\" -delete 2>/dev/null || true');\n"
    "        const authArgs = (0, constans_1.getAuthenticatedBrowserArgs)();\n"
    "        const context = await playwright_extra_1.chromium.launchPersistentContext(__botDir, {\n"
)

ANCHOR_LEAVE = "    if (currentBotConfig?.authenticated && currentBotConfig?.userdataS3Path) {"
REPLACE_LEAVE = "    if (false /* tryll no-s3 */ && currentBotConfig?.authenticated && currentBotConfig?.userdataS3Path) {"

src = io.open(PATH, encoding="utf-8").read()

if "tryll local profile" in src:
    print("index.js: already patched")
elif ANCHOR_LAUNCH not in src:
    print("ERROR: launch anchor not found — версия Vexa изменилась, патч обновить вручную")
    sys.exit(1)
else:
    src = src.replace(ANCHOR_LAUNCH, REPLACE_LAUNCH)
    if ANCHOR_LEAVE in src:
        src = src.replace(ANCHOR_LEAVE, REPLACE_LEAVE)
        print("index.js: leave-sync disabled")
    else:
        print("index.js: WARN leave anchor not found (non-fatal)")
    io.open(PATH, "w", encoding="utf-8").write(src)
    print("index.js: patched -> local /master-profile + per-bot copy")

# --- join.js: убрать анонимный fallback в authenticated-режиме ---
# Если cookies не подхватились (виден 'Ask to join'), бот НЕ заходит анонимно,
# а уходит с ошибкой — чтобы не было постороннего "Tryll Notes Bot" в звонке.
JOIN_PATH = "/app/vexa-bot/dist/platforms/googlemeet/join.js"
ANCHOR_FALLBACK = (
    '                await clickHandle(joinButton.el, "ask_to_join");\n'
    "                (0, utils_1.log)(`Bot joined Google Meet via fallback (Ask to join).`);"
)
REPLACE_FALLBACK = (
    '                throw new Error("tryll: auth cookies not loaded — refusing anonymous fallback"); /* tryll no-anon-fallback */'
)
jsrc = io.open(JOIN_PATH, encoding="utf-8").read()
if "tryll no-anon-fallback" in jsrc:
    print("join.js: already patched")
elif ANCHOR_FALLBACK not in jsrc:
    print("join.js: WARN fallback anchor not found — проверить вручную")
else:
    jsrc = jsrc.replace(ANCHOR_FALLBACK, REPLACE_FALLBACK)
    io.open(JOIN_PATH, "w", encoding="utf-8").write(jsrc)
    print("join.js: anonymous fallback disabled")
