#!/bin/sh
# Пересоздать vexa-lite из СВОЕГО образа (патчи вшиты) + durable-тома.
# Профиль (логин socials@) и патчи переживают пересоздание — лекарство от
# «утренней хрупкости». Перед запуском должен существовать env-файл (снимок env
# текущего контейнера) и тома vexa-lite-recordings + vexa-master-profile.
#
# 1) собрать образ:
#      docker build -f scripts/vexa-image/Dockerfile -t tryll-vexa-lite:latest scripts
# 2) (один раз) снять env и засеять профиль:
#      docker inspect vexa-lite --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v '^$' > vexa.env
#      docker volume create vexa-master-profile
#      docker run --rm -v vexa-lite-recordings:/rec -v vexa-master-profile:/mp \
#        --entrypoint sh tryll-vexa-lite:latest -c 'cp -a /rec/master-profile/. /mp/'
# 3) пересоздать:
set -e
docker stop vexa-lite 2>/dev/null || true
docker rm   vexa-lite 2>/dev/null || true
docker run -d --name vexa-lite \
  --network vexa-network \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:8056:8056 -p 127.0.0.1:8057:8057 \
  --shm-size=2g \
  --env-file vexa.env \
  --env-file scripts/vexa-image/.vexa-secret.env \
  -v vexa-lite-recordings:/var/lib/vexa/recordings \
  -v vexa-master-profile:/master-profile \
  tryll-vexa-lite:latest
echo "vexa-lite пересоздан из tryll-vexa-lite:latest (патчи вшиты, профиль в томе)"
