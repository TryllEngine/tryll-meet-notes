# Дашборд-календарь Tryll Meet Notes (изолированный, read-only к данным).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
COPY public ./public
EXPOSE 8090
CMD ["node", "server.mjs"]
