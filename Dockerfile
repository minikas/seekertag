FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG EXPO_PUBLIC_SKR_CLUSTER=devnet
ARG EXPO_PUBLIC_SKR_PROGRAM_ID
ARG EXPO_PUBLIC_SKR_MINT
ARG EXPO_PUBLIC_APP_ORIGIN
RUN npm run build:web

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 DATABASE_PATH=/data/seekertag.sqlite
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server && ln -s server/node_modules node_modules && mkdir /data && chown node:node /data
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --from=web --chown=node:node /app/dist ./dist
USER node
VOLUME ["/data"]
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4318/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
