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

echo "── Заходит ли бот вообще ──"
# 09.09.2026: Google выкатил на socials@ флаг «Verify it's you» — бот доходил до
# экрана переподтверждения пароля, ввести его не мог и выходил. ШЕСТЬ митов за день
# легли с пустым транскриптом, а эта проверка всё утро показывала 🟢: контейнеры,
# патчи и API были в порядке, а вот ЗАХОДИТ ли бот — никто не смотрел.
# Логика: смотрим ПОСЛЕДНИЕ 3 завершённых мита. Все три упали — бот не заходит.
# Не окно по времени: иначе после починки проверка ещё сутки держала бы красный,
# а один успешный мит гасит тревогу сразу.
verdict=$(docker exec tryll-runner sh -c 'cat /data/store.json' 2>/dev/null | PYTHONIOENCODING=utf-8 python -c '
import sys, json
try: s = json.load(sys.stdin)
except Exception: print("SKIP"); raise SystemExit
ms = [v for v in (s.get("meetings") or {}).values()
      if v.get("status") in ("done", "failed") and (v.get("startISO") or "")]
ms.sort(key=lambda v: v["startISO"])
last = ms[-3:]
if not last: print("SKIP"); raise SystemExit
failed = [v for v in last if v["status"] == "failed"]
if len(failed) == len(last) and len(last) >= 2:
    print("FAIL подряд упало митов: %d (последний — %s)" % (len(failed), last[-1].get("title") or "?"))
elif failed:
    print("WARN из последних %d митов упало %d" % (len(last), len(failed)))
else:
    print("OK последние %d мита записаны" % len(last))
' 2>/dev/null)
case "${verdict:-SKIP}" in
  FAIL*) err "история: ${verdict#FAIL } → бот, похоже, НЕ ЗАХОДИТ. Обычная причина — Google просит «Verify it's you» у socials@: посмотри /app/storage/screenshots/bot-checkpoint-auth-lobby.png, и если там экран переподтверждения — свежий ручной логин через scripts/login-helper (noVNC :6080). Это оценка по прошлым митам: гаснет после первого удачного" ;;
  WARN*) ok "${verdict#WARN } (часть митов падает — посмотри причины)" ;;
  OK*)   ok "${verdict#OK }" ;;
  *)     ok "история митов недоступна — пропущено" ;;
esac

echo "── Vexa API / токен / GPU ──"
curl -sf -m 5 http://localhost:8056/bots/status -H "X-API-Key: $KEY" >/dev/null 2>&1 && ok "Vexa API отвечает" || err "Vexa API недоступен"
docker exec tryll-runner sh -c 'test -n "$CLAUDE_CODE_OAUTH_TOKEN"' 2>/dev/null && ok "Claude-токен на месте" || err "Claude-токен ОТСУТСТВУЕТ"

echo "─────────────────────────────"
if [ "$bad" -eq 0 ]; then echo "🟢 ВСЁ ГОТОВО — миты записываются"; else echo "🔴 ПРОБЛЕМ: $bad (см. ❌ выше)"; fi
exit "$bad"
