FROM node:20-bookworm-slim

# Install git and ca-certificates for repository cloning and pushes
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally so the autonomous agent can run in isolated workspaces
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy app source
COPY . .

# Create a writable directory for local file storage (users.json fallback) and agent workspaces
RUN mkdir -p /app/data /tmp/dc-agent-workspaces && \
    chown -R node:node /app/data /tmp/dc-agent-workspaces

# Configure git credentials identity for commits made by the agent
RUN git config --system user.name "Diffusion Canvas Agent" && \
    git config --system user.email "agent@diffusioncanvas.local" && \
    git config --system safe.directory '*'

USER node

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]

