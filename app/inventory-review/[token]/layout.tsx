// Branded link previews for customer inventory-review links.
import type { Metadata } from 'next';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return brandedLinkMetadata(
    async () =>
      InventoryReviewLink.findOne({ reviewToken: token })
        .select('userId organizationId')
        .lean(),
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) =>
        `Review and approve your moving inventory from ${company}.`,
    }
  );
}

export default function InventoryReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
