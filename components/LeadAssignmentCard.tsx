'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, User, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AssignedTo {
  userId: string;
  name: string;
  assignedAt: string;
}

interface LeadAssignmentCardProps {
  customerId: string;
  assignedTo?: AssignedTo;
  isFormSubmission: boolean;
  onAssignmentUpdated: (assignedTo: AssignedTo) => void;
}

export default function LeadAssignmentCard({
  customerId,
  assignedTo,
  isFormSubmission,
  onAssignmentUpdated,
}: LeadAssignmentCardProps) {
  const [claiming, setClaiming] = useState(false);
  const { user } = useUser();

  // Only show for form submission customers
  if (!isFormSubmission) return null;

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/claim`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to claim lead');
      }

      const updatedCustomer = await response.json();
      toast.success('Lead claimed successfully');
      onAssignmentUpdated(updatedCustomer.assignedTo);
    } catch (error: any) {
      toast.error(error.message || 'Failed to claim lead');
    } finally {
      setClaiming(false);
    }
  };

  const isAssignedToCurrentUser = assignedTo?.userId === user?.id;

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <User className="h-5 w-5 text-emerald-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Lead Assignment</h2>
      </div>

      {assignedTo ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Claimed by:</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{assignedTo.name}</span>
              {isAssignedToCurrentUser && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                  You
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Claimed:</span>
            <div className="flex items-center gap-1 text-gray-900">
              <Clock className="h-4 w-4 text-gray-400" />
              <span>{formatTimeAgo(assignedTo.assignedAt)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Status:</span>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Unclaimed
            </Badge>
          </div>
          <Button
            onClick={handleClaim}
            disabled={claiming}
            className="w-full"
          >
            {claiming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Claiming...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Claim This Lead
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
