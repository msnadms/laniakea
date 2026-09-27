FROM node:22-slim

WORKDIR /app
RUN npm install --no-save --no-package-lock d3-delaunay@^6.0.4

COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev

COPY src/game src/game
COPY server/tsconfig.json server/
COPY server/src server/src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "--prefix", "server", "start"]
