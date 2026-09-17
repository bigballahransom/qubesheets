// lib/link-preview-branding.ts
//
// Per-org branding for link previews (iMessage, WhatsApp, Slack, etc.) on
// public customer-facing pages. Each public [token]/[roomId]/[orgId] route
// adds a server layout.tsx whose generateMetadata calls brandedLinkMetadata
// with a resolver that maps the URL param to the owning org/user, and copy
// builders for the page's title/description. When the org has a Branding
// record, crawlers see the company name as the title and the company logo
// as the og:image/icon instead of the global Qube Sheets defaults in
// app/layout.tsx. On any failure (bad token, no branding, DB error) we
// return {} so the root-layout metadata applies unchanged.

import type { Metadata } from 'next';
import connectMongoDB from '@/lib/mongodb';
import Branding from '@/models/Branding';

export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.qubesheets.com'
      : 'http://localhost:3000')
  );
}

// Branding docs are keyed by exactly one of organizationId (org accounts) or
// userId (personal accounts). Resolvers return whichever ids they know; when
// both are present we match either field.
export interface BrandingOwner {
  organizationId?: string | null;
  userId?: string | null;
}

interface PageCopy {
  title: (companyName: string) => string;
  description: (companyName: string) => string;
}

export async function brandedLinkMetadata(
  // Typed loosely so layouts can pass mongoose .lean() results directly.
  resolveOwner: () => Promise<unknown>,
  copy: PageCopy
): Promise<Metadata> {
  try {
    await connectMongoDB();

    const owner = (await resolveOwner()) as BrandingOwner | null | undefined;
    const orgId = owner?.organizationId || undefined;
    const userId = owner?.userId || undefined;
    if (!orgId && !userId) return {};

    // Org branding wins over the creator's personal branding, matching how
    // the public pages themselves resolve it (e.g. getCompanyName).
    type LeanBranding = {
      companyName?: string;
      companyLogo?: string;
      organizationId?: string;
      userId?: string;
    } | null;
    const select = 'companyName companyLogo organizationId userId';
    let branding: LeanBranding = null;
    if (orgId) {
      branding = (await Branding.findOne({ organizationId: orgId })
        .select(select)
        .lean()) as LeanBranding;
    }
    if (!branding && userId) {
      branding = (await Branding.findOne({ userId })
        .select(select)
        .lean()) as LeanBranding;
    }

    if (!branding?.companyName) return {};

    const title = copy.title(branding.companyName);
    const description = copy.description(branding.companyName);
    const logoUrl = resolveLogoUrl(
      branding.companyLogo,
      branding.organizationId || branding.userId
    );

    return {
      title,
      description,
      metadataBase: new URL(getBaseUrl()),
      openGraph: {
        title,
        description,
        siteName: branding.companyName,
        ...(logoUrl ? { images: [logoUrl] } : {}),
      },
      twitter: {
        card: 'summary',
        title,
        description,
        ...(logoUrl ? { images: [logoUrl] } : {}),
      },
      ...(logoUrl ? { icons: { icon: logoUrl, apple: logoUrl } } : {}),
    };
  } catch (error) {
    console.warn('[link-preview-branding] falling back to default metadata:', error);
    return {};
  }
}

// og:image must be an absolute URL, but companyLogo may be stored as a base64
// data URI — those are served through the public logo endpoint instead.
function resolveLogoUrl(
  companyLogo: string | undefined,
  brandingKey: string | undefined
): string | null {
  if (!companyLogo || !brandingKey) return null;
  if (/^https?:\/\//i.test(companyLogo)) return companyLogo;
  return `${getBaseUrl()}/api/branding/logo/${encodeURIComponent(brandingKey)}`;
}
