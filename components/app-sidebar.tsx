'use client';

import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
  OrganizationSwitcher,
  useOrganization,
  useUser
} from '@clerk/nextjs'
import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Folder, Plus, Settings, Inbox, Check, X, ArrowRight, Loader2 } from 'lucide-react';
import { Sidebar } from '@/components/ui/sidebar';
import { useAuth } from '@clerk/nextjs';
import { useOrganizationData } from '@/components/providers/OrganizationDataProvider';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import SettingsSection from '@/components/SettingsSection';

interface Project {
  _id: string;
  name: string;
  description?: string;
  updatedAt: string;
}

export function AppSidebar() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, userId } = useAuth();
  const { organization } = useOrganization();
  const { user } = useUser();
  
  // Fetch projects when auth state loads initially
  useEffect(() => {
    if (isLoaded && userId) {
      fetchProjects();
    }
  }, [isLoaded, userId]);
  
  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      console.log('Refreshing projects data due to organization change');
      fetchProjects();
    };
    
    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, []);
  
  // Set active project based on URL
  useEffect(() => {
    if (pathname) {
      const match = pathname.match(/\/projects\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        // Only update state if the ID actually changed
        if (activeProjectId !== match[1]) {
          setActiveProjectId(match[1]);
        }
      } else if (activeProjectId !== null) {
        setActiveProjectId(null);
      }
    }
  }, [pathname, activeProjectId]);
  
  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/projects');
      
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }
      
      const data = await response.json();
      setProjects(data);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleProjectCreated = (project: Project) => {
    // Add the new project to the list
    setProjects([project, ...projects]);
  };
  
  const handleProjectClick = (projectId: string) => {
    router.push(`/projects/${projectId}`);
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };
  
  return (
    <Sidebar>

      {/* Add new project button */}
      <div className="p-4 border-b">
        <CreateProjectModal onProjectCreated={handleProjectCreated}>
          <button className="flex items-center gap-2 w-full p-2 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors cursor-pointer">
            <Plus size={16} />
            <span>New Project</span>
          </button>
        </CreateProjectModal>
      </div>
      
      {/* Project list */}
      <div className="p-2">
        {loading ? (
          <div className="flex justify-center p-4">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="text-red-500 p-4 text-center text-sm">
            {error}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-gray-500 p-4 text-center text-sm">
            No projects found. Create your first project!
          </div>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => (
              <li key={project._id}>
                <button
                  onClick={() => handleProjectClick(project._id)}
                  className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                    activeProjectId === project._id ? 'bg-gray-100' : ''
                  }`}
                >
                  <Folder size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate font-medium">{project.name}</p>
                    <p className="text-xs text-gray-500">
                      Updated {formatDate(project.updatedAt)}
                    </p>
                  </div>
                  <ArrowRight size={14} className="text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      
      {/* Footer menu */}
      <ClerkProvider>
      <div className="absolute bottom-0 left-0 right-0 border-t bg-white">
        {/* Settings Section */}
        <SettingsSection />
        
        <div className="p-3">
          <SignedIn>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* User Button - Left */}
              <div className="flex-shrink-0">
                <UserButton 
                  userProfileMode="modal"
                  appearance={{
                    elements: {
                      rootBox: "flex items-center",
                      avatarBox: "h-7 w-7 sm:h-8 sm:w-8"
                    }
                  }}
                />
              </div>
              
              {/* Organization Switcher - Right */}
              <div className="flex-1 min-w-0 max-w-[180px] sm:max-w-none">
                <OrganizationSwitcher
                  organizationProfileMode="modal"
                  createOrganizationMode="modal"
                  afterCreateOrganizationUrl="/projects"
                  afterSelectOrganizationUrl="/projects"
                  hidePersonal={false}
                  appearance={{
                    elements: {
                      rootBox: "w-full",
                      organizationSwitcherTrigger: "w-full justify-start text-left px-2 py-1.5 border rounded-md hover:bg-gray-100 text-xs sm:text-sm truncate min-h-[32px]",
                      organizationPreviewTextContainer: "text-xs sm:text-sm font-medium truncate",
                      organizationSwitcherPreviewMainIdentifier: "truncate max-w-[120px] sm:max-w-none",
                      organizationSwitcherTriggerIcon: "w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0"
                    }
                  }}
                />
              </div>
            </div>
          </SignedIn>
        </div>
      </div>
      </ClerkProvider>
    </Sidebar>
  );
}