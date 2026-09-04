FROM node:25.8.0-alpine AS build

WORKDIR /app
ARG BMS_ALLOWED_ORIGINS="https://hosxp.net https://had-api.moph.go.th"
ENV IPT_BMS_ALLOWED_ORIGINS="${BMS_ALLOWED_ORIGINS}"

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN node scripts/render-nginx.mjs nginx.conf.template nginx.conf

FROM nginx:1.29.1-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf

RUN mkdir -p /var/cache/nginx /var/run \
    && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
