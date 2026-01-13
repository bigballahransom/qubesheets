'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@clerk/nextjs';

export default function Home() {
  const router = useRouter();
  const { organization, isLoaded } = useOrganization();

  useEffect(() => {
    if (!isLoaded) return;

    // Check if organization has CRM add-on
    const hasCrmAddOn = (organization?.publicMetadata as any)?.subscription?.addOns?.includes('crm');

    // Redirect CRM users to dashboard, others to projects
    if (hasCrmAddOn) {
      router.push('/dashboard');
    } else {
      router.push('/projects');
    }
  }, [router, organization, isLoaded]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
      <p className="text-gray-600 ml-3">Loading...</p>
    </div>
  );
}