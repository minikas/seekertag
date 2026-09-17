FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 DATABASE_PATH=/data/seekertag.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --omit=dev --workspace=seekertag-api --workspace=@seekertag/shared --ignore-scripts && mkdir /data && chown node:node /data
COPY --chown=node:node apps/api ./apps/api
COPY --chown=node:node packages/shared ./packages/shared
USER node
VOLUME ["/data"]
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4318/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/index.js"]
