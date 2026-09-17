// app/api/branding/logo/[key]/route.ts
//
// Public logo endpoint for link-preview branding (lib/link-preview-branding.ts).
// og:image needs a fetchable absolute URL, but Branding.companyLogo may be a
// base64 data URI — this route serves it as a real image. `key` is the
// Branding owner id (organizationId or userId). Logos already render on the
// public token pages, so this exposes nothing new.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Branding from '@/models/Branding';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    if (!key) return new NextResponse(null, { status: 404 });

    await connectMongoDB();
    const branding = (await Branding.findOne({
      $or: [{ organizationId: key }, { userId: key }],
    })
      .select('companyLogo')
      .lean()) as { companyLogo?: string } | null;

    const logo = branding?.companyLogo;
    if (!logo) return new NextResponse(null, { status: 404 });

    if (/^https?:\/\//i.test(logo)) {
      return NextResponse.redirect(logo, { status: 302 });
    }

    const match = logo.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/);
    if (!match) return new NextResponse(null, { status: 404 });

    const buffer = Buffer.from(match[2], 'base64');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': match[1],
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[branding-logo] error serving logo:', error);
    return new NextResponse(null, { status: 404 });
  }
}
