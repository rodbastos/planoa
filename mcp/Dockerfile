# Build a partir da RAIZ do repo (precisa de mcp/ + src/lib/):
#   gcloud builds submit --config mcp/cloudbuild.yaml .
FROM node:20-slim
WORKDIR /app

# deps primeiro (cache de camadas)
COPY mcp/package.json mcp/package-lock.json mcp/
RUN cd mcp && npm ci --omit=dev

# código: lib compartilhada do app + servidor MCP
COPY src/lib src/lib
COPY mcp/src mcp/src
COPY mcp/tsconfig.json mcp/tsconfig.json

WORKDIR /app/mcp
ENV MCP_TRANSPORT=http
# Cloud Run injeta PORT=8080; o servidor usa ADC da service account do serviço
CMD ["npx", "tsx", "src/index.ts", "--http"]
