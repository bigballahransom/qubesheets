'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import { SearchDropdown } from '@/components/SearchDropdown';
import {
  SignedIn,
  UserButton,
  OrganizationSwitcher
} from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

export function DesktopHeaderBar() {
  const router = useRouter();
  
  const handleProjectCreated = (project: any) => {
    // Navigate to the new project
    router.push(`/projects/${project._id}`);
  };
  return (
    <div className="hidden lg:block fixed top-0 left-64 right-0 h-16 bg-white border-b border-gray-200 z-50 shadow-sm">
      <div className="flex items-center justify-between h-full px-6">
        <div className="flex items-center space-x-4">
          {/* Search bar with dropdown */}
          <SearchDropdown />
        </div>
        
        <div className="flex items-center space-x-4">
          <SignedIn>
            {/* New Project Button */}
            <CreateProjectModal onProjectCreated={handleProjectCreated}>
              <Button 
                size="sm" 
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Project
              </Button>
            </CreateProjectModal>
            
            {/* Organization Switcher */}
            <div className="min-w-[200px]">
              <OrganizationSwitcher
                organizationProfileMode="modal"
                createOrganizationMode="modal"
                afterCreateOrganizationUrl="/projects"
                afterSelectOrganizationUrl="/projects"
                hidePersonal={false}
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    organizationSwitcherTrigger: "w-full justify-start text-left px-3 py-2 border rounded-md hover:bg-gray-50 text-sm min-h-[40px]",
                    organizationPreviewTextContainer: "text-sm font-medium",
                    organizationSwitcherPreviewMainIdentifier: "truncate max-w-[150px]",
                    organizationSwitcherTriggerIcon: "w-4 h-4 flex-shrink-0"
                  }
                }}
              />
            </div>
            
            {/* User Button */}
            <div className="flex-shrink-0">
              <UserButton 
                userProfileMode="modal"
                appearance={{
                  elements: {
                    rootBox: "flex items-center",
                    avatarBox: "h-8 w-8"
                  }
                }}
              />
            </div>
          </SignedIn>
        </div>
      </div>
    </div>
  );
}