FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy app source
COPY . .

# Create a writable directory for local file storage (users.json fallback)
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
