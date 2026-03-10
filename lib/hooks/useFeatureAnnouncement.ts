'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import {
  CURRENT_APP_VERSION,
  getCurrentAnnouncement,
  isPublicRoute,
  type FeatureAnnouncement,
} from '@/lib/featureAnnouncements';

interface UseFeatureAnnouncementReturn {
  /** Whether to show the announcement popup */
  shouldShow: boolean;
  /** Whether the API call is in progress */
  isLoading: boolean;
  /** The current announcement content */
  currentAnnouncement: FeatureAnnouncement | null;
  /** Mark the current version as seen and close the popup */
  markAsSeen: () => Promise<void>;
  /** Manually dismiss without saving (for error cases) */
  dismiss: () => void;
}

export function useFeatureAnnouncement(): UseFeatureAnnouncementReturn {
  const { isLoaded, user } = useUser();
  const pathname = usePathname();

  const [shouldShow, setShouldShow] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasChecked, setHasChecked] = useState(false);

  const currentAnnouncement = getCurrentAnnouncement();

  // Check if user has seen the current version
  useEffect(() => {
    const checkSeenStatus = async () => {
      // Don't check if not loaded, no user, no pathname, or on public route
      if (!isLoaded || !user || !pathname || isPublicRoute(pathname)) {
        setIsLoading(false);
        setShouldShow(false);
        return;
      }

      // Only check once per session
      if (hasChecked) {
        return;
      }

      try {
        setIsLoading(true);
        const response = await fetch('/api/user/feature-announcements');

        if (!response.ok) {
          throw new Error('Failed to fetch announcement status');
        }

        const data = await response.json();

        // Show popup if user hasn't seen the current version
        setShouldShow(!data.hasSeenCurrent);
        setHasChecked(true);
      } catch (error) {
        console.error('Error checking feature announcement status:', error);
        // On error, don't show the popup (fail silently)
        setShouldShow(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkSeenStatus();
  }, [isLoaded, user, pathname, hasChecked]);

  // Mark the current version as seen
  const markAsSeen = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/user/feature-announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: CURRENT_APP_VERSION }),
      });

      if (!response.ok) {
        throw new Error('Failed to mark announcement as seen');
      }

      setShouldShow(false);
    } catch (error) {
      console.error('Error marking announcement as seen:', error);
      // Still hide the popup even if save fails
      setShouldShow(false);
    }
  }, [user]);

  // Dismiss without saving
  const dismiss = useCallback(() => {
    setShouldShow(false);
  }, []);

  return {
    shouldShow,
    isLoading,
    currentAnnouncement,
    markAsSeen,
    dismiss,
  };
}

export default useFeatureAnnouncement;
