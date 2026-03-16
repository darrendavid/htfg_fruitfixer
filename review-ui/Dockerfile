FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
RUN mkdir -p /data/db /data/logs
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server/index.js"]
