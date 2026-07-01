// app/projects/[projectId]/page.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import InventoryManager from '@/components/InventoryManager';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { fetchWithRetry, FetchRetryError } from '@/lib/fetchWithRetry';

const ERROR_KIND = {
  AUTH: 'auth',
  NETWORK: 'network',
  SERVER: 'server',
  UNKNOWN: 'unknown',
};

function classifyFetchError(err) {
  if (err instanceof FetchRetryError) {
    if (err.status === 401 || err.status === 403) return ERROR_KIND.AUTH;
    if (err.status && err.status >= 500) return ERROR_KIND.SERVER;
    if (err.status === null) return ERROR_KIND.NETWORK;
  }
  return ERROR_KIND.UNKNOWN;
}

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId;
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState(null);
  const [project, setProject] = useState(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) return null;

    setLoading(true);
    setErrorKind(null);

    try {
      const response = await fetchWithRetry(`/api/projects/${projectId}`, {
        cache: 'no-store',
      });

      if (response.status === 404) {
        router.push('/projects');
        return null;
      }

      if (!response.ok) {
        throw new FetchRetryError(`HTTP ${response.status}`, { status: response.status, response });
      }

      const data = await response.json();
      setProject(data);
      setLoading(false);
      return data;
    } catch (err) {
      console.error('Error loading project:', err);
      setErrorKind(classifyFetchError(err));
      setLoading(false);
      return null;
    }
  }, [projectId, router]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    const handleDataRefresh = () => {
      console.log('Refreshing project data due to organization change');
      fetchProject();
    };

    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, [fetchProject]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Loading project...</p>
      </div>
    );
  }

  if (errorKind) {
    const title =
      errorKind === ERROR_KIND.AUTH ? 'Session expired'
      : errorKind === ERROR_KIND.NETWORK ? 'Connection lost'
      : errorKind === ERROR_KIND.SERVER ? 'Service temporarily unavailable'
      : 'Failed to load project';
    const body =
      errorKind === ERROR_KIND.AUTH ? 'Please sign in again to continue.'
      : errorKind === ERROR_KIND.NETWORK ? 'Check your network connection and try again.'
      : errorKind === ERROR_KIND.SERVER ? 'The server is having trouble responding. Please retry in a moment.'
      : 'Something went wrong while loading this project.';

    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="bg-red-50 text-red-700 p-6 rounded-lg max-w-md w-full text-center">
          <p className="font-bold mb-2">{title}</p>
          <p className="mb-4">{body}</p>
          {errorKind === ERROR_KIND.AUTH ? (
            <Button onClick={() => router.push('/sign-in')} className="w-full">
              Sign in
            </Button>
          ) : (
            <Button onClick={fetchProject} className="w-full">
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="bg-yellow-50 text-yellow-700 p-4 rounded-lg max-w-md text-center">
          <p className="font-bold mb-2">Warning</p>
          <p>Project not found or access denied.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <InventoryManager initialProject={project} onProjectRefresh={fetchProject} />
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}
