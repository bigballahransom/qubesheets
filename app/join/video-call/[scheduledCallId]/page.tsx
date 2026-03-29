import { redirect } from 'next/navigation';
import { verifyJoinToken } from '@/lib/video-call-tokens';
import connectMongoDB from '@/lib/mongodb';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { AlertCircle, Calendar, Clock, XCircle } from 'lucide-react';

interface JoinPageProps {
  params: Promise<{ scheduledCallId: string }>;
  searchParams: Promise<{ t?: string }>;
}

export default async function JoinVideoCallPage({ params, searchParams }: JoinPageProps) {
  const { scheduledCallId } = await params;
  const { t: token } = await searchParams;

  // No token provided
  if (!token) {
    return (
      <ErrorPage
        title="Invalid Link"
        message="This video call link is missing required information. Please use the link from your calendar invite or SMS."
        icon="error"
      />
    );
  }

  // Verify token
  const verified = verifyJoinToken(token);
  if (!verified) {
    return (
      <ErrorPage
        title="Link Expired or Invalid"
        message="This video call link has expired or is invalid. Please contact the organizer for a new link."
        icon="expired"
      />
    );
  }

  // Verify the scheduledCallId in URL matches token
  if (verified.scheduledCallId !== scheduledCallId) {
    return (
      <ErrorPage
        title="Invalid Link"
        message="This video call link is invalid. Please use the link from your calendar invite or SMS."
        icon="error"
      />
    );
  }

  // Look up the scheduled call
  await connectMongoDB();
  const scheduledCall = await ScheduledVideoCall.findById(scheduledCallId);

  if (!scheduledCall) {
    return (
      <ErrorPage
        title="Call Not Found"
        message="This scheduled video call could not be found. It may have been deleted."
        icon="error"
      />
    );
  }

  // Check if call is cancelled
  if (scheduledCall.status === 'cancelled') {
    return (
      <ErrorPage
        title="Call Cancelled"
        message="This video call has been cancelled. Please contact the organizer if you have questions."
        icon="cancelled"
      />
    );
  }

  // Build redirect URL based on role
  const baseUrl = `/video-call/${scheduledCall.roomId}?projectId=${scheduledCall.projectId}`;

  if (verified.role === 'agent') {
    // Agent redirect - include isAgent flag
    redirect(`${baseUrl}&isAgent=true`);
  } else {
    // Customer redirect - include their name
    const encodedName = encodeURIComponent(scheduledCall.customerName);
    redirect(`${baseUrl}&name=${encodedName}`);
  }
}

function ErrorPage({
  title,
  message,
  icon,
}: {
  title: string;
  message: string;
  icon: 'error' | 'expired' | 'cancelled';
}) {
  const IconComponent = icon === 'cancelled' ? XCircle : icon === 'expired' ? Clock : AlertCircle;
  const iconColor = icon === 'cancelled' ? 'text-red-500' : icon === 'expired' ? 'text-amber-500' : 'text-gray-500';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <div className={`mx-auto w-16 h-16 ${iconColor} mb-4`}>
          <IconComponent className="w-full h-full" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          <span>Video Call Link</span>
        </div>
      </div>
    </div>
  );
}
