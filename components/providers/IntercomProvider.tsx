'use client';

import React, { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import Intercom from '@intercom/messenger-js-sdk';

interface IntercomProviderProps {
  children: React.ReactNode;
}

export function IntercomProvider({ children }: IntercomProviderProps) {
  const { isLoaded, user } = useUser();
  const pathname = usePathname();
  const [isIntercomInitialized, setIsIntercomInitialized] = React.useState(false);

  useEffect(() => {
    // Wait for DOM to be ready and Clerk components to be fully mounted
    if (typeof window === 'undefined' || document.readyState !== 'complete') {
      const handleLoad = () => {
        window.removeEventListener('load', handleLoad);
        initializeIntercom();
      };
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }

    const initializeIntercom = () => {
    const initTimer = setTimeout(() => {
    // Routes where Intercom should be loaded
    const allowedRoutes = [
      '/projects',
      '/settings',
      '/user-profile',
      '/organization-profile',
    ];

    // Routes where Intercom should be excluded
    const excludedRoutes = [
      '/video-call',
      '/customer-upload',
      '/call-complete',
      '/sign-in',
      '/sign-up',
    ];

    // Check if current path should show Intercom
    const shouldShowIntercom = () => {
      // Check if path matches any excluded route
      for (const route of excludedRoutes) {
        if (pathname.startsWith(route)) {
          return false;
        }
      }

      // Check if path matches any allowed route
      for (const route of allowedRoutes) {
        if (pathname.startsWith(route)) {
          return true;
        }
      }

      return false;
    };

    // Initialize or shutdown Intercom based on route
    if (isLoaded && user && shouldShowIntercom() && !isIntercomInitialized) {
      console.log('Initializing Intercom for user:', user.id);
      
      try {
        // Initialize Intercom with user data
        Intercom({
          app_id: 'aj1af9ai',
          user_id: user.id,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
          email: user.emailAddresses[0]?.emailAddress || '',
          created_at: Math.floor(user.createdAt.getTime() / 1000), // Convert to Unix timestamp
        });
        setIsIntercomInitialized(true);
      } catch (error) {
        console.error('Failed to initialize Intercom:', error);
      }
    } else if (!shouldShowIntercom() && typeof window !== 'undefined' && window.Intercom && isIntercomInitialized) {
      console.log('Shutting down Intercom for route:', pathname);
      
      try {
        // Shutdown Intercom when on excluded routes
        window.Intercom('shutdown');
        setIsIntercomInitialized(false);
      } catch (error) {
        console.error('Failed to shutdown Intercom:', error);
      }
    }

    }, 500); // Increased delay to ensure Clerk is fully mounted

    // Cleanup function
    return () => {
      clearTimeout(initTimer);
      if (typeof window !== 'undefined' && window.Intercom) {
        try {
          window.Intercom('shutdown');
        } catch (error) {
          console.error('Failed to shutdown Intercom in cleanup:', error);
        }
      }
    };
    };

    // Call immediately if DOM is ready
    if (document.readyState === 'complete') {
      initializeIntercom();
    }
  }, [isLoaded, user, pathname, isIntercomInitialized]);

  return <>{children}</>;
}