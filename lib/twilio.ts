import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  throw new Error('Missing Twilio configuration');
}

const client = twilio(accountSid, authToken);

interface SmsResult {
  success: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * Send an SMS with retry logic for transient failures.
 * Retries up to maxRetries times on 5xx errors or rate limits.
 */
async function sendSmsWithRetry(
  body: string,
  to: string,
  maxRetries: number = 2
): Promise<SmsResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await client.messages.create({
        body,
        from: twilioPhoneNumber,
        to,
      });
      return { success: true };
    } catch (err: any) {
      const statusCode = err.status || err.code;
      const isRetryable =
        (typeof statusCode === 'number' && statusCode >= 500) ||
        err.code === 20429;

      if (!isRetryable || attempt === maxRetries) {
        return {
          success: false,
          error: err.message || 'Unknown Twilio error',
          errorCode: String(statusCode || 'unknown'),
        };
      }

      const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return { success: false, error: 'Max retries exceeded', errorCode: 'max_retries' };
}

export { client, twilioPhoneNumber, sendSmsWithRetry };
export type { SmsResult };