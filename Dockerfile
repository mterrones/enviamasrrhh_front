FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_AUTH_ENABLED
ARG VITE_INACTIVITY_LOGOUT_MS

RUN set -e; \
    if [ -z "$VITE_API_BASE_URL" ]; then \
        echo "ERROR: VITE_API_BASE_URL build arg is required" >&2; \
        exit 1; \
    fi; \
    export VITE_API_BASE_URL="$VITE_API_BASE_URL"; \
    if [ -n "$VITE_GOOGLE_AUTH_ENABLED" ]; then export VITE_GOOGLE_AUTH_ENABLED="$VITE_GOOGLE_AUTH_ENABLED"; fi; \
    if [ -n "$VITE_INACTIVITY_LOGOUT_MS" ]; then export VITE_INACTIVITY_LOGOUT_MS="$VITE_INACTIVITY_LOGOUT_MS"; fi; \
    npm run build

FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
RUN nginx -t && grep -q 'location = /api' /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ > /dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
