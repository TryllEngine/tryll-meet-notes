# -*- coding: utf-8 -*-
# Build-safe патч: WRITE-BACK профиля — держать /master-profile «тёплым».
# После мита бот сохраняет свои свежие куки обратно в /master-profile, чтобы
# сессия Google ротировалась и реже требовала «verify it's you».
#
# ЗАЩИТА: пишем обратно ТОЛЬКО если authenticated Join-now реально удался
# (global.__tryllAuthOk). При гостевом фолбэке НЕ трогаем хороший логин.
# Атомарно: каждый файл кук копируется через temp + rename (в пределах тома).
# Каждый бот = отдельный процесс, поэтому global.* не пересекаются между ботами.
# Идемпотентно (маркеры tryll-wb-*).
import io, sys

IDX = "/app/vexa-bot/dist/index.js"
JOIN = "/app/vexa-bot/dist/platforms/googlemeet/join.js"

src = io.open(IDX, encoding="utf-8").read()

# --- EDIT 1: запомнить папку профиля бота глобально (в launch-блоке) ---
a1 = "        const __botDir = '/tmp/bd-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);\n"
r1 = a1 + "        try { global.__tryllProfileDir = __botDir; } catch (e) {} /* tryll-wb-dir */\n"

# --- EDIT 3: блок write-back в Graceful Leave (перед S3-блоком) ---
a3 = "    // Sync browser data back to S3 for authenticated bots (preserves cookies/sessions)\n"
wb = (
    "    /* tryll-wb-save: держим /master-profile тёплым — пишем свежие куки обратно\n"
    "       ТОЛЬКО если authenticated Join-now удался (иначе не портим логин гостем). */\n"
    "    try {\n"
    "        if (global.__tryllAuthOk && global.__tryllProfileDir) {\n"
    "            const __wbcp = require('child_process');\n"
    "            const __wbd = global.__tryllProfileDir;\n"
    "            __wbcp.execSync(\n"
    "                'set -e; d=\"' + __wbd + '\"; ' +\n"
    "                'for rel in Default/Cookies-wal Default/Cookies-shm Default/Cookies Default/Network/Cookies-wal Default/Network/Cookies-shm Default/Network/Cookies; do ' +\n"
    "                '  src=\"$d/$rel\"; dst=\"/master-profile/$rel\"; ' +\n"
    "                '  if [ -f \"$src\" ]; then mkdir -p \"$(dirname \"$dst\")\"; cp -f \"$src\" \"$dst.tryllnew\" && mv -f \"$dst.tryllnew\" \"$dst\"; ' +\n"
    "                '  else rm -f \"$dst\"; fi; ' +\n"
    "                'done',\n"
    "                { shell: '/bin/sh', stdio: 'ignore' }\n"
    "            );\n"
    "            (0, utils_1.log)(\"[Graceful Leave] tryll: master-profile cookies refreshed (warm session)\");\n"
    "        }\n"
    "    } catch (e) { (0, utils_1.log)(\"[Graceful Leave] tryll write-back failed (non-fatal): \" + (e && e.message)); }\n"
)

if "tryll-wb-dir" in src and "tryll-wb-save" in src:
    print("index.js: write-back already applied")
else:
    if "tryll-wb-dir" not in src:
        if a1 not in src:
            sys.exit("WB: launch anchor (__botDir) not found")
        src = src.replace(a1, r1, 1)
        print("index.js: profile dir captured globally")
    if "tryll-wb-save" not in src:
        if a3 not in src:
            sys.exit("WB: graceful-leave anchor not found")
        src = src.replace(a3, wb + a3, 1)
        print("index.js: write-back block injected")
    io.open(IDX, "w", encoding="utf-8").write(src)

# --- EDIT 2: пометить успешный Join-now (join.js) ---
js = io.open(JOIN, encoding="utf-8").read()
a2 = '                (0, utils_1.log)("Bot joined Google Meet as authenticated user (Join now).");'
r2 = a2 + "\n                try { global.__tryllAuthOk = true; } catch (e) {} /* tryll-wb-ok */"
if "tryll-wb-ok" in js:
    print("join.js: auth-ok flag already applied")
elif a2 not in js:
    sys.exit("WB: join.js Join-now anchor not found")
else:
    io.open(JOIN, "w", encoding="utf-8").write(js.replace(a2, r2, 1))
    print("join.js: auth-ok flag set on Join-now")

print("write-back (build): done")
