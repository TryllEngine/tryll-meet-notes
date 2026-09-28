# -*- coding: utf-8 -*-
# Build-safe патч: бот при отозванной сессии Google СТУЧИТСЯ, а не падает.
#
# ИНЦИДЕНТ 28.09.2026. Google на своей стороне отозвал сессию socials@ (куки в
# профиле по срокам валидны, но Google их больше не принимает). С ~10:55 UTC
# КАЖДАЯ попытка authenticated-бота умирала за ~10 секунд. Разбор по логу бота
# (сессия 847):
#
#   Встроенный откат в join.js («Ask to join» вместо «Join now» → стучимся
#   гостем) ПАДАЛ сам: кнопка «Ask to join» бралась ДО ввода имени, а после
#   ввода Meet её перерисовывает. Сохранённая ссылка указывала на мёртвый
#   элемент → «humanized: element has zero size» → клик падает → бот умирает
#   с ЛОЖНЫМ сообщением «No join button found after 30s» (отсюда 6 секунд
#   вместо 30). То есть откат гостем не срабатывал НИ РАЗУ.
#
# Что делает патч (маркер tryll-selfheal):
#   B) Кнопка «Join anyway» (Meet показывает её вместо «Join now» при
#      предупреждении об устройствах) — теперь тоже авторизованный вход. Раньше
#      её не было в гонке кнопок, и бот ждал 30 сек и падал.
#   C) В откате «Ask to join» кнопку берём ЗАНОВО, уже после ввода имени.
#
# Автоматический ВХОД ПАРОЛЕМ сюда намеренно НЕ входит: логин socials@ делается
# руками через scripts/login-helper. Этот патч лишь гарантирует, что при
# отвалившейся сессии бот постучится с ПЕРВОЙ попытки, а не умрёт.
#
# Должен идти ПОСЛЕ askjoin (askToJoinSelector) и writeback (маркер tryll-wb-ok
# внутри ветки join_now). Ненайденный якорь → падение сборки (узнаём сразу).
import io, sys

P = "/app/vexa-bot/dist/platforms/googlemeet/join.js"
src = io.open(P, encoding="utf-8").read()

if "tryll-selfheal" in src:
    print("join.js: selfheal already applied")
    sys.exit(0)

# ------------------------------------------------------- B: «Join anyway» в гонке
B = "                page.waitForSelector(joinNowSelector, { timeout: 30000 }).then(el => ({ el, type: 'join_now' })),\n"
B_ADD = "                page.waitForSelector('button:has-text(\"Join anyway\")', { timeout: 30000 }).then(el => ({ el, type: 'join_anyway' })), /* tryll-selfheal: «Join anyway» = вход залогиненным при предупреждении об устройствах */\n"
B2 = "            if (joinButton.type === 'join_now') {\n"
B2_NEW = "            if (joinButton.type === 'join_now' || joinButton.type === 'join_anyway') { /* tryll-selfheal */\n"

# ------------------------------------------ C: кнопку «Ask to join» берём ЗАНОВО
C = '                await clickHandle(joinButton.el, "ask_to_join");\n                (0, utils_1.log)(`Bot joined Google Meet via fallback (Ask to join).`);'
C_NEW = r'''                /* tryll-selfheal: после ввода имени Meet ПЕРЕРИСОВЫВАЕТ кнопку «Ask to join»,
                   и joinButton.el (взят ДО ввода) указывает на мёртвый элемент ->
                   «element has zero size» -> бот умирал с ложным «No join button found».
                   Берём кнопку заново, уже после ввода имени. */
                let __askBtn = null;
                try { __askBtn = await page.waitForSelector(askToJoinSelector + ':not([disabled])', { state: 'visible', timeout: 10000 }); } catch (e) {}
                if (!__askBtn) { try { __askBtn = await page.$(askToJoinSelector); } catch (e) {} }
                await clickHandle(__askBtn || joinButton.el, "ask_to_join");
                (0, utils_1.log)(`Bot joined Google Meet via fallback (Ask to join).`);'''

for name, anchor in (("B", B), ("B2", B2), ("C", C)):
    n = src.count(anchor)
    if n != 1:
        sys.exit("SELFHEAL: anchor %s found %d times (expected 1)" % (name, n))

src = src.replace(B, B + B_ADD, 1)
src = src.replace(B2, B2_NEW, 1)
src = src.replace(C, C_NEW, 1)
io.open(P, "w", encoding="utf-8").write(src)
print("join.js: selfheal applied (B join-anyway, C fresh ask-to-join)")
