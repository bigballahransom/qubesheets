// app/projects/[projectId]/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import InventoryManager from '@/components/InventoryManager';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import { Loader2 } from 'lucide-react';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [project, setProject] = useState(null);

  const fetchProject = async () => {
    if (!projectId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        cache: 'no-store' // Prevent caching issues
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          // Project not found in current account, redirect to projects
          console.log('Project not found in current account, redirecting to projects');
          router.push('/projects');
          return;
        }
        throw new Error('Failed to fetch project details');
      }
      
      const data = await response.json();
      setProject(data);
      setLoading(false);
    } catch (err) {
      console.error('Error loading project:', err);
      setError('Failed to load project. Please try again.');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [projectId]);
  
  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      console.log('Refreshing project data due to organization change');
      fetchProject();
    };
    
    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Loading project...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="bg-red-50 text-red-700 p-4 rounded-lg max-w-md text-center">
          <p className="font-bold mb-2">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Only render once we have the project data
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
        <InventoryManager />
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}