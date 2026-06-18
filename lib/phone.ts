// lib/phone.ts
//
// Shared US/Canada phone number helpers. Same logic the in-app modals
// (CreateProjectModal, EditProjectDetailsModal, SendUploadLinkModal, etc.)
// have been duplicating inline — extracted here so the embedded lead form
// matches the rest of the app, and so future code has one source of truth.

/**
 * Progressively format an input value as the user types into a US-style
 * `(XXX) XXX-XXXX` mask. Caps at 10 digits, behaves sanely on backspace.
 */
export function formatPhoneNumber(value: string, previousValue = ''): string {
  const digits = value.replace(/\D/g, '');
  const prevDigits = previousValue.replace(/\D/g, '');
  const isDeleting = digits.length < prevDigits.length;

  const limited = digits.slice(0, 10);

  if (limited.length === 0) return '';

  // Mid-deletion below 4 digits — don't re-add the opening paren the user
  // is trying to erase.
  if (isDeleting && limited.length <= 3) return limited;

  if (limited.length >= 7) {
    return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
  }
  if (limited.length >= 4) {
    return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
  }
  return isDeleting ? limited : `(${limited}`;
}

/**
 * Convert a (possibly formatted) US/Canada phone to E.164 (`+1XXXXXXXXXX`).
 * Returns an empty string when the input doesn't have exactly 10 digits —
 * callers should treat empty as "do not send" rather than persisting an
 * invalid string.
 */
export function formatPhoneToE164(formattedPhone: string): string {
  const digits = formattedPhone.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : '';
}

/**
 * Inline-display the E.164 wire value back into `(XXX) XXX-XXXX` form for
 * pre-filling an input from a stored phone.
 */
export function formatE164ToDisplay(stored: string | undefined): string {
  if (!stored) return '';
  const digits = stored.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return stored;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * Validate that a formatted phone contains a complete 10-digit number.
 * Returns an error string (for inline display) or null when valid/empty.
 * Empty is considered "no error" — required-ness is the caller's concern.
 */
export function validatePhone(formattedPhone: string): string | null {
  if (!formattedPhone) return null;
  const digits = formattedPhone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length !== 10) return 'Phone number must be 10 digits';
  return null;
}
