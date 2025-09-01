'use client';

import { OrganizationList, useOrganization, useUser } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';

function OrganizationSelectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { isLoaded, isSignedIn } = useUser();

  const redirectUrl = searchParams?.get('redirectUrl') || '/projects';

  useEffect(() => {
    // If user has an active organization, redirect them
    if (organization && isLoaded) {
      router.push(redirectUrl);
    }
  }, [organization, isLoaded, router, redirectUrl]);

  if (!isLoaded || !isSignedIn) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Select or Create Organization
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Choose an organization to continue, or create a new one
          </p>
        </div>
        
        <div className="mt-8">
          <OrganizationList 
            afterCreateOrganizationUrl={redirectUrl}
            afterSelectOrganizationUrl={redirectUrl}
            skipInvitationScreen={false}
            hidePersonal={false}
          />
        </div>
      </div>
    </div>
  );
}

export default function OrganizationSelectionPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <OrganizationSelectionContent />
    </Suspense>
  );
}