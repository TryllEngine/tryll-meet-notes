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

# --- join.js: НЕ трогаем (оставляем оригинальный «Ask to join») ---
# Раньше мы здесь отключали fallback (бот падал, если нет авто-впуска), чтобы не
# было постороннего бота. Но это ломало миты с ВНЕШНИМ организатором (не
# tryllengine): для них Google не даёт «Join now», только «Ask to join». Теперь
# оставляем штатное поведение Vexa: внутренние миты → авто-впуск (Join now),
# внешние → бот стучится (Ask to join) под socials@ и ждёт, пока впустят.
# Ничего не патчим — оригинальный join.js уже это умеет.
print("join.js: не патчим (оставляем штатный Ask to join — стук при внешнем организаторе)")
