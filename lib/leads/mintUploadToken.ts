// lib/leads/mintUploadToken.ts
//
// Wraps the existing upload-link helpers to mint a customer-upload token for a
// freshly provisioned project. The pipeline only calls this when the
// post-submit action is `redirect-chooser`. Token minting failure is part of
// the commit and propagates to the caller.

import {
  createCustomerUploadRecord,
  createUploadUrl,
  generateUploadToken,
} from '@/lib/upload-link-helpers';

export interface MintedToken {
  token: string;
  uploadUrl: string; // /customer-upload/[token]?greeting=lead
}

/**
 * Mint a customer-upload token + URL for a project. Re-throws on failure —
 * the route should treat this as a hard error.
 */
export async function mintUploadToken(params: {
  organizationId: string;
  projectId: string;
  customerName: string;
  customerPhone?: string;
}): Promise<MintedToken> {
  const token = generateUploadToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  await createCustomerUploadRecord({
    projectId: params.projectId,
    userId: 'form-submission',
    organizationId: params.organizationId,
    customerName: params.customerName,
    customerPhone: params.customerPhone ?? '',
    uploadToken: token,
    expiresAt,
  });

  const baseUrl = createUploadUrl(token);
  const uploadUrl = appendGreeting(baseUrl);

  return { token, uploadUrl };
}

function appendGreeting(url: string): string {
  // Personalization marker for the chooser screen
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}greeting=lead`;
}
