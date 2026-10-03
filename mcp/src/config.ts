import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, "..");

// .env do mcp/ primeiro; depois o .env do app (só p/ VITE_FIREBASE_PROJECT_ID)
for (const p of [path.join(mcpDir, ".env"), path.join(mcpDir, "..", ".env")]) {
  try {
    process.loadEnvFile(p);
  } catch {
    // arquivo ausente — ok
  }
}

export const env = {
  serviceAccountPath:
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT,
  serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  projectId:
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  allocaUid: process.env.ALLOCA_UID,
  allocaUserEmail: process.env.ALLOCA_USER_EMAIL,
  authToken: process.env.MCP_AUTH_TOKEN,
  port: Number(process.env.PORT ?? 8787),
};
