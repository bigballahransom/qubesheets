'use client';

import React from 'react';
import { useFeatureAnnouncement } from '@/lib/hooks/useFeatureAnnouncement';
import { NewFeaturesModal } from '@/components/modals/NewFeaturesModal';

interface FeatureAnnouncementProviderProps {
  children: React.ReactNode;
}

export function FeatureAnnouncementProvider({ children }: FeatureAnnouncementProviderProps) {
  const { shouldShow, currentAnnouncement, markAsSeen } = useFeatureAnnouncement();

  return (
    <>
      {children}
      {shouldShow && currentAnnouncement && (
        <NewFeaturesModal
          open={shouldShow}
          onDismiss={markAsSeen}
          announcement={currentAnnouncement}
        />
      )}
    </>
  );
}

export default FeatureAnnouncementProvider;
