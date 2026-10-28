# Imagem do backend do avaliador. Build a partir da RAIZ do repositório (o bundle embute web/src/lib):
#   docker build -f backend/Dockerfile -t avaliador-backend .
FROM node:22-alpine AS build
WORKDIR /repo
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --no-audit --no-fund
COPY backend backend
COPY web/src/lib web/src/lib
RUN cd backend && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /repo/backend/package.json ./
COPY --from=build /repo/backend/node_modules node_modules
COPY --from=build /repo/backend/dist dist
COPY --from=build /repo/backend/sql sql
USER node
EXPOSE 3000
# Usa a porta do PORT (o EasyPanel define PORT=80 se não houver outra).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/saude" || exit 1
CMD ["node", "--enable-source-maps", "dist/servidor.mjs"]
