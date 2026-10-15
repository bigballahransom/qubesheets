// app/api/mcp/route.ts
//
// The Qube Sheets remote MCP server (streamable HTTP, stateless, mcp-handler
// v2). Auth: Bearer token in the Authorization header - either a qbsmcp_
// connector token or an existing qbs_ partner API key. Clients that cannot
// send headers (claude.ai, ChatGPT connectors) use the token-in-path variant
// at /api/mcp/[token]/route.ts, which wraps this same handler.
//
// Deliberately NO OAuth discovery metadata here: advertising
// /.well-known/oauth-protected-resource makes Cursor and copilot-cli ignore
// configured bearer headers and chase a nonexistent OAuth flow. When OAuth
// ships, it gets its own route.

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerQubeSheetsTools, MCP_SERVER_INSTRUCTIONS } from '@/lib/mcp/tools';

export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerQubeSheetsTools(server);
  },
  {
    serverInfo: { name: 'qubesheets', version: '1.0.0' },
    instructions: MCP_SERVER_INSTRUCTIONS,
  }
);

async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const ctx = await verifyMcpToken(bearerToken);
  if (!ctx) return undefined;
  return {
    token: bearerToken,
    clientId: ctx.apiKeyId,
    scopes: ctx.scopes,
    extra: { organizationId: ctx.organizationId, apiKeyId: ctx.apiKeyId },
  };
}

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
