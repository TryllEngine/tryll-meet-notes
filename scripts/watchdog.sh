#!/bin/sh
# Tryll watchdog — держит бота живым без ручного вмешательства.
#
# ЗАЧЕМ: внутри vexa-lite есть runtime_api (:8090) — он запускает контейнеры
# ботов. Он периодически УМИРАЕТ и остаётся лежать, а healthcheck самого
# контейнера проверяет только API заметок (:8056) и этого не видит. Итог:
# «включил Docker, а бот не заходит» (500 Failed to start bot container).
#
# ЧТО ДЕЛАЕТ: раз в минуту пингует runtime_api. Если он не отвечает 2 раза
# подряд (~2 мин) — перезапускает vexa-lite (runtime_api оживает). Плюс раз в
# ~12ч чистит записи старше 5 дней, чтобы хранилище не пухло (раздутые записи
# замедляют/роняют старт runtime_api). Запускается сам с Docker (restart:
# unless-stopped) → после ребута ПК стек сам приходит в рабочее состояние.
#
# Работает как отдельный контейнер (image docker:cli + смонтированный docker.sock).
set -u

RT_CHECK='import urllib.request,sys; urllib.request.urlopen("http://localhost:8090/scheduler/jobs", timeout=6)'
FAILS=0
ITER=0
CLEAN_EVERY=720   # 720 * 60с ≈ 12 часов

echo "$(date -u) tryll-watchdog запущен"
while true; do
  sleep 60
  ITER=$((ITER + 1))

  # 1) Здоровье runtime_api → при смерти перезапускаем vexa-lite
  if docker exec vexa-lite python3 -c "$RT_CHECK" >/dev/null 2>&1; then
    FAILS=0
  else
    FAILS=$((FAILS + 1))
    echo "$(date -u) runtime_api не отвечает ($FAILS/2)"
    if [ "$FAILS" -ge 2 ]; then
      echo "$(date -u) runtime_api МЁРТВ → перезапускаю vexa-lite"
      docker restart vexa-lite >/dev/null 2>&1 || echo "$(date -u) restart не удался"
      FAILS=0
      sleep 180   # дать движку подняться, не долбить проверками
    fi
  fi

  # 2) Периодическая чистка старых записей (профилактика раздутия)
  if [ "$((ITER % CLEAN_EVERY))" -eq 0 ]; then
    echo "$(date -u) чищу записи старше 5 дней"
    docker exec vexa-lite sh -c 'find /var/lib/vexa/recordings/recordings -type f -mtime +5 -delete 2>/dev/null; find /var/lib/vexa/recordings/recordings -mindepth 1 -type d -empty -delete 2>/dev/null' || true
  fi
done
