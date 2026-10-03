import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server";
import { env } from "./config";
import { getUid, uidForToken } from "./db";

const useHttp =
  process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function extractToken(req: http.IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token");
}

/**
 * Resolve o token do request ao uid dono dos dados:
 * - MCP_AUTH_TOKEN (env) → uid admin (ALLOCA_UID/ALLOCA_USER_EMAIL)
 * - demais tokens → chave de usuário em users/{uid}/mcpTokens (SHA-256)
 * Request sem token: sempre 401 (dev local usa stdio, não HTTP).
 */
async function resolveRequestUid(token: string | null): Promise<string | null> {
  if (!token) return null;
  if (env.authToken && token === env.authToken) return getUid();
  return uidForToken(token);
}

async function runHttp() {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "alloca-mcp" }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404).end("Not found");
      return;
    }

    let uid: string | null;
    try {
      uid = await resolveRequestUid(extractToken(req, url));
    } catch (e) {
      console.error("[alloca-mcp] erro de auth:", e);
      uid = null;
    }
    if (!uid) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // stateless: um server+transport por request (padrão recomendado do SDK)
    const server = createServer(uid);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      const body = req.method === "POST" ? await readBody(req) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error("[alloca-mcp] erro no request:", e);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  });

  httpServer.listen(env.port, () => {
    console.error(
      `[alloca-mcp] HTTP em http://localhost:${env.port}/mcp` +
        ` (auth: chaves de usuário${env.authToken ? " + token admin" : ""})`,
    );
  });
}

async function runStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("[alloca-mcp] stdio pronto");
}

runHttpOrStdio().catch((e) => {
  console.error("[alloca-mcp] falha fatal:", e);
  process.exit(1);
});

async function runHttpOrStdio() {
  if (useHttp) return runHttp();
  return runStdio();
}
