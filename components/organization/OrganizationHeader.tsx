'use client';

import { 
  OrganizationSwitcher, 
  UserButton, 
  useUser, 
  useOrganization
} from '@clerk/nextjs';
import { Building2, Users } from 'lucide-react';

export default function OrganizationHeader() {
  const { user } = useUser();
  const { organization } = useOrganization();

  if (!user) return null;

  return (
    <div className="border-b bg-white px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Building2 className="h-5 w-5 text-gray-500" />
            <OrganizationSwitcher
              organizationProfileMode="navigation"
              organizationProfileUrl="/organization-profile"
              createOrganizationMode="navigation"
              createOrganizationUrl="/organization-selection"
              afterCreateOrganizationUrl="/projects"
              afterSelectOrganizationUrl="/projects"
              hidePersonal={false}
              appearance={{
                elements: {
                  rootBox: "flex items-center",
                  organizationSwitcherTrigger: "border-none shadow-none px-2 py-1 hover:bg-gray-100 rounded-md",
                  organizationPreviewTextContainer: "text-sm font-medium"
                }
              }}
            />
          </div>
          
          {organization && (
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <Users className="h-4 w-4" />
              <span>{organization.membersCount} members</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <UserButton 
            afterSignOutUrl="/"
            userProfileMode="navigation"
            userProfileUrl="/user-profile"
            appearance={{
              elements: {
                rootBox: "flex items-center",
                avatarBox: "h-8 w-8"
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}