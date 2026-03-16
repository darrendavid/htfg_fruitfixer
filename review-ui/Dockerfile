FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
RUN apt-get update && apt-get install -y libvips-dev python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && \
    npm install --no-save node-addon-api node-gyp && \
    npm_config_build_from_source=true npm rebuild sharp
RUN mkdir -p /data/db
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server/index.js"]
