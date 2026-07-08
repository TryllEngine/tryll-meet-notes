# Свой образ vexa-lite с ВШИТЫМИ патчами Tryll.
# Зачем: патчи перестают слетать при пересоздании контейнера (главная причина
# «утренней хрупкости»). Раньше патчи накладывались в рантайме (docker exec) и
# жили только в одноразовом слое контейнера — любой recreate их стирал.
#
# Сборка (контекст = каталог scripts/):
#   docker build -f scripts/vexa-image/Dockerfile -t tryll-vexa-lite:latest scripts
#
# Профиль (/master-profile) сюда НЕ вшиваем — он живёт в отдельном volume,
# чтобы переживать и пересоздание, и пересборку образа.
FROM vexaai/vexa-lite:latest

COPY patch_vexa_auth.py patch-vexa-speaker.py patch-vexa-leave.py /tryll-patches/
COPY vexa-image/patch-vexa-display-build.py vexa-image/patch-vexa-camera-build.py vexa-image/patch-vexa-writeback-build.py vexa-image/patch-vexa-accountchooser-build.py vexa-image/patch-vexa-cameralogo-build.py /tryll-patches/

# Наш логотип как дефолтный аватар камеры (надёжно, локально, без сети)
COPY vexa-image/bot-avatar.png /app/vexa-bot/assets/vexa-logo-default.png

# Накладываем тот же набор, что проверен в проде. Любой сбой анкера -> падение
# сборки (узнаем сразу, а не утром на мите). write-back ПОСЛЕ auth (зависит от
# __botDir, который создаёт auth-патч).
RUN python3 /tryll-patches/patch_vexa_auth.py \
 && python3 /tryll-patches/patch-vexa-speaker.py \
 && python3 /tryll-patches/patch-vexa-leave.py \
 && python3 /tryll-patches/patch-vexa-display-build.py \
 && python3 /tryll-patches/patch-vexa-camera-build.py \
 && python3 /tryll-patches/patch-vexa-writeback-build.py \
 && python3 /tryll-patches/patch-vexa-accountchooser-build.py \
 && python3 /tryll-patches/patch-vexa-cameralogo-build.py \
 && echo "tryll patches baked OK"
