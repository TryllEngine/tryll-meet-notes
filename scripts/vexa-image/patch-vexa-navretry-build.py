#!/usr/bin/env python3
"""
tryll-navretry — бот переживает ПЕРЕЗАГРУЗКУ/навигацию страницы Google Meet.

БАГ (2026-07-20/23, ловили 3 мита за день): Google Meet иногда сам навигирует
вкладку прямо во время мита → долгоживущий page.evaluate записи
(startGoogleRecording, recording.js:155) падает с «Execution context was
destroyed, most likely because of a navigation» → meetingFlow ловит это как
post_join_setup_error и бот ВЫХОДИТ, теряя оставшийся мит.

ФИКС (meetingFlow.js): запуск записи оборачивается в retry. Если запись упала
ИМЕННО от навигации (context destroyed / target closed / frame detached) —
ждём перезагрузку и ПЕРЕЗАПУСКАЕМ запись (до 3 раз), а не выходим. Легитимные
причины (removed / left-alone / startup-alone токены) и любые другие ошибки —
прокидываются как раньше, поведение не меняется. Нормальный путь (без навигации)
исполняется без изменений. В худшем случае (3 ретрая не помогли) — ровно старое
поведение (post_join_setup_error). Хуже стать не может.
"""
import sys

JS = "/app/vexa-bot/dist/platforms/shared/meetingFlow.js"

OLD = """            await Promise.race([
                strategies.startRecording(page, botConfig),
                removalPromise
            ]);
            // Normal completion
            await gracefulLeaveFunction(page, 0, "normal_completion");"""

NEW = """            // tryll-navretry: survive Meet page navigation (context destroyed)
            let __tryllNavRetries = 0;
            while (true) {
                try {
                    await Promise.race([
                        strategies.startRecording(page, botConfig),
                        removalPromise
                    ]);
                    break;
                } catch (__tryllErr) {
                    const __tryllMsg = (__tryllErr && __tryllErr.message) || String(__tryllErr);
                    const __tryllIsNav = /(Execution context was destroyed|context was destroyed|Target closed|frame was detached|frame detached)/i.test(__tryllMsg)
                        && !__tryllMsg.includes(tokens.removedToken)
                        && !__tryllMsg.includes(tokens.leftAloneToken)
                        && !__tryllMsg.includes(tokens.startupAloneToken);
                    if (__tryllIsNav && __tryllNavRetries < 3) {
                        __tryllNavRetries++;
                        console.log("[tryll] Meet page navigated (context destroyed) — re-attaching recording, attempt " + __tryllNavRetries + "/3");
                        try { await page.waitForLoadState("domcontentloaded", { timeout: 20000 }); } catch (e) {}
                        try { await page.waitForTimeout(3000); } catch (e) {}
                        continue;
                    }
                    throw __tryllErr;
                }
            }
            // Normal completion
            await gracefulLeaveFunction(page, 0, "normal_completion");"""

with open(JS, "r", encoding="utf-8") as f:
    src = f.read()

if "tryll-navretry" in src:
    print("patch-vexa-navretry: already applied")
    sys.exit(0)

if OLD not in src:
    print("patch-vexa-navretry: ANCHOR NOT FOUND — meetingFlow.js изменился, поправить анкер", file=sys.stderr)
    sys.exit(1)

src = src.replace(OLD, NEW, 1)

with open(JS, "w", encoding="utf-8") as f:
    f.write(src)

print("patch-vexa-navretry: applied OK")
