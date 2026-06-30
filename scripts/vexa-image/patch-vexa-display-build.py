# -*- coding: utf-8 -*-
# Build-safe версия патча display (без docker exec) — для вшивания в свой образ.
# Логика идентична scripts/patch-vexa-display.sh, но запускается прямо в сборке.
# Чистит зависшие X-локи мёртвых ботов перед выбором per-bot дисплея.
# Идемпотентно (маркер tryll-clean-stale-x).
import io

block = '''  # tryll-clean-stale-x: убрать зависшие X-локи от мёртвых ботов (лок хранит PID
  # X-сервера). Иначе новый бот утыкается в занятый дисплей -> Chrome не стартует.
  for __n in $(seq 101 199); do
    __lk="/tmp/.X$__n-lock"
    if [ -e "$__lk" ]; then
      __pid=$(tr -dc '0-9' < "$__lk" 2>/dev/null)
      if [ -z "$__pid" ] || ! kill -0 "$__pid" 2>/dev/null; then
        rm -f "$__lk" "/tmp/.X11-unix/X$__n" 2>/dev/null
        echo "[lite-slot] removed stale X lock :$__n"
      fi
    fi
  done
'''
anchor = 'if [ "${DISPLAY:-:99}" = ":99" ]; then\n'

patched_any = False
for p in ['/app/vexa-bot/bot-slot-wrapper.sh', '/app/vexa-bot/entrypoint.sh']:
    try:
        s = io.open(p, encoding='utf-8').read()
    except FileNotFoundError:
        print(p + ': not found, skip'); continue
    if 'tryll-clean-stale-x' in s:
        print(p + ': already patched'); patched_any = True; continue
    if anchor not in s:
        print(p + ': ANCHOR NOT FOUND — проверить вручную'); continue
    s = s.replace(anchor, anchor + block, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print(p + ': patched (stale-X cleanup added)'); patched_any = True

if not patched_any:
    raise SystemExit('patch-vexa-display: НИ ОДИН файл не пропатчен — анкер изменился')
print('patch-vexa-display (build): done')
