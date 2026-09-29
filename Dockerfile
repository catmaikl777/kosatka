# ============================================================
#  PIXEL ORCA — образ для PaaS (Render / Railway / Fly / Cloud Run)
#  Собирается из корня репозитория: docker build -t kosatka .
#  В образ попадает только нужное для работы: сервер и файлы клиента.
# ============================================================
FROM node:22-alpine

# tini — чтобы SIGTERM доходил до node и база успевала сохраниться при деплое
RUN apk add --no-cache tini

WORKDIR /app

# Зависимости ставятся отдельным слоем: так кэш Docker переживает правки
# кода и не пересобирает npm при каждом деплое. Раньше шага не было вовсе,
# и образ стартовал без pg → CrashLoop при DATABASE_URL.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Копируем только нужное
COPY server ./server
COPY index.html ./index.html
COPY sw.js ./sw.js
COPY manifest.webmanifest ./manifest.webmanifest
COPY css ./css
COPY js ./js
COPY img ./img

# Каталог под базу: на Render/Railway/Fly его нужно смонтировать как volume,
# иначе аккаунты и кланы исчезнут при каждом деплое.
RUN mkdir -p /data && chown -R node:node /data /app
ENV NODE_ENV=production \
    PORT=8081 \
    HOST=0.0.0.0 \
    DATA_FILE=/data/db.json

USER node
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/server.js"]
