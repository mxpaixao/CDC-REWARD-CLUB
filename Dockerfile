# Imagem de produção do app (Next.js standalone).
# O estágio "deps" tem todas as dependências e é usado também para rodar as migrações.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM node:26-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=America/Manaus
RUN addgroup -S clube && adduser -S clube -G clube
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER clube
EXPOSE 3000
CMD ["node", "server.js"]
