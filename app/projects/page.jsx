'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, Plus, Loader2, User, Users, UserX, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import IntercomChat from '@/components/IntercomChat';
import { useAuth, useOrganization } from '@clerk/nextjs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// Define Project type (optional in JSX but helpful for documentation)
// interface Project {
//   _id: string;
//   name: string;
//   description?: string;
//   updatedAt: string;
// }

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectFilter, setProjectFilter] = useState('mine');

  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const { organization } = useOrganization();

  // Filter projects based on dropdown selection (only for organizations)
  const filteredProjects = (() => {
    if (!organization) return projects;

    switch (projectFilter) {
      case 'mine':
        // Falls back to userId (creator) if no assignedTo exists
        return projects.filter(p => (p.assignedTo?.userId || p.userId) === userId);
      case 'unassigned':
        // Projects with no assignedTo AND created via API/webhook/global-self-survey-link (not a real user)
        return projects.filter(p => !p.assignedTo && ['api-created', 'smartmoving-webhook', 'global-self-survey-link'].includes(p.userId));
      case 'all':
      default:
        return projects;
    }
  })();
  
  // Fetch projects on component mount
  useEffect(() => {
    fetchProjects();
  }, []);
  
  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      console.log('Refreshing projects data due to organization change');
      fetchProjects();
    };
    
    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, []);
  
  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/projects', {
        cache: 'no-store' // Prevent caching issues
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setProjects(data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects. Please try again.');
      setLoading(false);
    }
  };
  
  const handleProjectCreated = (project) => {
    // Add the new project to the list
    setProjects(prev => [project, ...prev]);
  };
  
  const handleProjectClick = (projectId) => {
    router.push(`/projects/${projectId}`);
  };
  
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };
  
  return (
    <>
        <SidebarProvider>
          <AppSidebar />
          <DesktopHeaderBar />
          <div className="h-16"></div>
    <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
      {/* Header with create button */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <CreateProjectModal onProjectCreated={handleProjectCreated}>
          <Button size="lg" className="flex-shrink-0 bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 hover:border-blue-300 cursor-pointer transition-colors">
            <Plus className="mr-2 h-4 w-4" />
            Create New Project
          </Button>
        </CreateProjectModal>
      </div>
      
      {/* Projects list */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Your Projects</h2>

          {/* Project Filter Dropdown - only show for organizations */}
          {organization && !loading && projects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    {projectFilter === 'mine' && <User size={14} />}
                    {projectFilter === 'all' && <Users size={14} />}
                    {projectFilter === 'unassigned' && <UserX size={14} />}
                    {projectFilter === 'mine' && 'My Projects'}
                    {projectFilter === 'all' && 'All Projects'}
                    {projectFilter === 'unassigned' && 'Unassigned'}
                  </span>
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                <DropdownMenuItem
                  onClick={() => setProjectFilter('mine')}
                  className="cursor-pointer"
                >
                  <User size={14} className="mr-2" />
                  My Projects
                  {projectFilter === 'mine' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setProjectFilter('all')}
                  className="cursor-pointer"
                >
                  <Users size={14} className="mr-2" />
                  All Projects
                  {projectFilter === 'all' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setProjectFilter('unassigned')}
                  className="cursor-pointer"
                >
                  <UserX size={14} className="mr-2" />
                  Unassigned
                  {projectFilter === 'unassigned' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <span className="ml-2 text-gray-500">Loading projects...</span>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 p-4 rounded-md">
            <p>{error}</p>
            <Button 
              onClick={fetchProjects} 
              variant="outline"
              className="mt-2"
            >
              Try Again
            </Button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {projects.length === 0 ? (
              <>
                <p>You don't have any projects yet.</p>
                <p className="mt-2">Create your first project to get started!</p>
              </>
            ) : (
              <p>No projects found for the selected filter.</p>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {filteredProjects.map((project) => (
              <div
                key={project._id}
                className="py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => handleProjectClick(project._id)}
              >
                <div className="flex items-start">
                  <div className="mr-3 mt-1">
                    <Folder className="h-5 w-5 text-blue-500" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">{project.name}</h3>
                    {project.description && (
                      <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Last updated: {formatDate(project.updatedAt)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
          <SidebarTrigger />
        </SidebarProvider>
        <IntercomChat />
    </>
  );
}