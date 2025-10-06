'use client';

import { useEffect } from 'react';

export default function EmergencyCleanup() {
  useEffect(() => {
    // Dynamically import the emergency cleanup system
    import('@/lib/emergency-cleanup').then((module) => {
      console.log('🚨 Emergency cleanup system loaded');
      
      // Make cleanup functions available globally for debugging
      if (typeof window !== 'undefined') {
        (window as any).emergencyCleanup = module.emergencyCleanupAll;
        (window as any).getCleanupStats = module.getCleanupStats;
      }
    }).catch((error) => {
      console.error('Failed to load emergency cleanup system:', error);
    });
  }, []);

  return null; // This component doesn't render anything
}