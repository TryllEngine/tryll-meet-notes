# -*- coding: utf-8 -*-
# Build-safe патч: бот сообщает, залогинен ли он, и записывает куки обратно
# при ЛЮБОМ заходе под аккаунтом, а не только после «Join now».
#
# ЗАЧЕМ (13.10.2026).
# 1) Каждый раз, когда бот стучался, мы гадали, умерла ли сессия socials@:
#    логи ботов в базе Vexa обрезаются до хвоста, и у долгих ботов не видно,
#    как они входили. Теперь бот в лобби смотрит на экран (tryll-authstate.cjs)
#    и пишет итог в /master-profile/tryll-auth-state.json:
#    signed_in / signed_out / reauth_required / unknown. Его читает meet-check.
# 2) Куки обратно в /master-profile писались только при входе кнопкой
#    «Join now»/«Join anyway» (флаг __tryllAuthOk). Залогиненный бот, который
#    СТУЧИТСЯ (чужой мит или мит с ограниченным доступом), тоже прокручивает
#    сессию Google, но обратно её не записывал — профиль отставал от сессии.
#    Теперь пишем и тогда, когда бот видел себя залогиненным (signed_in).
#    Разлогиненного (signed_out) — по-прежнему НЕ пишем: не портим хороший логин.
#
# Ставится ПОСЛЕ accountchooser (якорь — конец его блока) и writeback
# (условие записи). Ненайденный якорь роняет сборку. Маркер tryll-authstate.
import io, sys

JOIN = "/app/vexa-bot/dist/platforms/googlemeet/join.js"
INDEX = "/app/vexa-bot/dist/index.js"
MODULE = "/app/vexa-bot/dist/tryll-authstate.cjs"
STATE = "/master-profile/tryll-auth-state.json"

JOIN_ANCHOR = '        } catch (__ace) { (0, utils_1.log)("tryll: auth-screens handler error (non-fatal): " + (__ace && __ace.message)); }\n'

JOIN_BLOCK = (
    "        /* tryll-authstate: залогинен ли бот на самом деле — по экрану лобби.\n"
    "           Итог -> " + STATE + " (его читает meet-check). Ошибка не мешает заходу. */\n"
    "        try {\n"
    "            const __tas = require('" + MODULE + "');\n"
    "            const __state = await page.evaluate(__tas.detectAuthState);\n"
    "            global.__tryllAuthState = __state;\n"
    "            const __fs = require('fs');\n"
    "            const __tmp = '" + STATE + ".' + process.pid + '.tmp';\n"
    "            __fs.writeFileSync(__tmp, JSON.stringify({ state: __state, at: new Date().toISOString(), meeting: (page.url() || '').split('?')[0] }));\n"
    "            __fs.renameSync(__tmp, '" + STATE + "');\n"
    "            (0, utils_1.log)('tryll-authstate: ' + __state);\n"
    "        } catch (__tase) { (0, utils_1.log)('tryll-authstate error (non-fatal): ' + (__tase && __tase.message)); }\n"
)

INDEX_OLD = "        if (global.__tryllAuthOk && global.__tryllProfileDir) {\n"
INDEX_NEW = (
    "        /* tryll-authstate: писать и когда бот стучался, но был залогинен —\n"
    "           иначе прокрученная им сессия теряется и профиль отстаёт. */\n"
    "        if ((global.__tryllAuthOk || global.__tryllAuthState === 'signed_in') && global.__tryllProfileDir) {\n"
)


def _once(src, anchor, name):
    n = src.count(anchor)
    if n != 1:
        sys.exit("AUTHSTATE: anchor %s found %d times (expected 1)" % (name, n))


def patch_join(src):
    if "tryll-authstate" in src:
        return src
    _once(src, JOIN_ANCHOR, "join")
    return src.replace(JOIN_ANCHOR, JOIN_ANCHOR + JOIN_BLOCK, 1)


def patch_index(src):
    if "tryll-authstate" in src:
        return src
    _once(src, INDEX_OLD, "index")
    return src.replace(INDEX_OLD, INDEX_NEW, 1)


def main():
    for path, fn in ((JOIN, patch_join), (INDEX, patch_index)):
        src = io.open(path, encoding="utf-8").read()
        out = fn(src)
        if out != src:
            io.open(path, "w", encoding="utf-8").write(out)
            print("%s: authstate applied" % path.rsplit("/", 1)[-1])
        else:
            print("%s: authstate already applied" % path.rsplit("/", 1)[-1])


if __name__ == "__main__":
    main()
