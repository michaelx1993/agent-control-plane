FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV="production"
ENV HOSTNAME="0.0.0.0"
ENV PORT="3112"

EXPOSE 3112

CMD ["pnpm", "--filter", "@agent-control-plane/web", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3112"]
