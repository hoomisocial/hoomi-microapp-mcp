ARG NODE_IMAGE=node:22.23.2-bookworm-slim

# The Hoomi SDK source the hoomi_sdk_* tools read. Pin HOOMI_SDK_REF to a tag or
# commit for a reproducible image, and set HOOMI_SDK_SOURCE_DIGEST to match it
# (required in production).
FROM ${NODE_IMAGE} AS sdk-source
ARG HOOMI_SDK_REPOSITORY=https://github.com/hoomisocial/hoomi-microapps-sdk-js.git
ARG HOOMI_SDK_REF=master
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# git has no retry option of its own; a flaky DNS lookup should not fail the build.
RUN git init -q -b main /opt/hoomi-sdk-source \
    && git -C /opt/hoomi-sdk-source remote add origin "${HOOMI_SDK_REPOSITORY}" \
    && for attempt in 1 2 3 4 5; do \
        git -C /opt/hoomi-sdk-source fetch --depth 1 origin "${HOOMI_SDK_REF}" && break; \
        [ "$attempt" = 5 ] && exit 1; \
        echo "git fetch failed (attempt $attempt), retrying in 5s"; sleep 5; \
    done \
    && git -C /opt/hoomi-sdk-source checkout -q --detach FETCH_HEAD \
    && rm -rf /opt/hoomi-sdk-source/.git

FROM ${NODE_IMAGE} AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8300

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=sdk-source /opt/hoomi-sdk-source /opt/hoomi-sdk-source

USER node
EXPOSE 8300

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
