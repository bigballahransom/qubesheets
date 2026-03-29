import { createHmac } from 'crypto';

export type JoinRole = 'agent' | 'customer';

interface TokenPayload {
  scheduledCallId: string;
  role: JoinRole;
  exp: number; // Unix timestamp
}

interface VerifiedToken {
  scheduledCallId: string;
  role: JoinRole;
}

const SECRET = process.env.VIDEO_CALL_JOIN_SECRET || process.env.LIVEKIT_API_SECRET || 'dev-secret';

/**
 * Generate a signed join token for a scheduled video call
 * Token is valid from 24h before to 24h after the scheduled time
 */
export function generateJoinToken(
  scheduledCallId: string,
  role: JoinRole,
  scheduledFor: Date
): string {
  // Token expires 24 hours after the scheduled time
  const expiry = new Date(scheduledFor.getTime() + 24 * 60 * 60 * 1000);

  const payload: TokenPayload = {
    scheduledCallId,
    role,
    exp: Math.floor(expiry.getTime() / 1000),
  };

  const payloadString = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(payloadString)
    .digest('base64url');

  return `${payloadString}.${signature}`;
}

/**
 * Verify a join token and extract the payload
 * Returns null if token is invalid, tampered, or expired
 */
export function verifyJoinToken(token: string): VerifiedToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadString, providedSignature] = parts;

    // Verify signature
    const expectedSignature = createHmac('sha256', SECRET)
      .update(payloadString)
      .digest('base64url');

    if (providedSignature !== expectedSignature) {
      console.log('Token signature mismatch');
      return null;
    }

    // Decode payload
    const payload: TokenPayload = JSON.parse(
      Buffer.from(payloadString, 'base64url').toString('utf8')
    );

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      console.log('Token expired');
      return null;
    }

    // Validate role
    if (payload.role !== 'agent' && payload.role !== 'customer') {
      console.log('Invalid role in token');
      return null;
    }

    return {
      scheduledCallId: payload.scheduledCallId,
      role: payload.role,
    };
  } catch (error) {
    console.error('Error verifying join token:', error);
    return null;
  }
}

/**
 * Generate the full join URL with token
 */
export function generateJoinUrl(
  scheduledCallId: string,
  role: JoinRole,
  scheduledFor: Date,
  baseUrl?: string
): string {
  const token = generateJoinToken(scheduledCallId, role, scheduledFor);
  const base = baseUrl || process.env.NEXT_PUBLIC_APP_URL || '';
  return `${base}/join/video-call/${scheduledCallId}?t=${token}`;
}
