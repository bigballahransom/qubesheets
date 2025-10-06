'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Folder, User, Phone, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { filterProjects } from '@/components/providers/SearchProvider';

interface SearchDropdownProps {
  isMobile?: boolean;
}

export function SearchDropdown({ isMobile = false }: SearchDropdownProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Fetch all projects when component mounts
  useEffect(() => {
    fetchProjects();
  }, []);

  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      fetchProjects();
    };
    
    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, []);

  // Filter projects when search query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = filterProjects(projects, searchQuery);
      setFilteredProjects(filtered);
      setShowResults(true);
    } else {
      setFilteredProjects([]);
      setShowResults(false);
    }
  }, [searchQuery, projects]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProjectClick = (projectId: string) => {
    router.push(`/projects/${projectId}`);
    setSearchQuery('');
    setShowResults(false);
  };

  const handleInputFocus = () => {
    if (searchQuery.trim() && filteredProjects.length > 0) {
      setShowResults(true);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          ref={inputRef}
          type="search"
          placeholder={isMobile ? "Search projects..." : "Search by project name, customer, or phone..."}
          className={`pl-10 pr-4 ${isMobile ? 'w-full text-sm' : 'w-96'}`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={handleInputFocus}
        />
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-md shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-50">
          {loading ? (
            <div className="p-4 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No projects found
            </div>
          ) : (
            <div className="py-1">
              {filteredProjects.map((project) => (
                <button
                  key={project._id}
                  onClick={() => handleProjectClick(project._id)}
                  className="w-full px-4 py-2 hover:bg-gray-50 text-left flex items-start gap-3 transition-colors"
                >
                  <Folder className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{project.name}</div>
                    {(project.customerName || project.phone) && (
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                        {project.customerName && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            <span>{project.customerName}</span>
                          </div>
                        )}
                        {project.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span>{project.phone}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}