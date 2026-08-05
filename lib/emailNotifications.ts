// lib/emailNotifications.ts
//
// Notification emails via Twilio's unified Email API
// (POST https://comms.twilio.com/v1/Emails) — authenticated with the SAME
// TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN the SMS path already uses, so no
// extra API key is needed. Sender domain qubesheets.com is verified in the
// Twilio console (Email → Domains); the from address is EMAIL_FROM (default
// notifications@qubesheets.com).
//
// The HTML template is the shared brand wrapper for ALL Qube Sheets emails:
// table-based layout with inline styles only (Gmail/Outlook-safe — no
// external CSS, no SVG), reproducing the app wordmark ("qube" in blue-500,
// "sheets" in gray-800 over the yellow highlighter) as pure text.
//
// Missing creds = skipped send with a warning, never a throw — email is an
// additive channel and must not break the SMS path it rides alongside.

export interface SendNotificationEmailOptions {
  to: string;
  subject: string;
  /** Plain-text body. The branded HTML version is generated from it. */
  text: string;
  /** Short event title rendered as the card heading, e.g. "Inventory
   *  updated". Defaults to the subject. */
  heading?: string;
  /** Optional link rendered as a button in the HTML version and appended to
   *  the text version. */
  actionUrl?: string;
  actionLabel?: string;
}

export interface SendNotificationEmailResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'notifications@qubesheets.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Qube Sheets';

// Brand tokens — mirror the app (logo.jsx: blue-500 wordmark, gray-800 text,
// yellow-200 highlighter; UI chrome uses the slate scale).
const BRAND = {
  blue: '#3b82f6',        // blue-500 — wordmark + buttons
  ink: '#1f2937',         // gray-800 — "sheets" + headings
  text: '#334155',        // slate-700 — body copy
  faint: '#94a3b8',       // slate-400 — footer
  highlight: '#fef08a',   // yellow-200 — wordmark highlighter
  cardBorder: '#e2e8f0',  // slate-200
  page: '#f8fafc',        // slate-50
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Shared branded wrapper for all Qube Sheets notification emails.
 * Table-based + fully inline-styled so it renders correctly in Gmail,
 * Outlook, and Apple Mail. Exported so future email types (and previews)
 * reuse the exact same shell.
 */
export function buildNotificationEmailHtml(opts: {
  heading: string;
  text: string;
  previewText: string;
  actionUrl?: string;
  actionLabel?: string;
}): string {
  const bodyHtml = escapeHtml(opts.text).replace(/\n/g, '<br/>');
  const button = opts.actionUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
        <tr>
          <td style="border-radius:8px;background:${BRAND.blue};">
            <a href="${opts.actionUrl}" target="_blank"
               style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${escapeHtml(opts.actionLabel || 'Open project')}
            </a>
          </td>
        </tr>
      </table>`
    : '';

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:${BRAND.page};">
    <!-- Preheader: shows next to the subject in the inbox list, hidden in the body -->
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
      ${escapeHtml(opts.previewText)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.page};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

            <!-- Wordmark -->
            <tr>
              <td style="padding:0 8px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                <span style="color:${BRAND.blue};">qube</span><span style="color:${BRAND.ink};background-color:${BRAND.highlight};padding:0 3px;border-radius:3px;">sheets</span>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background:#ffffff;border:1px solid ${BRAND.cardBorder};border-radius:12px;padding:32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      <p style="margin:0 0 14px;font-size:19px;font-weight:700;color:${BRAND.ink};">
                        ${escapeHtml(opts.heading)}
                      </p>
                      <p style="margin:0;font-size:15px;line-height:1.65;color:${BRAND.text};">
                        ${bodyHtml}
                      </p>
                      ${button}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.faint};">
                You're receiving this because notifications are enabled in your Qube Sheets settings.
                Manage them anytime under <a href="https://app.qubesheets.com/settings/notifications" style="color:${BRAND.faint};text-decoration:underline;">Settings &rarr; Notifications</a>.
                <br/>
                <span style="color:${BRAND.faint};">Qube Sheets &middot; <a href="https://app.qubesheets.com" style="color:${BRAND.faint};text-decoration:underline;">app.qubesheets.com</a></span>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendNotificationEmail({
  to,
  subject,
  text,
  heading,
  actionUrl,
  actionLabel,
}: SendNotificationEmailOptions): Promise<SendNotificationEmailResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.warn('📧 TWILIO_ACCOUNT_SID/AUTH_TOKEN not configured — skipping notification email');
    return { success: false, skipped: true, error: 'Twilio credentials not configured' };
  }

  const fullText = actionUrl ? `${text}\n${actionUrl}` : text;

  try {
    const res = await fetch('https://comms.twilio.com/v1/Emails', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: FROM_EMAIL, name: FROM_NAME },
        to: [{ address: to }],
        content: {
          subject,
          html: buildNotificationEmailHtml({
            heading: heading || subject,
            text,
            previewText: text.split('\n')[0],
            actionUrl,
            actionLabel,
          }),
          text: fullText,
        },
      }),
    });

    // The Email API returns 202 with an operationId on acceptance
    if (res.status === 202 || res.status === 200 || res.status === 201) {
      return { success: true };
    }
    const errBody = await res.text().catch(() => '');
    console.warn(`📧 Twilio email send failed (${res.status}):`, errBody.slice(0, 300));
    return { success: false, error: `Twilio Email ${res.status}` };
  } catch (err) {
    console.error('📧 Twilio email request error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
