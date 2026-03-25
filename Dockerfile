FROM oven/bun:1.2.5 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV LOG_PATH=/data/logs/mcp.log
ENV LOG_LEVEL=normal
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3000
ENV MCP_HTTP_PATH=/mcp

CMD ["bun", "run", "src/index.ts"]
