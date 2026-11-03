FROM node:24-alpine AS build

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

# Vite bakes this into the bundle at build time. /api is same-origin: Ingress sends it to the backend.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# The PayPal sandbox client ID is public by design, so baking it into the bundle is fine.
# Pass it with --build-arg VITE_PAYPAL_CLIENT_ID=...; empty means "payment unavailable".
ARG VITE_PAYPAL_CLIENT_ID=
ENV VITE_PAYPAL_CLIENT_ID=$VITE_PAYPAL_CLIENT_ID

COPY . .
RUN npm run build


FROM nginxinc/nginx-unprivileged:alpine

# The base image ships a default page next to index.html; serve only the build.
USER root
RUN rm -f /usr/share/nginx/html/50x.html
# A number, not the name nginx: Kubernetes runAsNonRoot can only verify a numeric user.
USER 101

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 8080
