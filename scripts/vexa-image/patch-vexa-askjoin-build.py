#!/usr/bin/env python3
"""
tryll-askjoin-fix — чинит заход бота на ВНЕШНИЕ миты (организатор не @tryllengine).

БАГ (найдено 2026-07-15 по логам+скриншоту сессии на Art sync):
join.js брал селектор кнопки «Ask to join» как googleJoinButtonSelectors[0] =
  "button[jsname]:not([aria-label]):has(span)"
Но реальная кнопка «Ask to join» в Meet ИМЕЕТ aria-label, а этот селектор её
СПЕЦИАЛЬНО исключает (:not([aria-label])). Итог: на внешнем мите ни один из 3
селекторов в Promise.race не срабатывал → все три отваливались по таймауту 30с →
race падал ошибкой первого (join_now), бот НЕ нажимал «Ask to join» = «даже не
стучится». Внутренние миты работали (там ловится «Join now» своим селектором).

ФИКС: askToJoinSelector = 'button:has-text("Ask to join")' — тот же проверенный
паттерн, что и рабочий joinNowSelector. Затрагивает ТОЛЬКО внешний путь; на
внутренних митах «Join now» по-прежнему выигрывает race, поведение не меняется.
После фикса бот на внешнем мите стучится (Ask to join) и ждёт впуска —
организатор/участник жмёт «Admit».
"""
import sys

JS = "/app/vexa-bot/dist/platforms/googlemeet/join.js"
OLD = "const askToJoinSelector = selectors_1.googleJoinButtonSelectors[0];"
NEW = "const askToJoinSelector = 'button:has-text(\"Ask to join\")'; /* tryll-askjoin-fix */"

with open(JS, "r", encoding="utf-8") as f:
    src = f.read()

if "tryll-askjoin-fix" in src:
    print("patch-vexa-askjoin: already applied")
    sys.exit(0)

if OLD not in src:
    print("patch-vexa-askjoin: ANCHOR NOT FOUND — join.js изменился, поправить анкер", file=sys.stderr)
    sys.exit(1)

src = src.replace(OLD, NEW)

with open(JS, "w", encoding="utf-8") as f:
    f.write(src)

print("patch-vexa-askjoin: applied OK")
