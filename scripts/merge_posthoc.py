# -*- coding: utf-8 -*-
"""
Склейка пост-фактум транскрипта начала мита с живой частью.

Вход:
  recordings/head-transcript.json  — verbose_json от whisper (сегменты с start/end в сек)
  recordings/speakers.log          — строки лога бота с SPEAKING START/END (ISO ts + имя)
  recordings/tr-raw.json           — живой транскрипт Vexa (absolute_start_time)
Выход:
  recordings/transcript-full.txt   — "Имя: реплика" с начала записи до конца живой части
"""
import io
import json
import re
from datetime import datetime, timezone

AUDIO_START_MS = 1781098608460  # из лога бота: "Session audio start time set"

def parse_iso(ts: str) -> float:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()

# --- 1. интервалы спикеров из лога ---
events = []  # (epoch_sec, name, is_start)
re_ev = re.compile(r'"ts":"([^"]+)".*?"msg":"SPEAKING (START|END): ([^("]+?)\s*(?:\(|")')
for line in io.open("recordings/speakers.log", encoding="utf-8", errors="replace"):
    m = re_ev.search(line)
    if m:
        events.append((parse_iso(m.group(1)), m.group(3).strip(), m.group(2) == "START"))
events.sort(key=lambda x: x[0])

intervals = []  # (start_epoch, end_epoch, name)
open_starts = {}
for t, name, is_start in events:
    if is_start:
        open_starts[name] = t
    elif name in open_starts:
        intervals.append((open_starts.pop(name), t, name))
for name, t in open_starts.items():
    intervals.append((t, t + 3600, name))
intervals.sort(key=lambda x: x[0])

def speaker_at(t0: float, t1: float) -> str:
    """Спикер с максимальным перекрытием с [t0, t1], иначе ближайший START до t1."""
    best, best_ov = None, 0.0
    for s, e, name in intervals:
        if s > t1:
            break
        ov = min(e, t1) - max(s, t0)
        if ov > best_ov:
            best, best_ov = name, ov
    if best:
        return best
    prior = [(s, name) for s, e, name in intervals if s <= t1]
    return prior[-1][1] if prior else "Unknown"

# --- 2. whisper-сегменты начала → абсолютное время → имена ---
head = json.load(io.open("recordings/head-transcript.json", encoding="utf-8", errors="replace"))

live = json.load(io.open("recordings/tr-raw.json", encoding="utf-8", errors="replace"))
live_segs = live.get("segments", [])
live_start = min(parse_iso(s["absolute_start_time"]) for s in live_segs if s.get("absolute_start_time"))

lines = []
prev = None

def add(speaker: str, text: str) -> None:
    global prev
    text = text.strip().encode("utf-8", "replace").decode("utf-8")
    if not text:
        return
    if speaker == prev and lines:
        lines[-1] += " " + text
    else:
        lines.append(f"{speaker}: {text}")
        prev = speaker

# Спикерская разметка начала невосстановима (Vexa не хранит полный таймлайн),
# поэтому начало идёт текстом без имён, абзацами по ~10 сегментов.
lines.append("[Начало мита — до запуска транскрипции; спикеры не размечены]")
head_count = 0
buf = []
for s in head.get("segments", []):
    t1 = AUDIO_START_MS / 1000 + float(s["end"])
    if t1 >= live_start:  # дальше начинается живой транскрипт — не дублируем
        break
    tx = (s.get("text") or "").strip().encode("utf-8", "replace").decode("utf-8")
    if tx:
        buf.append(tx)
    head_count += 1
    if len(buf) >= 10:
        lines.append(" ".join(buf))
        buf = []
if buf:
    lines.append(" ".join(buf))
lines.append("")
lines.append("[Живая транскрипция — спикеры по именам]")

lines.append("")  # разделитель
prev = None
for s in live_segs:
    add((s.get("speaker") or "Unknown").strip(), s.get("text") or "")

io.open("recordings/transcript-full.txt", "w", encoding="utf-8").write("\n".join(lines))
print(f"head segments used: {head_count}, live segments: {len(live_segs)}, total lines: {len(lines)}")
