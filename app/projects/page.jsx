'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Folder, Plus, User, Users, UserX, ChevronDown, Archive, ArchiveRestore, MoreHorizontal, UserPlus, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import DuplicateProjectModal from '@/components/modals/DuplicateProjectModal';
import IntercomChat from '@/components/IntercomChat';
import { useAuth, useOrganization } from '@clerk/nextjs';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
// Define Project type (optional in JSX but helpful for documentation)
// interface Project {
//   _id: string;
//   name: string;
//   description?: string;
//   updatedAt: string;
// }

const FILTER_STORAGE_KEY = 'projectsFilter';
const SCROLL_STORAGE_KEY = 'projectsScrollPos';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectFilter, setProjectFilter] = useState('mine');
  const [filterHydrated, setFilterHydrated] = useState(false);
  const [orgMembers, setOrgMembers] = useState([]);
  // Project being duplicated via the row menu (null = dialog closed)
  const [duplicatingProject, setDuplicatingProject] = useState(null);

  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const { organization } = useOrganization();

  // Check if organization has CRM add-on (assignment UI is non-CRM only,
  // matching InventoryManager)
  const hasCrmAddOn = organization?.publicMetadata?.subscription?.addOns?.includes('crm');

  // Filter projects based on dropdown selection; archived projects only show
  // under the 'archived' filter
  const filteredProjects = (() => {
    if (projectFilter === 'archived') return projects.filter(p => p.isArchived);

    const active = projects.filter(p => !p.isArchived);
    if (!organization) return active;

    switch (projectFilter) {
      case 'mine':
        // Falls back to userId (creator) if no assignedTo exists
        return active.filter(p => (p.assignedTo?.userId || p.userId) === userId);
      case 'unassigned':
        // Projects with no assignedTo AND created via API/webhook/global-self-survey-link/vault crew link (not a real user)
        return active.filter(p => !p.assignedTo && ['api-created', 'smartmoving-webhook', 'global-self-survey-link', 'global-vault-link'].includes(p.userId));
      case 'all':
      default:
        return active;
    }
  })();
  
  // Fetch projects on component mount
  useEffect(() => {
    fetchProjects();
  }, []);

  // Fetch organization members for the assign menu (non-CRM orgs only)
  useEffect(() => {
    if (!organization || hasCrmAddOn) return;
    (async () => {
      try {
        const response = await fetch('/api/organizations/members');
        if (response.ok) setOrgMembers(await response.json());
      } catch (err) {
        console.error('Error fetching org members:', err);
      }
    })();
  }, [organization, hasCrmAddOn]);

  // Restore persisted filter selection on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (saved === 'mine' || saved === 'all' || saved === 'unassigned' || saved === 'archived') {
      setProjectFilter(saved);
    }
    setFilterHydrated(true);
  }, []);

  // Persist filter selection whenever it changes
  useEffect(() => {
    if (filterHydrated) {
      sessionStorage.setItem(FILTER_STORAGE_KEY, projectFilter);
    }
  }, [projectFilter, filterHydrated]);

  // Restore scroll position once projects are rendered, then clear it so a
  // fresh visit starts at the top.
  useEffect(() => {
    if (loading || projects.length === 0) return;
    const savedScroll = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (savedScroll === null) return;
    requestAnimationFrame(() => {
      window.scrollTo(0, parseInt(savedScroll, 10) || 0);
      sessionStorage.removeItem(SCROLL_STORAGE_KEY);
    });
  }, [loading, projects.length]);
  
  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = (event) => {
      console.log('Refreshing projects data');
      // Same-org updates (e.g. archiving) pass silent: true — revalidate
      // in place without flashing the loading skeleton
      fetchProjects({ silent: !!event?.detail?.silent });
    };

    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, []);

  const fetchProjects = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
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
    sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
    router.push(`/projects/${projectId}`);
  };

  const setArchived = async (project, isArchived) => {
    try {
      const response = await fetch(`/api/projects/${project._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update project: ${response.status}`);
      }

      const updated = await response.json();
      setProjects(prev => prev.map(p => (p._id === updated._id ? updated : p)));
      // Sidebar and global search keep their own project caches
      window.dispatchEvent(new CustomEvent('organizationDataRefresh', { detail: { silent: true } }));
      return true;
    } catch (err) {
      console.error('Error archiving project:', err);
      toast.error('Failed to update project');
      return false;
    }
  };

  const toggleArchive = async (project) => {
    const archiving = !project.isArchived;
    if (!(await setArchived(project, archiving))) return;
    toast.success(archiving ? `Archived "${project.name}"` : `Restored "${project.name}"`, {
      action: {
        label: 'Undo',
        onClick: () => setArchived(project, !archiving),
      },
    });
  };

  const memberDisplayName = (member) =>
    (member.firstName || member.lastName)
      ? `${member.firstName} ${member.lastName}`.trim()
      : member.identifier;

  const assignProject = async (project, member) => {
    try {
      const response = await fetch(`/api/projects/${project._id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: member.userId }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.error || 'Failed to assign project');
        return;
      }

      const updated = await response.json();
      setProjects(prev => prev.map(p => (p._id === updated._id ? updated : p)));
      window.dispatchEvent(new CustomEvent('organizationDataRefresh', { detail: { silent: true } }));
      toast.success(`Assigned "${project.name}" to ${memberDisplayName(member)}`);
    } catch (err) {
      console.error('Error assigning project:', err);
      toast.error('Failed to assign project');
    }
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

      {/* Duplicate project dialog (opened from a row's ... menu) */}
      {duplicatingProject && (
        <DuplicateProjectModal
          isOpen={!!duplicatingProject}
          onClose={() => setDuplicatingProject(null)}
          projectId={duplicatingProject._id}
          projectName={duplicatingProject.name}
          onDuplicated={(newProjectId) => {
            window.dispatchEvent(new CustomEvent('organizationDataRefresh', { detail: { silent: true } }));
            router.push(`/projects/${newProjectId}`);
          }}
        />
      )}
      
      {/* Projects list */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="sticky top-0 lg:top-16 z-10 flex items-center justify-between px-4 py-3 bg-white border-b rounded-t-lg">
          <h2 className="text-lg font-medium">Your Projects</h2>

          {/* Project Filter Dropdown */}
          {!loading && projects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    {projectFilter === 'archived' ? (
                      <>
                        <Archive size={14} />
                        Archived
                      </>
                    ) : !organization ? (
                      <>
                        <Users size={14} />
                        All Projects
                      </>
                    ) : (
                      <>
                        {projectFilter === 'mine' && <User size={14} />}
                        {projectFilter === 'all' && <Users size={14} />}
                        {projectFilter === 'unassigned' && <UserX size={14} />}
                        {projectFilter === 'mine' && 'My Projects'}
                        {projectFilter === 'all' && 'All Projects'}
                        {projectFilter === 'unassigned' && 'Unassigned'}
                      </>
                    )}
                  </span>
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                {organization ? (
                  <>
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
                  </>
                ) : (
                  <DropdownMenuItem
                    onClick={() => setProjectFilter('all')}
                    className="cursor-pointer"
                  >
                    <Users size={14} className="mr-2" />
                    All Projects
                    {projectFilter !== 'archived' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => setProjectFilter('archived')}
                  className="cursor-pointer"
                >
                  <Archive size={14} className="mr-2" />
                  Archived
                  {projectFilter === 'archived' && <span className="ml-auto text-xs text-gray-400">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="p-4">
        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="py-3">
                <div className="flex items-start">
                  <div className="mr-3 mt-1">
                    <Skeleton className="h-5 w-5 rounded" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              </div>
            ))}
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
            {filteredProjects.map((project) => {
              const isSyncedToSmartMoving = !!project.metadata?.smartMovingSyncedAt;
              const isSyncedToSupermove = !!project.metadata?.supermoveSync?.synced;
              const isSyncedToChariot = !!project.metadata?.chariotSync?.synced;

              return (
                <div
                  key={project._id}
                  className="group py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => handleProjectClick(project._id)}
                >
                  <div className="flex items-start">
                    <div className="mr-3 mt-1">
                      <Folder className={`h-5 w-5 ${project.isArchived ? 'text-gray-400' : 'text-blue-500'}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium flex items-center gap-1.5">
                        {project.name}
                        {project.isArchived && (
                          <span className="px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-200 rounded-full flex-shrink-0">
                            Archived
                          </span>
                        )}
                        {project.vaultUnfiled && !project.isArchived && (
                          <span
                            className="px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-100 rounded-full flex-shrink-0"
                            title="Auto-created by the Media Vault crew link — no matching job was found for this phone number. Move the media to the right project or keep this one."
                          >
                            Unfiled
                          </span>
                        )}
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
                      </h3>
                      {project.description && (
                        <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        Last updated: {formatDate(project.updatedAt)}
                      </p>
                    </div>
                    {/* "More options" menu — same pattern as the sidebar: a
                        neutral ⋯ so rows read as navigation, archiving is a
                        deliberate second click inside the menu, Undo toast as
                        the safety net. Hover-revealed on desktop; always
                        visible on mobile (no hover there, and a stray tap
                        just opens the menu). */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          title="Project options"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 mt-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-all cursor-pointer flex-shrink-0 lg:opacity-0 lg:pointer-events-none lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto lg:focus-visible:opacity-100 lg:focus-visible:pointer-events-auto lg:data-[state=open]:opacity-100 lg:data-[state=open]:pointer-events-auto data-[state=open]:bg-gray-200 data-[state=open]:text-gray-700"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[170px]">
                        {organization && orgMembers.length > 0 && (
                          <DropdownMenuSub>
                            {/* gap-2 + 16px icon match DropdownMenuItem's
                                built-in spacing so rows align */}
                            <DropdownMenuSubTrigger className="cursor-pointer gap-2">
                              <UserPlus size={16} className="mr-2" />
                              Assign to
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {orgMembers.map((member) => {
                                const effectiveOwnerId = project.assignedTo?.userId || project.userId;
                                return (
                                  <DropdownMenuItem
                                    key={member.userId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      assignProject(project, member);
                                    }}
                                    disabled={member.userId === effectiveOwnerId}
                                    className="cursor-pointer"
                                  >
                                    <User size={14} className="mr-2" />
                                    {memberDisplayName(member)}
                                    {member.userId === effectiveOwnerId && (
                                      <span className="ml-auto text-xs text-gray-400">(Current)</span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setDuplicatingProject(project);
                          }}
                          className="cursor-pointer"
                        >
                          <Copy size={14} className="mr-2" />
                          Duplicate project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleArchive(project);
                          }}
                          className="cursor-pointer"
                        >
                          {project.isArchived ? (
                            <ArchiveRestore size={14} className="mr-2" />
                          ) : (
                            <Archive size={14} className="mr-2" />
                          )}
                          {project.isArchived ? 'Restore project' : 'Archive project'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
          <SidebarTrigger />
        </SidebarProvider>
        <IntercomChat />
    </>
  );
}