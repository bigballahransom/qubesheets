// app/api/mcp/[token]/route.ts
//
// Token-in-path variant of the MCP server for clients that cannot send an
// Authorization header: claude.ai custom connectors ("No sign-in" mode),
// ChatGPT connectors, and Claude Desktop. The path segment must be a
// qbsmcp_ connector token (minted on the AI Connectors settings page);
// qbs_ partner API keys are deliberately REJECTED here so the org's master
// REST credential never rides in URLs (request paths land in server logs).
//
// Treat the full URL as a password: anyone holding it has read access to the
// org's Qube Sheets data until the token is revoked.

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

async function verifyPathToken(req: Request): Promise<AuthInfo | undefined> {
  // Path shape: /api/mcp/<token>
  const segments = new URL(req.url).pathname.split('/').filter(Boolean);
  const token = segments[segments.length - 1] || '';

  // Only dedicated connector tokens are URL-safe credentials.
  if (!token.startsWith('qbsmcp_')) return undefined;

  const ctx = await verifyMcpToken(token);
  if (!ctx) return undefined;
  return {
    token,
    clientId: ctx.apiKeyId,
    scopes: ctx.scopes,
    extra: { organizationId: ctx.organizationId, apiKeyId: ctx.apiKeyId },
  };
}

const authedHandler = withMcpAuth(handler, verifyPathToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
