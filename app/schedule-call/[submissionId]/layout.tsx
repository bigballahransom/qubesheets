// Branded link previews for the hosted lead scheduler (schedulerUrl sent by
// the embed plugin / external form-submit API).
import type { Metadata } from 'next';
import { Types } from 'mongoose';
import LeadSubmission from '@/models/LeadSubmission';
import { brandedLinkMetadata } from '@/lib/link-preview-branding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}): Promise<Metadata> {
  const { submissionId } = await params;
  return brandedLinkMetadata(
    async () => {
      if (!Types.ObjectId.isValid(submissionId)) return null;
      return LeadSubmission.findById(submissionId)
        .select('organizationId')
        .lean();
    },
    {
      title: (company) => `AI Inventory for ${company}`,
      description: (company) => `Book a video walkthrough with ${company}.`,
    }
  );
}

export default function ScheduleCallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
