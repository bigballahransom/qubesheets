// Branded link previews for the global org-level self-survey landing page.
// orgId in the path is the Branding owner key (organizationId or userId).
import type { Metadata } from 'next';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<Metadata> {
  const { orgId } = await params;
  return brandedLinkMetadata(
    async () => ({ organizationId: orgId, userId: orgId }),
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) =>
        `Share photos and videos of your move with ${company}.`,
    }
  );
}

export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
