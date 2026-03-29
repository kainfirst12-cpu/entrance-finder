FROM node:18-alpine
RUN apk add --no-cache poppler-utils font-noto-cjk
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3001
CMD ["node", "server.js"]