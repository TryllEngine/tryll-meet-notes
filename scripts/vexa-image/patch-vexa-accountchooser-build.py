# -*- coding: utf-8 -*-
# Build-safe патч: обработка экрана Google «выбери аккаунт» (signin/accountchooser).
# ПРОБЛЕМА (1 июля): Google при заходе бота на мит показывает «выбери аккаунт»
# вместо green room. Штатный join.js ждёт только «Join now/Switch/Ask to join»
# → 30с таймаут → join_meeting_error. 100% заходов падали так.
# ФИКС: пока мы на accounts.google.com — кликаем плитку аккаунта (data-identifier),
# ждём перехода на meet.google.com, дальше обычный флоу. Если чузера нет — no-op.
# Идемпотентно (маркер tryll-accountchooser).
import io, sys

P = "/app/vexa-bot/dist/platforms/googlemeet/join.js"
src = io.open(P, encoding="utf-8").read()

anchor = '        (0, utils_1.log)("📸 Diagnostic screenshot: auth lobby state");\n'

block = (
    '        /* tryll-accountchooser: Google может показать «выбери аккаунт» вместо мита.\n'
    '           Кликаем плитку аккаунта, чтобы дойти до green room. Если уже на meet — no-op. */\n'
    '        try {\n'
    '            for (let __ac = 0; __ac < 15; __ac++) {\n'
    '                if (!/accounts\\.google\\.com/.test(page.url())) break;\n'
    '                (0, utils_1.log)("tryll: account-chooser page detected -> " + page.url());\n'
    '                const __acSel = (await page.$(\'[data-identifier]\')) ? \'[data-identifier]\'\n'
    '                    : (await page.$(\'[data-authuser]\')) ? \'[data-authuser]\'\n'
    '                    : (await page.$(\'[data-email]\')) ? \'[data-email]\' : null;\n'
    '                if (__acSel) {\n'
    '                    (0, utils_1.log)("tryll: clicking account tile (" + __acSel + ")");\n'
    '                    await Promise.all([\n'
    '                        page.waitForNavigation({ timeout: 15000 }).catch(() => {}),\n'
    '                        page.click(__acSel).catch((e) => (0, utils_1.log)("tryll: click failed " + e.message)),\n'
    '                    ]);\n'
    '                    await page.waitForTimeout(2500);\n'
    '                } else {\n'
    '                    (0, utils_1.log)("tryll: NO account tile selector matched — screenshot for debug");\n'
    '                    await page.screenshot({ path: \'/app/storage/screenshots/tryll-accountchooser.png\', fullPage: true }).catch(() => {});\n'
    '                    break;\n'
    '                }\n'
    '            }\n'
    '            if (/meet\\.google\\.com/.test(page.url())) { (0, utils_1.log)("tryll: past chooser, on meet -> " + page.url()); }\n'
    '        } catch (__ace) { (0, utils_1.log)("tryll: account-chooser handler error (non-fatal): " + (__ace && __ace.message)); }\n'
)

if "tryll-accountchooser" in src:
    print("join.js: account-chooser handler already applied")
elif anchor not in src:
    sys.exit("ACCOUNTCHOOSER: anchor not found (auth lobby screenshot line)")
else:
    io.open(P, "w", encoding="utf-8").write(src.replace(anchor, anchor + block, 1))
    print("join.js: account-chooser handler injected")

print("accountchooser (build): done")
