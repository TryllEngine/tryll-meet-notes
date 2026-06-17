#!/usr/bin/env python3
"""
Патч vexa-bot: убрать ЛОЖНЫЙ выход с reason=normal_completion.

Проблема: запись (startGoogleRecording) резолвится по событиям страницы
`beforeunload` и `visibilitychange -> hidden`. Google Meet иногда дёргает
перезагрузку/навигацию страницы прямо посреди живого мита — бот ловит
beforeunload, резолвит запись и выходит как при «штатном конце» (normal_completion),
хотя в звонке ещё говорят люди (реальный кейс 17.06: бот 36 ушёл при 4 участниках).

Фикс: по этим событиям НЕ выходим сразу, а через 4с перепроверяем число
участников. Если в мите кто-то есть — это ложное событие, продолжаем запись.
Настоящие концы мита ловятся другими, надёжными сигналами:
removed_by_admin (removal monitor), left_alone_timeout, max_bot_time.

Применять внутри контейнера vexa-lite (патч живёт до пересоздания контейнера):
  docker cp scripts/patch-vexa-leave.py vexa-lite:/tmp/patch-vexa-leave.py
  docker exec vexa-lite python3 /tmp/patch-vexa-leave.py
Идемпотентно (маркер tryll-leave-guard).
"""
import sys

PATH = "/app/vexa-bot/dist/platforms/googlemeet/recording.js"
MARKER = "tryll-leave-guard"


def guarded(reason: str) -> str:
    return (
        f'setTimeout(function(){{ /* {MARKER} */ '
        f'var c = window.getGoogleMeetActiveParticipantsCount ? window.getGoogleMeetActiveParticipantsCount() : 0; '
        f'if (c >= 1) {{ window.logBot("[{MARKER}] {reason} ignored — " + c + " participant(s) still present (false unload)"); return; }} '
        f'window.logBot("[{MARKER}] {reason} confirmed (no participants) — stopping recorder."); '
        f'stopMonitoring("{reason}", () => resolve()); }}, 4000);'
    )


def main() -> int:
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()

    if MARKER in src:
        print("patch-vexa-leave: уже применён")
        return 0

    replacements = [
        ('stopMonitoring("beforeunload", () => resolve());', guarded("beforeunload")),
        ('stopMonitoring("visibility_hidden", () => resolve());', guarded("visibility_hidden")),
    ]

    out = src
    applied = 0
    for old, new in replacements:
        if old in out:
            out = out.replace(old, new)
            applied += 1
        else:
            print(f"patch-vexa-leave: ВНИМАНИЕ — не найдено: {old}")

    if applied == 0:
        print("patch-vexa-leave: нечего патчить (структура файла изменилась?)")
        return 1

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"patch-vexa-leave: применено замен — {applied}/2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
