# Логин-хелпер: headful Chromium (тот же, что у Vexa) + доступ через браузер (noVNC).
# Нужен, чтобы один раз руками залогинить socials@ в постоянный профиль,
# который потом подложим боту. Флаг --password-store=basic делает cookies
# переносимыми (фиксированный ключ шифрования, не зависит от ОС/keyring).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      x11vnc xvfb fluxbox novnc websockify ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 6080
CMD ["/start.sh"]
