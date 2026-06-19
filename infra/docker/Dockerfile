# syntax=docker/dockerfile:1

FROM node:24-slim AS build

WORKDIR /app
ENV CI=true

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agent-control-plane/db prisma:generate
RUN pnpm build

FROM build AS web

ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

EXPOSE 3100

CMD ["pnpm", "--filter", "@agent-control-plane/web", "start", "--", "-p", "3100", "-H", "0.0.0.0"]

FROM build AS worker

ENV NODE_ENV=production
ENV WORKER_RUN_LOOP=true

CMD ["pnpm", "--filter", "@agent-control-plane/worker", "loop"]
