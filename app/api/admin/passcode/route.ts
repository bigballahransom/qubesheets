// app/api/admin/passcode/route.ts
//
// Second-factor passcode entry for the internal admin dashboard. Only
// allowlisted staff can even attempt it; a correct passcode sets the httpOnly
// cookie the page and every stats API require.
import { NextRequest, NextResponse } from 'next/server';
import {
  isInternalAdmin,
  verifyAdminPasscode,
  adminPasscodeCookieValue,
  ADMIN_PASSCODE_COOKIE,
} from '@/lib/adminAccess';

export async function POST(request: NextRequest) {
  if (!(await isInternalAdmin())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!verifyAdminPasscode(body?.passcode)) {
    return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
  }

  // Session cookie (no maxAge): authorizes the stats APIs for this browser
  // session; the visible prompt re-asks on every /admin visit regardless.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_PASSCODE_COOKIE, adminPasscodeCookieValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return res;
}
