FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples

# Avoid workspace prepare-time CLI compilation during install; we compile all packages explicitly below.
RUN node -e "const fs=require('fs');const p='./packages/cli/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.scripts){delete j.scripts.prepare;}fs.writeFileSync(p,JSON.stringify(j,null,2)+'\\n');"
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b tsconfig.json --force
RUN pnpm --filter @iseemp/web build
RUN pnpm --filter demo-mcp-server build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV ISEEMP_DB=/data/iseemp.db

COPY --from=build /app /app

RUN printf '#!/bin/sh\nexec node /app/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/iseemp \
  && chmod +x /usr/local/bin/iseemp \
  && mkdir -p /data

EXPOSE 7474

CMD ["iseemp", "serve", "--port", "7474", "--db", "/data/iseemp.db"]
