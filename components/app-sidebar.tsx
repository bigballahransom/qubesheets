'use client';

import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Folder, Plus, Settings, Inbox, Check, X, ArrowRight, Loader2 } from 'lucide-react';
import { Sidebar } from '@/components/ui/sidebar';
import { useAuth } from '@clerk/nextjs';

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
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, userId } = useAuth();
  
  // Fetch projects on component mount
  useEffect(() => {
    if (isLoaded && userId) {
      fetchProjects();
    }
  }, [isLoaded, userId]);
  
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
  
  const createProject = async () => {
    if (!newProjectName.trim()) {
      return;
    }
    
    try {
      setIsCreating(true);
      
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newProjectName.trim(),
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create project');
      }
      
      const project = await response.json();
      
      // Add the new project to the list
      setProjects([project, ...projects]);
      
      // Clear the form
      setNewProjectName('');
      setIsCreating(false);
      
      // Navigate to the new project
      router.push(`/projects/${project._id}`);
    } catch (err) {
      console.error('Error creating project:', err);
      setError('Failed to create project. Please try again.');
      setIsCreating(false);
    }
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
      {/* Add new project form */}
      <div className="p-4 border-b">
        {isCreating ? (
          <div className="bg-blue-50 p-3 rounded-md">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full p-2 mb-2 text-sm border rounded"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsCreating(false)}
                className="p-1.5 rounded hover:bg-gray-200"
              >
                <X size={16} />
              </button>
              <button
                onClick={createProject}
                disabled={!newProjectName.trim()}
                className="p-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-blue-300 flex items-center"
              >
                <Check size={16} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 w-full p-2 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
          >
            <Plus size={16} />
            <span>New Project</span>
          </button>
        )}
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
                  className={`flex items-center w-full p-2 rounded-md text-left hover:bg-gray-100 ${
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
        <div className="p-2">
            
                      {/* Desktop Action Buttons */}
                      <div className="flex items-center space-x-4">
                      <SignedIn>
                          <UserButton />
                        </SignedIn>
                      </div>
        </div>
      </div>
      </ClerkProvider>
    </Sidebar>
  );
}