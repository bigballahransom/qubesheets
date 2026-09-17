// Branded link previews for customer upload links (send-upload-link SMS,
// external projects API uploadUrl, SmartMoving webhook uploadUrl).
import type { Metadata } from 'next';
import CustomerUpload from '@/models/CustomerUpload';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return brandedLinkMetadata(
    async () =>
      CustomerUpload.findOne({ uploadToken: token })
        .select('userId organizationId')
        .lean(),
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) =>
        `Share photos and videos of your move with ${company}.`,
    }
  );
}

export default function CustomerUploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
