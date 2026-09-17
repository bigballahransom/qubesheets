// Branded link previews for public Media Vault share links.
import type { Metadata } from 'next';
import VaultShareLink from '@/models/VaultShareLink';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return brandedLinkMetadata(
    async () =>
      VaultShareLink.findOne({ shareToken: token })
        .select('userId organizationId')
        .lean(),
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) => `Media shared by ${company}.`,
    }
  );
}

export default function VaultReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
