'use client';

import {
  ClerkProvider,
  SignedIn,
  UserButton,
  OrganizationSwitcher,
  useOrganization
} from '@clerk/nextjs'
import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  Folder,
  Plus,
  ArrowRight,
  Users,
  User,
  UserX,
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@clerk/nextjs';
import { SearchDropdown } from '@/components/SearchDropdown';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import CreateCustomerModal from '@/components/modals/CreateCustomerModal';
import SettingsSection from '@/components/SettingsSection';
import { FormNotificationBell } from '@/components/FormNotificationBell';

interface Project {
  _id: string;
  name: string;
  description?: string;
  customerName?: string;
  phone?: string;
  updatedAt: string;
  userId: string; // Creator of the project
  assignedTo?: {
    userId: string;
    name: string;
    assignedAt: string;
  };
  metadata?: {
    smartMovingOpportunityId?: string;
    smartMovingSyncedAt?: string;
    source?: string;
    supermoveSync?: {
      synced: boolean;
      syncedAt: string;
    };
    chariotSync?: {
      synced: boolean;
      syncedAt: string;
    };
    moverbaseSync?: {
      synced: boolean;
      syncedAt: string;
    };
  };
}

// ── Sidebar persistence ────────────────────────────────────────────────
// The sidebar is mounted PER PAGE (every page.tsx renders its own
// <AppSidebar />), so client-side navigation unmounts and remounts it.
// Without these, every project click reset the filter to "My Projects",
// snapped the list back to the top, and flashed the loading skeleton while
// projects refetched. Filter choice is durable (localStorage); scroll is
// per-tab (sessionStorage); the project list is cached at module scope and
// revalidated in the background on each mount.
const FILTER_STORAGE_KEY = 'qs-sidebar-project-filter';
const SCROLL_STORAGE_KEY = 'qs-sidebar-scroll';

type ProjectFilter = 'mine' | 'all' | 'unassigned';

let projectsCache: Project[] | null = null;

function readStoredFilter(): ProjectFilter {
  if (typeof window === 'undefined') return 'mine';
  try {
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (stored === 'mine' || stored === 'all' || stored === 'unassigned') return stored;
  } catch {}
  return 'mine';
}

export function AppSidebar() {
  const [projects, setProjects] = useState<Project[]>(() => projectsCache ?? []);
  const [loading, setLoading] = useState(() => projectsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [dispatchExpanded, setDispatchExpanded] = useState(false);
  const [automationsExpanded, setAutomationsExpanded] = useState(false);
  // Safe to read storage in the initializer: nothing filter-dependent is in
  // the server-rendered output (the dropdown only appears once projects have
  // loaded client-side), so there's no hydration mismatch to cause.
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>(readStoredFilter);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRestoredRef = useRef(false);

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
      // Drop the cache — a silent revalidate would keep showing the OLD
      // org's projects until the fetch lands. A skeleton is honest here.
      projectsCache = null;
      setProjects([]);
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
    // With a warm cache this is a silent background revalidate — the list
    // renders immediately from cache and updates in place when fresh data
    // lands, instead of flashing the skeleton on every navigation.
    if (projectsCache === null) setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/projects');

      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }

      const data = await response.json();
      projectsCache = data;
      setProjects(data);
    } catch (err) {
      console.error('Error fetching projects:', err);
      // Only surface the error when there's nothing usable to show — a
      // failed background refresh shouldn't blank out a working list.
      if (projectsCache === null) setError('Failed to load projects. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleProjectCreated = (project: Project) => {
    // Add the new project to the list
    const next = [project, ...projects];
    projectsCache = next;
    setProjects(next);
  };

  const changeProjectFilter = (filter: ProjectFilter) => {
    setProjectFilter(filter);
    try { window.localStorage.setItem(FILTER_STORAGE_KEY, filter); } catch {}
    // A different filter shows a different list — a stale scroll offset from
    // the previous list has no meaning for it.
    try { window.sessionStorage.setItem(SCROLL_STORAGE_KEY, '0'); } catch {}
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  };

  // Restore the sidebar scroll position once the (cached or fetched) list
  // has rendered; save it on every scroll so the next per-page remount can
  // put the user right back where they were.
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const el = scrollContainerRef.current;
    if (!el) return;
    try {
      const saved = parseInt(window.sessionStorage.getItem(SCROLL_STORAGE_KEY) || '0', 10);
      if (saved > 0) el.scrollTop = saved;
    } catch {}
  }, [loading]);
  
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
        <div
          ref={scrollContainerRef}
          onScroll={(e) => {
            try { window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(e.currentTarget.scrollTop)); } catch {}
          }}
          className="flex-1 overflow-y-auto min-h-0"
        >
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
                {/* Project Filter Dropdown - only show for organizations.
                    Sticky within the sidebar's scroll container so the
                    filter stays reachable while scrolling a long project
                    list. Negative margins + matching padding extend its
                    white background over the wrapper's p-2 gutters so rows
                    don't peek around it as they scroll underneath. */}
                {organization && !loading && projects.length > 0 && (
                  <div className="sticky top-0 z-10 -mx-2 -mt-2 px-2 pt-2 pb-2 bg-white">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors cursor-pointer">
                          <span className="flex items-center gap-1.5">
                            {projectFilter === 'mine' && <User size={12} />}
                            {projectFilter === 'all' && <Users size={12} />}
                            {projectFilter === 'unassigned' && <UserX size={12} />}
                            {projectFilter === 'mine' && 'My Projects'}
                            {projectFilter === 'all' && 'All Projects'}
                            {projectFilter === 'unassigned' && 'Unassigned'}
                          </span>
                          <ChevronDown size={12} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-[180px]">
                        <DropdownMenuItem
                          onClick={() => changeProjectFilter('mine')}
                          className="cursor-pointer"
                        >
                          <User size={14} className="mr-2" />
                          My Projects
                          {projectFilter === 'mine' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => changeProjectFilter('all')}
                          className="cursor-pointer"
                        >
                          <Users size={14} className="mr-2" />
                          All Projects
                          {projectFilter === 'all' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => changeProjectFilter('unassigned')}
                          className="cursor-pointer"
                        >
                          <UserX size={14} className="mr-2" />
                          Unassigned
                          {projectFilter === 'unassigned' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {loading ? (
                  <ul className="space-y-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <li key={i} className="flex items-center w-full p-2">
                        <Skeleton className="h-4 w-4 mr-2 rounded flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-3/4" />
                          <Skeleton className="h-2.5 w-1/2" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : error ? (
                  <div className="text-red-500 p-4 text-center text-sm">
                    {error}
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div className="text-gray-500 p-4 text-center text-sm">
                    {projectFilter === 'mine' && 'No projects assigned to you.'}
                    {projectFilter === 'unassigned' && 'No unassigned projects.'}
                    {projectFilter === 'all' && 'No projects found. Create your first project!'}
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {filteredProjects.map((project) => {
                      // Show SmartMoving logo only for projects that have been synced (have syncedAt timestamp)
                      const isSyncedToSmartMoving = !!project.metadata?.smartMovingSyncedAt;
                      const isSyncedToSupermove = !!project.metadata?.supermoveSync?.synced;
                      const isSyncedToChariot = !!project.metadata?.chariotSync?.synced;
                      const isSyncedToMoverbase = !!project.metadata?.moverbaseSync?.synced;

                      return (
                        <li key={project._id}>
                          <button
                            onClick={() => handleProjectClick(project._id)}
                            className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 cursor-pointer transition-colors ${
                              activeProjectId === project._id ? 'bg-gray-100' : ''
                            }`}
                          >
                            <Folder size={16} className="mr-2 flex-shrink-0 text-blue-500" />
                            <div className="flex-1 overflow-hidden">
                              <p className="truncate font-medium flex items-center gap-1.5">
                                {project.name}
                                {isSyncedToSmartMoving && (
                                  <span title="Synced with SmartMoving">
                                    <Image
                                      src="/smtiny.png"
                                      alt="Synced to SmartMoving"
                                      width={14}
                                      height={14}
                                      className="flex-shrink-0"
                                    />
                                  </span>
                                )}
                                {isSyncedToSupermove && (
                                  <span title="Synced with Supermove">
                                    <Image
                                      src="/supermovetiny.png"
                                      alt="Synced to Supermove"
                                      width={14}
                                      height={14}
                                      className="flex-shrink-0"
                                    />
                                  </span>
                                )}
                                {isSyncedToChariot && (
                                  <span title="Synced with Chariot">
                                    <Image
                                      src="/chariottiny.png"
                                      alt="Synced to Chariot"
                                      width={14}
                                      height={14}
                                      className="flex-shrink-0"
                                    />
                                  </span>
                                )}
                                {isSyncedToMoverbase && (
                                  <span title="Synced with Moverbase">
                                    <Image
                                      src="/moverbasetiny.png"
                                      alt="Synced to Moverbase"
                                      width={14}
                                      height={14}
                                      className="flex-shrink-0"
                                    />
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-gray-500">
                                Updated {formatDate(project.updatedAt)}
                              </p>
                            </div>
                            <ArrowRight size={14} className="text-gray-400" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* Footer menu */}
        <ClerkProvider>
        <div className="border-t bg-white flex-shrink-0 mobile-safe-bottom">
        {/* Dashboard Link - only for non-CRM users since CRM users have it in navigation */}
        {!hasCrmAddOn && (
          <button
            onClick={() => router.push('/qubesheets-dashboard')}
            className={`flex items-center gap-2 w-full p-3 text-gray-700 transition-colors cursor-pointer hover:bg-gray-100 active:bg-gray-200 ${
              pathname === '/qubesheets-dashboard' ? 'bg-gray-100' : ''
            }`}
          >
            <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">Dashboard</span>
          </button>
        )}

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

              {/* Form submissions notification bell - only for CRM users */}
              {hasCrmAddOn && <FormNotificationBell />}

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