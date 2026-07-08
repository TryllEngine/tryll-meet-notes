# -*- coding: utf-8 -*-
# Build-safe патч: FUZZY-сопоставление спикеров (vexa#191) — меньше «записал не в того».
#
# АРХИТЕКТУРА (Meet-пайплайн Vexa): аудио пишется безусловно; бот шлёт
# SPEAKER_START/END по DOM-подсветке активного говорящего; speaker_mapper.py
# сопоставляет whisper-сегмент с окнами активности (кто дольше пересёкся — тот спикер).
#
# ПРОБЛЕМА: DOM-подсветка ЗАПАЗДЫВАЕТ за реальной речью на 200–500мс (официально —
# vexa issue #191). Сопоставление же строгое: короткая реплика («да») кончается ДО
# того, как подсветка загорелась → пересечение 0 → сегмент уходит предыдущему
# говорящему, чья подсветка ещё горела. Это и есть «транскрибация в другого человека».
#
# ФИКС (рекомендация #191 — fuzzy overlap ±500мс, применяем в физически правильную
# сторону, т.к. DOM опаздывает): начало окна каждого кандидата сдвигаем на
# DOM_LAG_FUZZ_MS раньше + пропускаем в кандидаты START, случившийся чуть позже
# конца сегмента. Тай-брейк прежний — самое длинное пересечение. UNKNOWN-фолбэк
# как был. Идемпотентно (маркер tryll-fuzz).
import io, sys

P = "/app/meeting-api/meeting_api/collector/speaker_mapper.py"
src = io.open(P, encoding="utf-8").read()

if "tryll-fuzz" in src:
    print("speaker_mapper.py: fuzz already applied")
    print("speaker-fuzz (build): done")
    sys.exit(0)

# (1) константа лага
a1 = 'POST_SEGMENT_SPEAKER_EVENT_FETCH_MS = 500 # Small buffer after segment end for late-arriving END events\n'
r1 = a1 + (
    "# tryll-fuzz: DOM-индикатор активного говорящего опаздывает за речью на 200-500мс\n"
    "# (vexa#191). Окно кандидата сдвигаем на этот лаг раньше при сопоставлении.\n"
    "DOM_LAG_FUZZ_MS = 500.0\n"
)
if a1 not in src:
    sys.exit("FUZZ: constants anchor not found")
src = src.replace(a1, r1, 1)

# (2) гейт кандидатов: START чуть позже конца сегмента — всё ещё кандидат (лаг DOM)
a2 = (
    '        if event["event_type"] == "SPEAKER_START":\n'
    "            # If this start is before the segment ends, it *could* be the speaker\n"
    "            if event_ts <= segment_end_ms:\n"
)
r2 = (
    '        if event["event_type"] == "SPEAKER_START":\n'
    "            # If this start is before the segment ends, it *could* be the speaker\n"
    "            # tryll-fuzz: +DOM_LAG_FUZZ_MS — подсветка могла загореться уже ПОСЛЕ конца\n"
    "            # короткого сегмента (лаг DOM), такой спикер всё ещё кандидат\n"
    "            if event_ts <= segment_end_ms + DOM_LAG_FUZZ_MS:\n"
)
if a2 not in src:
    sys.exit("FUZZ: candidate-gate anchor not found")
src = src.replace(a2, r2, 1)

# (3) окно пересечения: начало окна кандидата раньше на лаг
a3 = (
    "        overlap_start = max(start_ts, segment_start_ms)\n"
    "        overlap_end = min(end_ts, segment_end_ms)\n"
)
r3 = (
    "        # tryll-fuzz: DOM опаздывает — реальная речь началась раньше подсветки,\n"
    "        # сдвигаем начало окна кандидата на DOM_LAG_FUZZ_MS раньше\n"
    "        overlap_start = max(start_ts - DOM_LAG_FUZZ_MS, segment_start_ms)\n"
    "        overlap_end = min(end_ts, segment_end_ms)\n"
)
if a3 not in src:
    sys.exit("FUZZ: overlap anchor not found")
src = src.replace(a3, r3, 1)

io.open(P, "w", encoding="utf-8").write(src)
print("speaker_mapper.py: fuzzy overlap applied (DOM lag 500ms, per vexa#191)")
print("speaker-fuzz (build): done")
