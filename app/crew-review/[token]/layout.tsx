// Branded link previews for sharable crew review links.
import type { Metadata } from 'next';
import CrewReviewLink from '@/models/CrewReviewLink';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return brandedLinkMetadata(
    async () =>
      CrewReviewLink.findOne({ reviewToken: token })
        .select('userId organizationId')
        .lean(),
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) => `Crew inventory review for ${company}.`,
    }
  );
}

export default function CrewReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
