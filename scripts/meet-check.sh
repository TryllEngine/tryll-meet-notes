#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Проверка готовности стека Tryll Meet Notes после запуска Docker.
# Запусти после старта Docker (за ~30 мин до первого мита):
#   bash scripts/meet-check.sh
# Заодно ПРОАКТИВНО чистит зависшие X-локи (та самая утренняя проблема).
# В конце говорит "ВСЁ ГОТОВО" или показывает, что не так.
# ─────────────────────────────────────────────────────────────────────────────
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1
KEY=$(grep -E '^VEXA_API_KEY=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r')
bad=0
ok(){ echo "  ✅ $1"; }
err(){ echo "  ❌ $1"; bad=$((bad+1)); }

echo "── Контейнеры ──"
for c in vexa-postgres vexa-lite transcription-lb transcription-worker-1 transcription-worker-2 tryll-runner; do
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
  h=$(docker inspect -f '{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$c" 2>/dev/null)
  if [ "$st" = running ] && { [ -z "$h" ] || [ "$h" = "/healthy" ]; }; then ok "$c: running$h"; else err "$c: $st$h"; fi
done

echo "── Патчи бота (vexa-lite) ──"
check_patch(){ docker exec vexa-lite grep -q "$1" "$2" 2>/dev/null && ok "$3" || err "$3 — ПАТЧ ОТСУТСТВУЕТ"; }
check_patch "tryll local profile" /app/vexa-bot/dist/index.js "auth (профиль socials@)"
# join.js НАМЕРЕННО не патчится с 26.06: вернули штатный «Ask to join» (внешний
# организатор → бот стучится и ждёт впуска). Раньше здесь искался маркер
# «tryll knock-if-external» — удалённый патч, из-за чего проверка вечно горела
# красным. Проверяем то, что реально важно: штатная логика входа на месте.
check_patch "Ask to join" /app/vexa-bot/dist/platforms/googlemeet/join.js "join (штатный «Ask to join»)"
check_patch "tryll-leave-guard" /app/vexa-bot/dist/platforms/googlemeet/recording.js "leave-guard"
check_patch "tryll fullframe" /app/vexa-bot/dist/services/screen-content.js "camera (логотип)"
check_patch "tryll-clean-stale-x" /app/vexa-bot/bot-slot-wrapper.sh "auto-clean X locks"

echo "── Чистка зависших X-локов ──"
removed=$(docker exec vexa-lite sh -c 'r=0; for n in $(seq 101 199); do lk=/tmp/.X$n-lock; if [ -e "$lk" ]; then pid=$(tr -dc 0-9 <"$lk" 2>/dev/null); if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then rm -f "$lk" /tmp/.X11-unix/X$n 2>/dev/null; r=$((r+1)); fi; fi; done; echo $r' 2>/dev/null)
ok "удалено зависших дисплеев: ${removed:-0}"

echo "── Раннер ──"
docker logs tryll-runner --since 5m 2>&1 | grep -qiE 'tick error|unhandled|exception' && err "раннер: ошибки за 5 мин" || ok "раннер: ошибок нет"

echo "── Vexa API / токен / GPU ──"
curl -sf -m 5 http://localhost:8056/bots/status -H "X-API-Key: $KEY" >/dev/null 2>&1 && ok "Vexa API отвечает" || err "Vexa API недоступен"
docker exec tryll-runner sh -c 'test -n "$CLAUDE_CODE_OAUTH_TOKEN"' 2>/dev/null && ok "Claude-токен на месте" || err "Claude-токен ОТСУТСТВУЕТ"

echo "─────────────────────────────"
if [ "$bad" -eq 0 ]; then echo "🟢 ВСЁ ГОТОВО — миты записываются"; else echo "🔴 ПРОБЛЕМ: $bad (см. ❌ выше)"; fi
exit "$bad"
