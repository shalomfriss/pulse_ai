FROM node:22.19-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV LOCAL_MYSQL_PROXY_URL=http://127.0.0.1:8789
EXPOSE 3000

CMD ["npm", "run", "start:mysql"]
