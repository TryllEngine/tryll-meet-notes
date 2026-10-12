# -*- coding: utf-8 -*-
# Build-safe патч: пропуск бота (MeetingToken) живёт дольше бота, а не 2 часа.
#
# ИНЦИДЕНТ 12.10.2026, «Web site_Front Page». Бот стартовал в 13:55:28 UTC,
# последний кусок записи — 15:55:29. Ровно 2 часа, секунда в секунду. Через 3
# минуты наш раннер счёл его призраком («нет аудио») и выгнал, хотя мит шёл ещё
# полтора часа. Strat Sync 03.09.2026: старт 08:55:07, тишина с 10:55:21 — тоже
# 2 часа (тогда ошибочно списали на память/Xvfb).
#
# ПРИЧИНА (meetings.py): при отправке бота Vexa чеканит ему JWT
#     mint_meeting_token(..., ttl_seconds=7200)
# — жёстко 2 часа, НЕЗАВИСИМО от max_bot_time (у нас 4ч). Этот токен проверяют:
#   • recordings.py   — загрузка кусков записи → 403 «Invalid recording upload token»;
#   • collector/processors.py — приём сегментов транскрипта.
# То есть через 2 часа бот становится ГЛУХИМ: и запись, и реплики отвергаются.
# Наш «лимит 4 часа» поэтому никогда не работал дальше двух.
#
# ФИКС: 6 часов — с запасом над max_bot_time (4ч), чтобы бот гарантированно
# умирал по своему лимиту, а не по протухшему пропуску. Токен локальный
# (HS256 на ADMIN_TOKEN, scope transcribe:write), срок жизни на безопасность
# снаружи не влияет. Маркер tryll-tokenttl; ненайденный якорь роняет сборку.
import io, sys

P = "/app/meeting-api/meeting_api/meetings.py"
src = io.open(P, encoding="utf-8").read()

if "tryll-tokenttl" in src:
    print("meetings.py: token ttl already patched")
    sys.exit(0)

A = "native_meeting_id, ttl_seconds=7200)"
n = src.count(A)
if n != 1:
    sys.exit("TOKENTTL: anchor found %d times (expected 1)" % n)

src = src.replace(A, "native_meeting_id, ttl_seconds=6 * 3600)  # tryll-tokenttl: было 7200 (2ч) — бот глох на 2-м часу", 1)
io.open(P, "w", encoding="utf-8").write(src)
print("meetings.py: meeting token ttl 2h -> 6h")
