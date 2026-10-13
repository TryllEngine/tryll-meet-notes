# -*- coding: utf-8 -*-
"""Вердикт meet-check «жива ли сессия socials@» по файлу, который пишет бот.

    python scripts/auth_state_verdict.py <cookies_mtime_epoch>  < tryll-auth-state.json
    печатает одну строку: "OK <текст>" или "ERR <текст>"

Файл /master-profile/tryll-auth-state.json пишет сам бот в лобби Meet (патч
tryll-authstate): signed_in / signed_out / reauth_required / unknown — это
прямое наблюдение, а не вывод по обрезанным логам (13.10.2026).

Тонкость: после ручного логина файл ещё хранит старый «signed_out», пока не
придёт следующий бот. Поэтому сбой, записанный РАНЬШЕ последнего обновления
кук (логин или обратная запись), считаем уже вылеченным.
"""
import json
import sys
from datetime import datetime


def _epoch(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _hm(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d.%m %H:%M")
    except Exception:
        return "?"


def verdict(raw, cookies_ts):
    raw = (raw or "").strip()
    if not raw:
        return "OK", "бот ещё не отчитывался о входе — появится после первого бота под аккаунтом"
    try:
        d = json.loads(raw)
    except ValueError:
        return "OK", "файл состояния нечитаем — пропущено"
    state, at = d.get("state"), d.get("at", "")
    when = _hm(at)
    healed = cookies_ts and _epoch(at) and _epoch(at) < cookies_ts
    if state == "signed_in":
        return "OK", "сессия socials@ жива — бот %s видел себя залогиненным" % when
    if state in ("signed_out", "reauth_required") and healed:
        return "OK", "сбой %s уже вылечен — куки обновлены позже (логин или запись ботом)" % when
    if state == "signed_out":
        return "ERR", ("сессия socials@ МЁРТВАЯ: бот %s пришёл разлогиненным и стучится гостем. "
                       "Свежий логин через scripts/login-helper (noVNC :6080)" % when)
    if state == "reauth_required":
        return "ERR", ("Google требует подтвердить вход socials@ («Verify it's you») — бот %s упёрся в это. "
                       "Свежий логин через scripts/login-helper (noVNC :6080)" % when)
    return "OK", "состояние входа не распознано (%s, %s) — проверь скриншот лобби бота" % (state, when)


if __name__ == "__main__":
    ts = float(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].strip() else 0.0
    level, msg = verdict(sys.stdin.read(), ts)
    print(level, msg)
