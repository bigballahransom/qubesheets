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
import {
  Folder,
  Plus,
  ArrowRight,
  Loader2,
  Users,
  LayoutDashboard,
  Calendar,
  Truck,
  CalendarClock,
  Activity,
  BarChart3,
  Ticket,
  ChevronDown,
  Play,
  GitBranch,
  Workflow
} from 'lucide-react';
import { Sidebar } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@clerk/nextjs';
import { SearchDropdown } from '@/components/SearchDropdown';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import CreateCustomerModal from '@/components/modals/CreateCustomerModal';
import SettingsSection from '@/components/SettingsSection';

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
  const [dispatchExpanded, setDispatchExpanded] = useState(false);
  const [automationsExpanded, setAutomationsExpanded] = useState(false);
  
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, userId } = useAuth();
  const { organization } = useOrganization();

  // Check if organization has CRM add-on
  const hasCrmAddOn = (organization?.publicMetadata as any)?.subscription?.addOns?.includes('crm');
  
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
        {/* Add new project/customer button and mobile search - only visible on mobile */}
        <div className="p-4 border-b flex-shrink-0 lg:hidden">
          {hasCrmAddOn ? (
            <CreateCustomerModal onCustomerCreated={(customer) => router.push(`/customers/${customer._id}`)}>
              <button className="flex items-center gap-2 w-full p-2 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors cursor-pointer">
                <Plus size={16} />
                <span>New Customer</span>
              </button>
            </CreateCustomerModal>
          ) : (
            <CreateProjectModal onProjectCreated={handleProjectCreated}>
              <button className="flex items-center gap-2 w-full p-2 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors cursor-pointer">
                <Plus size={16} />
                <span>New Project</span>
              </button>
            </CreateProjectModal>
          )}

          {/* Mobile search bar */}
          <Separator className="my-3" />
          <SearchDropdown isMobile />
        </div>
        
        {/* Navigation area - scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-2">
            {hasCrmAddOn ? (
              /* CRM Navigation */
              <ul className="space-y-1">
                {/* Dashboard */}
                <li>
                  <button
                    onClick={() => router.push('/dashboard')}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname === '/dashboard' ? 'bg-gray-100' : ''
                    }`}
                  >
                    <LayoutDashboard size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Dashboard</span>
                  </button>
                </li>

                {/* Customers */}
                <li>
                  <button
                    onClick={() => router.push('/customers')}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname === '/customers' || pathname?.startsWith('/customers/') ? 'bg-gray-100' : ''
                    }`}
                  >
                    <Users size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Customers</span>
                  </button>
                </li>

                {/* Calendar */}
                <li>
                  <button
                    onClick={() => router.push('/calendar')}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname === '/calendar' ? 'bg-gray-100' : ''
                    }`}
                  >
                    <Calendar size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Calendar</span>
                  </button>
                </li>

                {/* Dispatch - Expandable */}
                <li>
                  <button
                    onClick={() => setDispatchExpanded(!dispatchExpanded)}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname?.startsWith('/dispatch') ? 'bg-gray-100' : ''
                    }`}
                  >
                    <Truck size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Dispatch</span>
                    <ChevronDown
                      size={14}
                      className={`ml-auto text-gray-400 transition-transform ${dispatchExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {dispatchExpanded && (
                    <ul className="ml-6 mt-1 space-y-1 border-l border-gray-200 pl-3">
                      <li>
                        <button
                          onClick={() => router.push('/dispatch/schedule')}
                          className={`flex items-center w-full p-2 rounded-md text-left text-sm hover:bg-gray-100 cursor-pointer transition-colors ${
                            pathname === '/dispatch/schedule' ? 'bg-gray-100' : ''
                          }`}
                        >
                          <CalendarClock size={14} className="mr-2 flex-shrink-0 text-gray-400" />
                          <span>Schedule</span>
                        </button>
                      </li>
                      <li>
                        <button
                          onClick={() => router.push('/dispatch/monitor')}
                          className={`flex items-center w-full p-2 rounded-md text-left text-sm hover:bg-gray-100 cursor-pointer transition-colors ${
                            pathname === '/dispatch/monitor' ? 'bg-gray-100' : ''
                          }`}
                        >
                          <Activity size={14} className="mr-2 flex-shrink-0 text-gray-400" />
                          <span>Monitor</span>
                        </button>
                      </li>
                    </ul>
                  )}
                </li>

                {/* Reporting */}
                <li>
                  <button
                    onClick={() => router.push('/reporting')}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname === '/reporting' ? 'bg-gray-100' : ''
                    }`}
                  >
                    <BarChart3 size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Reporting</span>
                  </button>
                </li>

                {/* Tickets */}
                <li>
                  <button
                    onClick={() => router.push('/tickets')}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname === '/tickets' ? 'bg-gray-100' : ''
                    }`}
                  >
                    <Ticket size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Tickets</span>
                  </button>
                </li>

                {/* Automations - Expandable */}
                <li>
                  <button
                    onClick={() => setAutomationsExpanded(!automationsExpanded)}
                    className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                      pathname?.startsWith('/automations') ? 'bg-gray-100' : ''
                    }`}
                  >
                    <Play size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                    <span className="font-medium">Automations</span>
                    <ChevronDown
                      size={14}
                      className={`ml-auto text-gray-400 transition-transform ${automationsExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {automationsExpanded && (
                    <ul className="ml-6 mt-1 space-y-1 border-l border-gray-200 pl-3">
                      <li>
                        <button
                          onClick={() => router.push('/automations/sequences')}
                          className={`flex items-center w-full p-2 rounded-md text-left text-sm hover:bg-gray-100 cursor-pointer transition-colors ${
                            pathname === '/automations/sequences' ? 'bg-gray-100' : ''
                          }`}
                        >
                          <GitBranch size={14} className="mr-2 flex-shrink-0 text-gray-400" />
                          <span>Sequences</span>
                        </button>
                      </li>
                      <li>
                        <button
                          onClick={() => router.push('/automations/workflows')}
                          className={`flex items-center w-full p-2 rounded-md text-left text-sm hover:bg-gray-100 cursor-pointer transition-colors ${
                            pathname === '/automations/workflows' ? 'bg-gray-100' : ''
                          }`}
                        >
                          <Workflow size={14} className="mr-2 flex-shrink-0 text-gray-400" />
                          <span>Workflows</span>
                        </button>
                      </li>
                    </ul>
                  )}
                </li>
              </ul>
            ) : (
              /* Non-CRM: Project List */
              <>
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
              </>
            )}
          </div>
        </div>
        
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
                  afterCreateOrganizationUrl="/"
                  afterSelectOrganizationUrl="/"
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