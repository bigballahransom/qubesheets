'use client';

import { OrganizationProfile } from '@clerk/nextjs';

export default function OrganizationProfilePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm">
          <OrganizationProfile 
            routing="path" 
            path="/organization-profile"
            afterLeaveOrganizationUrl="/organization-selection"
          />
        </div>
      </div>
    </div>
  );
}