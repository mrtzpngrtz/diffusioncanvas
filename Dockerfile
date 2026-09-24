FROM node:20-bookworm-slim

# Install git and ca-certificates for repository cloning and pushes
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Pin Claude Code so Docker rebuilds this layer whenever we deliberately upgrade it.
# Version 2.1.282 supports the currently selectable Claude agent models (2.1.280+ required).
ARG CLAUDE_CODE_VERSION=2.1.282
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && \
    claude --version

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

