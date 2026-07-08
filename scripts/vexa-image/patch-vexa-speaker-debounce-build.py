# -*- coding: utf-8 -*-
# Build-safe патч: ДЕБАУНС спикер-событий (уменьшить путаницу "кто говорит").
#
# ПРОБЛЕМА: Vexa берёт спикера из DOM-подсветки активного говорящего Google Meet.
# recording.js эмитит SPEAKER_START/END МГНОВЕННО на любое мерцание класса. Короткая
# подсветка чужой плитки (эхо/кашель/шум ~100-300мс) сразу приписывает сегмент не
# тому человеку. Конфиг-кнопки точности в Vexa НЕТ — сглаживание надо добавить сами.
#
# ФИКС: SPEAKER_START эмитим только если речь держится >= START_MS; SPEAKER_END —
# только после тишины >= END_MS. Короткие мерцания гасятся (таймер отменяется).
# Таймеры на window.__tryllSpkT (переживают вызовы observer'а).
#
# ВНИМАНИЕ: это МИТИГЕЙШН, не гарантированный фикс — проверять на реальных митах
# (можно подкрутить START_MS/END_MS). Диаризация по DOM в принципе неидеальна.
# Идемпотентно (маркер tryll-debounce).
import io, sys

P = "/app/vexa-bot/dist/platforms/googlemeet/recording.js"
src = io.open(P, encoding="utf-8").read()

if "tryll-debounce" in src:
    print("recording.js: debounce already applied")
    print("debounce (build): done")
    sys.exit(0)

# (1) helper-функция — вставляем после skip-self строки (наш маркер уже есть в файле)
skip = "try { if (participantElement.getAttribute('data-self-name')) return; } catch (e) {}"
helper = (
    "\n                        /* tryll-debounce: гасим короткие мерцания подсветки (эхо/кашель),\n"
    "                           SPEAKER_START только при устойчивой речи, END — при устойчивой тишине. */\n"
    "                        if (!window.__tryllSpkT) window.__tryllSpkT = new Map();\n"
    "                        function __tryllSpk(type, el, id, name) {\n"
    "                            const t = window.__tryllSpkT.get(id) || {};\n"
    "                            const speakingNow = () => { try { return hasSpeakingIndicator(el) || inferSpeakingFromClasses(el).speaking; } catch (e) { return false; } };\n"
    "                            if (type === 'SPEAKER_START') {\n"
    "                                if (t.end) { clearTimeout(t.end); t.end = null; }\n"
    "                                if (t.emitted) { window.__tryllSpkT.set(id, t); return; }\n"
    "                                if (!t.start) t.start = setTimeout(() => { t.start = null; if (speakingNow()) { t.emitted = true; sendGoogleSpeakerEvent('SPEAKER_START', el); } window.__tryllSpkT.set(id, t); }, 450);\n"
    "                            } else {\n"
    "                                if (t.start) { clearTimeout(t.start); t.start = null; }\n"
    "                                if (!t.emitted) { window.__tryllSpkT.set(id, t); return; }\n"
    "                                if (!t.end) t.end = setTimeout(() => { t.end = null; if (!speakingNow()) { t.emitted = false; sendGoogleSpeakerEvent('SPEAKER_END', el); } window.__tryllSpkT.set(id, t); }, 700);\n"
    "                            }\n"
    "                            window.__tryllSpkT.set(id, t);\n"
    "                        }"
)
if skip not in src:
    sys.exit("DEBOUNCE: skip-self anchor not found (speaker patch не наложен?)")
src = src.replace(skip, skip + helper, 1)

# (2) заменяем прямые эмиты на дебаунс-обёртку
s1 = "sendGoogleSpeakerEvent('SPEAKER_START', participantElement);"
r1 = "__tryllSpk('SPEAKER_START', participantElement, participantId, participantName); /* tryll-debounce */"
s2 = "sendGoogleSpeakerEvent('SPEAKER_END', participantElement);"
r2 = "__tryllSpk('SPEAKER_END', participantElement, participantId, participantName); /* tryll-debounce */"
if s1 not in src or s2 not in src:
    sys.exit("DEBOUNCE: SPEAKER_START/END call anchor not found")
src = src.replace(s1, r1, 1)
src = src.replace(s2, r2, 1)

io.open(P, "w", encoding="utf-8").write(src)
print("recording.js: speaker debounce injected (START>=450ms, END>=700ms)")
print("debounce (build): done")
