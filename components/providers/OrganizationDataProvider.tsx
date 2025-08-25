'use client';

import { useOrganization, useUser } from '@clerk/nextjs';
import { useRouter, usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface OrganizationDataContextType {
  refreshData: () => void;
}

const OrganizationDataContext = createContext<OrganizationDataContextType>({
  refreshData: () => {}
});

export const useOrganizationData = () => useContext(OrganizationDataContext);

export function OrganizationDataProvider({ children }: { children: React.ReactNode }) {
  const { organization } = useOrganization();
  const { isLoaded, user } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const previousOrgId = useRef<string | null | undefined>(undefined);

  const refreshData = () => {
    // Trigger a custom event that components can listen to
    window.dispatchEvent(new CustomEvent('organizationDataRefresh'));
  };

  useEffect(() => {
    if (isLoaded && user) {
      const currentOrgId = organization?.id || null;
      
      // Only trigger refresh if organization actually changed
      if (previousOrgId.current !== undefined && previousOrgId.current !== currentOrgId) {
        const orgName = organization?.name || 'Personal Account';
        console.log('Organization switched from', previousOrgId.current, 'to', currentOrgId);
        
        // Show toast notification
        toast.success(`Switched to ${orgName}`, {
          description: 'Refreshing your data...',
          duration: 2000,
        });
        
        // Trigger data refresh
        refreshData();
        
        // Handle page redirects if user doesn't have access to current page
        const isOnProjectPage = pathname.startsWith('/projects/') && pathname !== '/projects';
        if (isOnProjectPage) {
          console.log('On project page during org switch, will check access');
          // Redirect to main projects page - individual project access will be checked there
          setTimeout(() => {
            router.push('/projects');
          }, 100);
        }
      }
      
      previousOrgId.current = currentOrgId;
    }
  }, [organization?.id, isLoaded, user, pathname, router]);

  return (
    <OrganizationDataContext.Provider value={{ refreshData }}>
      {children}
    </OrganizationDataContext.Provider>
  );
}