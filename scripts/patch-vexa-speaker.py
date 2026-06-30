# -*- coding: utf-8 -*-
"""
Патч vexa-bot: НЕ считать собственную плитку бота спикером.

Проблема: бот заходит как участник «Tryll Engine» (display-name socials@). Его
плитка попадает в детекцию говорящих, и куски реальной речи участников
ошибочно приписываются спикеру «Tryll Engine» (видно в транскрипте/Details).

Фикс: в logGoogleSpeakerEvent пропускаем плитку, у которой есть data-self-name
(Google Meet помечает им ЛОКАЛЬНОГО участника, т.е. самого бота) — для неё не
эмитим SPEAKER_START/END, значит её имя не попадёт в спикеры.

Применять внутри vexa-lite (живёт до пересоздания контейнера):
  docker cp scripts/patch-vexa-speaker.py vexa-lite:/tmp/ && \
  docker exec vexa-lite python3 /tmp/patch-vexa-speaker.py
Идемпотентно (маркер tryll-skip-self).
"""
import io, sys

PATH = "/app/vexa-bot/dist/platforms/googlemeet/recording.js"
ANCHOR = (
    "                    function logGoogleSpeakerEvent(participantElement, mutatedClassList) {\n"
    "                        const participantId = getGoogleParticipantId(participantElement);"
)
REPLACE = (
    "                    function logGoogleSpeakerEvent(participantElement, mutatedClassList) {\n"
    "                        /* tryll-skip-self: своя плитка бота (data-self-name) не считается спикером */\n"
    "                        try { if (participantElement.getAttribute('data-self-name')) return; } catch (e) {}\n"
    "                        const participantId = getGoogleParticipantId(participantElement);"
)

src = io.open(PATH, encoding="utf-8").read()
if "tryll-skip-self" in src:
    print("recording.js: already patched (skip-self)")
elif ANCHOR not in src:
    print("recording.js: ANCHOR NOT FOUND — версия Vexa изменилась, патч обновить вручную")
    sys.exit(1)
else:
    io.open(PATH, "w", encoding="utf-8").write(src.replace(ANCHOR, REPLACE))
    print("recording.js: patched — bot's own tile excluded from speakers")
