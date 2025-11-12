'use client';

import { Plus, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import CreateCustomerModal from '@/components/modals/CreateCustomerModal';
import { SearchDropdown } from '@/components/SearchDropdown';
import { toast } from 'sonner';
import {
  SignedIn,
  UserButton,
  OrganizationSwitcher,
  useOrganization
} from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { hasAddOn } from '@/lib/client-utils';

export function DesktopHeaderBar() {
  const router = useRouter();
  const { organization } = useOrganization();
  
  const handleProjectCreated = (project: any) => {
    // Navigate to the new project
    router.push(`/projects/${project._id}`);
  };

  const handleCustomerCreated = (data: any) => {
    // Show success toast
    toast.success('Customer and project created!', {
      description: `${data.customer.firstName} ${data.customer.lastName} has been added to your CRM with a new project.`
    });
    
    // Navigate to the specific customer page
    router.push(`/customers/${data.customer.id}`);
  };

  const hasCrmAddOn = organization && hasAddOn(organization, 'crm');
  return (
    <div className="hidden lg:block fixed top-0 left-64 right-0 h-16 bg-white border-b border-gray-200 z-50 shadow-sm">
      <div className="flex items-center justify-between h-full px-6">
        <div className="flex items-center space-x-4">
          {/* Search bar with dropdown */}
          <SearchDropdown />
        </div>
        
        <div className="flex items-center space-x-4">
          <SignedIn>
            {/* Conditional Button - New Project or CRM Quick Add */}
            {hasCrmAddOn ? (
              <CreateCustomerModal onCustomerCreated={handleCustomerCreated}>
                <Button 
                  size="sm" 
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </CreateCustomerModal>
            ) : (
              <CreateProjectModal onProjectCreated={handleProjectCreated}>
                <Button 
                  size="sm" 
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Project
                </Button>
              </CreateProjectModal>
            )}

            {/* CRM Notification Bell - only show if organization has CRM add-on */}
            {hasCrmAddOn && (
              <Button
                size="sm"
                variant="ghost"
                className="text-blue-700 hover:text-blue-800 hover:bg-blue-50"
                onClick={() => {
                  // TODO: Add notification functionality
                  console.log('CRM notifications clicked');
                }}
              >
                <Bell className="h-4 w-4" />
              </Button>
            )}
            
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