'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import LeadClaimModal from '@/components/modals/LeadClaimModal';

interface AssignedTo {
  userId: string;
  name: string;
  assignedAt: string;
}

interface FormSubmission {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  createdAt: string;
  assignedTo?: AssignedTo;
}

export function FormNotificationBell() {
  const [formSubmissions, setFormSubmissions] = useState<FormSubmission[]>([]);
  const [open, setOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevUnclaimedIdsRef = useRef<Set<string>>(new Set());
  const isFirstFetchRef = useRef<boolean>(true);

  // Initialize and preload audio
  useEffect(() => {
    const audio = new Audio('/happy-bell-alert.wav');
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;
  }, []);

  // Play sound when new submissions arrive
  const playNotificationSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Audio play may fail due to autoplay policy - that's ok
      });
    }
  };

  // Poll for form submissions
  useEffect(() => {
    const fetchFormSubmissions = async () => {
      try {
        const response = await fetch('/api/notifications/form-submissions');
        if (response.ok) {
          const data: FormSubmission[] = await response.json();

          // Get current unclaimed IDs
          const currentUnclaimedIds = new Set(
            data.filter(s => !s.assignedTo).map(s => s._id)
          );

          // Check for new unclaimed submissions (not seen before)
          if (!isFirstFetchRef.current) {
            const newUnclaimed = [...currentUnclaimedIds].filter(
              id => !prevUnclaimedIdsRef.current.has(id)
            );
            if (newUnclaimed.length > 0) {
              playNotificationSound();
            }
          }

          // Update previous unclaimed IDs
          prevUnclaimedIdsRef.current = currentUnclaimedIds;
          isFirstFetchRef.current = false;

          setFormSubmissions(data);
        }
      } catch (err) {
        console.error('Error fetching form submissions:', err);
      }
    };

    fetchFormSubmissions();
    const interval = setInterval(fetchFormSubmissions, 10000);
    return () => clearInterval(interval);
  }, []);

  // Count unclaimed submissions
  const unclaimedCount = formSubmissions.filter(s => !s.assignedTo).length;

  // Animation key to re-trigger bell animation periodically
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    if (unclaimedCount > 0) {
      // Re-trigger animation every 5 seconds
      const interval = setInterval(() => {
        setAnimationKey(k => k + 1);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [unclaimedCount]);

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

  const handleOpen = () => {
    setOpen(true);
  };

  const handleNotificationClick = (submission: FormSubmission) => {
    setSelectedSubmission(submission);
    setClaimModalOpen(true);
  };

  const handleLeadClaimed = () => {
    // Update the submission in the list to mark as claimed
    if (selectedSubmission) {
      setFormSubmissions(prev =>
        prev.map(s =>
          s._id === selectedSubmission._id
            ? { ...s, assignedTo: { userId: '', name: 'You', assignedAt: new Date().toISOString() } }
            : s
        )
      );
    }
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Form submissions notifications"
      >
        <Bell
          key={animationKey}
          className={`h-5 w-5 text-blue-700 ${unclaimedCount > 0 ? 'animate-ring' : ''}`}
        />
        {unclaimedCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unclaimedCount > 9 ? '9+' : unclaimedCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0">
          <SheetHeader className="p-4 border-b bg-gray-50">
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {formSubmissions.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No notifications yet</p>
                <p className="text-sm mt-1">Updates will appear here</p>
              </div>
            ) : (
              <div className="divide-y">
                {formSubmissions.map((submission) => {
                  const isUnclaimed = !submission.assignedTo;
                  return (
                    <div
                      key={submission._id}
                      onClick={() => handleNotificationClick(submission)}
                      className={`p-4 cursor-pointer transition-colors ${
                        isUnclaimed
                          ? 'bg-blue-50 hover:bg-blue-100'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-600">
                            New lead from website form
                          </p>
                          <p className="font-medium text-gray-900 mt-0.5">
                            {submission.firstName} {submission.lastName}
                          </p>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {submission.email || submission.phone || 'No contact info'}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatTimeAgo(submission.createdAt)}
                          </p>
                        </div>
                        {isUnclaimed ? (
                          <span className="shrink-0 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                            Unclaimed
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                            Claimed
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <LeadClaimModal
        open={claimModalOpen}
        onOpenChange={setClaimModalOpen}
        submission={selectedSubmission}
        onClaimed={handleLeadClaimed}
      />
    </>
  );
}
