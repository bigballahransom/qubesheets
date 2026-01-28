'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, UserPlus, Eye, Mail, Phone, Clock } from 'lucide-react';

interface FormSubmission {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  createdAt: string;
}

interface LeadClaimModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission: FormSubmission | null;
  onClaimed: () => void;
}

export default function LeadClaimModal({
  open,
  onOpenChange,
  submission,
  onClaimed,
}: LeadClaimModalProps) {
  const [claiming, setClaiming] = useState(false);
  const router = useRouter();

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleClaim = async () => {
    if (!submission) return;

    setClaiming(true);
    try {
      const response = await fetch(`/api/customers/${submission._id}/claim`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to claim lead');
      }

      toast.success('Lead claimed successfully');
      onClaimed();
      onOpenChange(false);
      router.push(`/customers/${submission._id}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to claim lead');
    } finally {
      setClaiming(false);
    }
  };

  const handleViewOnly = () => {
    if (!submission) return;
    onOpenChange(false);
    router.push(`/customers/${submission._id}`);
  };

  if (!submission) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
          <DialogDescription>
            Would you like to claim this lead or just view it?
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="p-4 bg-gray-50 rounded-lg space-y-2">
            <p className="font-semibold text-gray-900 text-lg">
              {submission.firstName} {submission.lastName}
            </p>

            {submission.email && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="h-4 w-4" />
                {submission.email}
              </div>
            )}

            {submission.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="h-4 w-4" />
                {submission.phone}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="h-4 w-4" />
              Submitted {formatTimeAgo(submission.createdAt)}
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleViewOnly}
            disabled={claiming}
            className="flex-1"
          >
            <Eye className="mr-2 h-4 w-4" />
            View Only
          </Button>
          <Button
            type="button"
            onClick={handleClaim}
            disabled={claiming}
            className="flex-1"
          >
            {claiming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Claiming...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Claim Lead
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
