# -*- coding: utf-8 -*-
"""Тест вердикта meet-check «жива ли сессия socials@» (auth_state_verdict.py).

    npm run test:auth-verdict
"""
import importlib.util
import sys

sys.stdout.reconfigure(encoding="utf-8")  # вывод по-русски и в консоли Windows
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("auth_state_verdict", HERE / "auth_state_verdict.py")
v = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(v)

AT = "2026-10-13T09:55:30.000Z"
AT_TS = v._epoch(AT)
assert AT_TS > 0, "разбор времени из файла состояния сломан"
EARLIER, LATER = AT_TS - 3600, AT_TS + 3600
state = lambda s: json.dumps({"state": s, "at": AT, "meeting": "https://meet.google.com/abc-defg-hij"})

cases = [
    # (файл состояния, время обновления кук, уровень, слово в тексте, смысл)
    (state("signed_in"), EARLIER, "OK", "жива", "бот залогинен"),
    (state("signed_out"), EARLIER, "ERR", "МЁРТВАЯ", "бот пришёл разлогиненным после последнего логина"),
    (state("reauth_required"), EARLIER, "ERR", "Verify", "Google просит пароль"),
    (state("signed_out"), LATER, "OK", "вылечен", "сбой был ДО свежего логина — не кричим"),
    (state("reauth_required"), LATER, "OK", "вылечен", "то же для «Verify it's you»"),
    (state("signed_out"), 0, "ERR", "МЁРТВАЯ", "время кук неизвестно — кричим, осторожно"),
    (state("unknown"), EARLIER, "OK", "не распознано", "непонятный экран — не тревога, но видно"),
    ("", EARLIER, "OK", "ещё не", "бот ещё ни разу не отчитывался"),
    ("{не json", EARLIER, "OK", "нечитаем", "битый файл не роняет проверку"),
]
for raw, ts, level, word, why in cases:
    got_level, msg = v.verdict(raw, ts)
    assert got_level == level, "%s: ожидали %s, получили %s (%s)" % (why, level, got_level, msg)
    assert word in msg, "%s: в тексте нет «%s»: %s" % (why, word, msg)

print("auth state verdict: PASS (%d случаев)" % len(cases))
