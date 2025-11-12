'use client';

import {
  ClerkProvider,
  SignedIn,
  UserButton,
  OrganizationSwitcher,
  useOrganization
} from '@clerk/nextjs'
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Folder, Plus, ArrowRight, Loader2, Bell, Users } from 'lucide-react';
import { Sidebar } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@clerk/nextjs';
import { SearchDropdown } from '@/components/SearchDropdown';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import SettingsSection from '@/components/SettingsSection';
import { hasAddOn } from '@/lib/client-utils';

interface Project {
  _id: string;
  name: string;
  description?: string;
  customerName?: string;
  phone?: string;
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
  
  const hasCrmAddOn = organization && hasAddOn(organization, 'crm');
  
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
      <div className="flex flex-col h-full">
        {/* Add new project button and mobile search - only visible on mobile */}
        <div className="p-4 border-b flex-shrink-0 lg:hidden">
          <div className="flex items-center gap-2">
            <CreateProjectModal onProjectCreated={handleProjectCreated}>
              <button className="flex items-center gap-2 flex-1 p-2 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors cursor-pointer">
                <Plus size={16} />
                <span>New Project</span>
              </button>
            </CreateProjectModal>

            {/* CRM Notification Bell - only show if organization has CRM add-on */}
            {hasCrmAddOn && (
              <button
                className="p-2 rounded-md text-blue-700 hover:text-blue-800 hover:bg-blue-50 transition-colors"
                onClick={() => {
                  // TODO: Add notification functionality
                  console.log('CRM notifications clicked');
                }}
              >
                <Bell size={16} />
              </button>
            )}
          </div>
          
          {/* Mobile search bar */}
          <Separator className="my-3" />
          <SearchDropdown isMobile />
        </div>
        
        {/* Project list - scrollable area */}
        <div className="flex-1 overflow-y-auto min-h-0">
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
        </div>

        {/* CRM Navigation - only show if organization has CRM add-on */}
        {hasCrmAddOn && (
          <div className="px-3 py-2">
            <button
              onClick={() => router.push('/customers')}
              className={`flex items-center w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                pathname === '/customers' 
                  ? 'bg-gray-100 text-gray-900' 
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Users className="mr-3 h-4 w-4 flex-shrink-0" />
              <span>Customers</span>
            </button>
          </div>
        )}
        
        {/* Footer menu */}
        <ClerkProvider>
        <div className="border-t bg-white flex-shrink-0 mobile-safe-bottom">
        {/* Settings Section */}
        <SettingsSection />
        
        <div className="p-3 pb-2 lg:pb-3 lg:hidden">
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
      </div>
    </Sidebar>
  );
}