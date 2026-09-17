// Branded link previews for customer video-call SMS links.
// roomId is minted as `${projectId}-${timestamp}-${random}` (lib/livekit.ts),
// so the owning project — and its org's branding — is recoverable server-side.
import type { Metadata } from 'next';
import { Types } from 'mongoose';
import Project from '@/models/Project';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;
  return brandedLinkMetadata(
    async () => {
      const projectId = roomId?.split('-')[0];
      if (!projectId || !Types.ObjectId.isValid(projectId)) return null;
      return Project.findById(projectId).select('userId organizationId').lean();
    },
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) => `Join your video walkthrough with ${company}.`,
    }
  );
}

export default function VideoCallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
