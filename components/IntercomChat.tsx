'use client';

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import Intercom from '@intercom/messenger-js-sdk';

export default function IntercomChat() {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !user) return;

    // Add custom CSS for Intercom styling
    const addCustomStyles = () => {
      const style = document.createElement('style');
      style.textContent = `
        .intercom-messenger-frame {
          /* Customize the messenger frame */
        }
        
        /* You can also override Intercom's CSS variables if they're available */
        :root {
          --intercom-brand-primary: #3B82F6 !important;
        }
      `;
      document.head.appendChild(style);
    };

    // Initialize Intercom
    const timer = setTimeout(() => {
      try {
        // Add custom styles first
        addCustomStyles();
        
        Intercom({
          app_id: 'aj1af9ai',
          user_id: user.id,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.emailAddresses[0]?.emailAddress || 'User',
          email: user.emailAddresses[0]?.emailAddress || '',
          created_at: user.createdAt ? Math.floor(user.createdAt.getTime() / 1000) : Math.floor(Date.now() / 1000),
          // Custom styling
          custom_launcher_selector: '.intercom-launcher',
          background_color: '#3B82F6', // Blue color (you can change this)
          action_color: '#3B82F6', // Blue color for buttons/links
        });
      } catch (error) {
        console.error('Failed to initialize Intercom:', error);
      }
    }, 1000);

    return () => {
      clearTimeout(timer);
      // Shutdown Intercom on unmount
      if (typeof window !== 'undefined' && window.Intercom) {
        try {
          window.Intercom('shutdown');
        } catch (error) {
          console.error('Failed to shutdown Intercom:', error);
        }
      }
    };
  }, [isLoaded, user]);

  return null; // This component doesn't render anything
}