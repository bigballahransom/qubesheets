// Branded link previews for scheduled-call join links (customerJoinLink /
// agentJoinLink — sent by scheduling SMS and returned by the external API).
import type { Metadata } from 'next';
import { Types } from 'mongoose';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scheduledCallId: string }>;
}): Promise<Metadata> {
  const { scheduledCallId } = await params;
  return brandedLinkMetadata(
    async () => {
      if (!Types.ObjectId.isValid(scheduledCallId)) return null;
      return ScheduledVideoCall.findById(scheduledCallId)
        .select('userId organizationId')
        .lean();
    },
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) => `Join your video walkthrough with ${company}.`,
    }
  );
}

export default function JoinVideoCallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
