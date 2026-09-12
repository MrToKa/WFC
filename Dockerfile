FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build \
    && npx tsc -p server/tsconfig.json

FROM node:22-alpine AS api-runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build ["/app/Template files", "./Template files"]

USER node
EXPOSE 4000

CMD ["node", "server/dist/index.js"]

FROM nginx:alpine AS web-runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
