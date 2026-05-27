# syntax=docker/dockerfile:1.6
#
# Multi-stage build for the Hoba! webapp.
#
#   * `dev`  — Vite dev server with HMR. Used by docker-compose.yml's
#              default (dev) profile, paired with the source bind mounts
#              defined there. Live edits flow into the container.
#   * `prod` — Pre-built static bundle served by an in-container nginx.
#              Used by compose.shared.yaml (and the bundled-Caddy prod
#              profile once we switch that over too). NO Vite at runtime
#              — `allowedHosts`, module resolution, and HMR can't fail.
#
# Build a specific target manually with:
#   docker buildx build --target prod -t hoba-webapp:prod apps/webapp
# Via compose, set `build.target` in the override file.

# ---------- shared deps layer ----------------------------------------------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json ./
RUN pnpm install --no-frozen-lockfile


# ---------- dev target: Vite dev server -----------------------------------
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev"]


# ---------- prod-builder: emit /app/dist via `pnpm build` -----------------
FROM deps AS builder
# Vite bakes VITE_* env vars into the bundle at BUILD time. The values
# that need to be locked into the artifact are passed as build args
# here. Anything genuinely runtime-only (an API target, an allowed host
# list) does NOT belong in the static bundle.
ARG VITE_TELEGRAM_BOT_USERNAME=hobagame_bot
ARG VITE_TELEGRAM_APP_SHORT_NAME=
ENV VITE_TELEGRAM_BOT_USERNAME=$VITE_TELEGRAM_BOT_USERNAME
ENV VITE_TELEGRAM_APP_SHORT_NAME=$VITE_TELEGRAM_APP_SHORT_NAME
COPY . .
RUN pnpm build


# ---------- prod target: nginx serves the static bundle ------------------
FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
