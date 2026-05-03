FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev

COPY server ./server
COPY client ./client

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start", "--prefix", "server"]
