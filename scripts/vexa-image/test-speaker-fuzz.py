# -*- coding: utf-8 -*-
# Тест fuzzy-сопоставления спикеров (speaker_mapper.map_speaker_to_segment).
# Запуск в контейнере/образе vexa-lite:
#   python3 test-speaker-fuzz.py
# Сценарии:
#   1. «Короткое `да`»: A говорил долго, B бросил короткое «да»; DOM-подсветка B
#      загорелась с лагом ПОСЛЕ конца сегмента. Ожидание ПОСЛЕ фикса: сегмент -> B.
#      (До фикса уходил A — «записал не в того».)
#   2. «Мигнула чужая плитка»: A говорит весь сегмент, C мигнул на 300мс (эхо).
#      Ожидание: сегмент -> A (длинное пересечение побеждает), фикс не ломает.
#   3. «Обычный мит»: один спикер в окне сегмента -> MAPPED на него.
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "speaker_mapper", "/app/meeting-api/meeting_api/collector/speaker_mapper.py")
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)

def ev(t, typ, name):
    return (json.dumps({"event_type": typ, "participant_name": name,
                        "participant_id_meet": name.lower()}), float(t))

fails = 0

def check(label, got, want):
    global fails
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {label}: got={got!r} want={want!r}")
    if not ok:
        fails += 1

# 1) короткое «да»: A[300..10400], B START в 10500 (лаг DOM), сегмент [10100..10450]
events = [ev(300, "SPEAKER_START", "Alice"), ev(10400, "SPEAKER_END", "Alice"),
          ev(10500, "SPEAKER_START", "Bob")]
r = sm.map_speaker_to_segment(10100, 10450, events)
check("short 'да' goes to Bob", r["speaker_name"], "Bob")

# 2) флик чужой плитки: A[0..5000], C мигнул [2000..2300], сегмент [0..5000]
events = [ev(0, "SPEAKER_START", "Alice"), ev(5000, "SPEAKER_END", "Alice"),
          ev(2000, "SPEAKER_START", "Carl"), ev(2300, "SPEAKER_END", "Carl")]
r = sm.map_speaker_to_segment(0, 5000, events)
check("flicker still maps to Alice", r["speaker_name"], "Alice")

# 3) обычный случай: один спикер
events = [ev(1000, "SPEAKER_START", "Alice"), ev(9000, "SPEAKER_END", "Alice")]
r = sm.map_speaker_to_segment(2000, 4000, events)
check("single speaker MAPPED", (r["speaker_name"], r["status"]), ("Alice", sm.STATUS_MAPPED))

# 4) никого нет -> UNKNOWN (фолбэк не сломан)
events = [ev(90000, "SPEAKER_START", "Alice")]
r = sm.map_speaker_to_segment(1000, 2000, events)
check("no overlap -> UNKNOWN", r["status"], sm.STATUS_UNKNOWN)

sys.exit(1 if fails else 0)
