# ---------- build: client ----------
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---------- build: server ----------
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/package.json ./server/package.json
COPY --from=client-build /app/client/dist ./client/dist
COPY content ./content
ENV PORT=2567
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:2567/health || exit 1
CMD ["node", "server/dist/index.js"]
