'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Folder, User, Phone, Loader2, Building } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { filterProjects, projectMatchesCrmId } from '@/components/providers/SearchProvider';
import { useOrganization } from '@clerk/nextjs';

interface SearchDropdownProps {
  isMobile?: boolean;
}

interface Customer {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
}

export function SearchDropdown({ isMobile = false }: SearchDropdownProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<any[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { organization } = useOrganization();

  // Check if organization has CRM add-on
  const hasCrmAddOn = (organization?.publicMetadata as any)?.subscription?.addOns?.includes('crm');

  // Fetch data when component mounts. Projects are always fetched — even in
  // CRM (customers) mode they're searchable by CRM job/quote number.
  useEffect(() => {
    if (hasCrmAddOn) {
      fetchCustomers();
    }
    fetchProjects();
  }, [hasCrmAddOn]);

  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      if (hasCrmAddOn) {
        fetchCustomers();
      }
      fetchProjects();
    };

    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, [hasCrmAddOn]);

  // Archived projects stay searchable but rank below active matches
  const sortActiveFirst = (list: any[]) =>
    [...list].sort((a, b) => (a.isArchived ? 1 : 0) - (b.isArchived ? 1 : 0));

  // Filter results when search query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      if (hasCrmAddOn) {
        setFilteredCustomers(filterCustomers(customers, searchQuery));
        // Customers own name/phone/email search in CRM mode — projects only
        // surface on CRM job/quote id matches, so results aren't doubled.
        setFilteredProjects(sortActiveFirst(projects.filter((p) => projectMatchesCrmId(p, searchQuery))));
      } else {
        setFilteredProjects(sortActiveFirst(filterProjects(projects, searchQuery)));
      }
      setShowResults(true);
    } else {
      setFilteredProjects([]);
      setFilteredCustomers([]);
      setShowResults(false);
    }
  }, [searchQuery, projects, customers, hasCrmAddOn]);

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

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterCustomers = (customers: Customer[], query: string): Customer[] => {
    const lowerQuery = query.toLowerCase();
    return customers.filter((customer) => {
      const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();
      const phone = customer.phone?.toLowerCase() || '';
      const email = customer.email?.toLowerCase() || '';
      const company = customer.company?.toLowerCase() || '';
      return (
        fullName.includes(lowerQuery) ||
        phone.includes(lowerQuery) ||
        email.includes(lowerQuery) ||
        company.includes(lowerQuery)
      );
    });
  };

  const handleProjectClick = (projectId: string) => {
    router.push(`/projects/${projectId}`);
    setSearchQuery('');
    setShowResults(false);
  };

  const handleCustomerClick = (customerId: string) => {
    router.push(`/customers/${customerId}`);
    setSearchQuery('');
    setShowResults(false);
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) {
      const hasResults = filteredProjects.length > 0 || (hasCrmAddOn && filteredCustomers.length > 0);
      if (hasResults) {
        setShowResults(true);
      }
    }
  };

  const getPlaceholder = () => {
    if (isMobile) {
      return hasCrmAddOn ? "Search customers..." : "Search projects...";
    }
    return hasCrmAddOn
      ? "Search by name, phone, email, or job #..."
      : "Search by name, phone, email, or job #...";
  };

  // First CRM job/quote identifier on a project, for display in result rows.
  const crmIdLabel = (project: any): string | null => {
    const meta = project.metadata || {};
    if (meta.smartMovingQuoteNumber) return `SmartMoving #${meta.smartMovingQuoteNumber}`;
    if (meta.chariotSync?.jobId) return `Chariot #${meta.chariotSync.jobId}`;
    if (meta.moverbaseSync?.jobId) return `Moverbase #${meta.moverbaseSync.jobId}`;
    if (meta.moverightSync?.jobCode) return `MoveRight ${meta.moverightSync.jobCode}`;
    if (meta.supermoveProjectUuid) return `Supermove ${meta.supermoveProjectUuid.slice(0, 8)}…`;
    return null;
  };

  const resultsEmpty =
    filteredProjects.length === 0 && (!hasCrmAddOn || filteredCustomers.length === 0);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          ref={inputRef}
          type="search"
          placeholder={getPlaceholder()}
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
          ) : resultsEmpty ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              {hasCrmAddOn ? 'No customers or projects found' : 'No projects found'}
            </div>
          ) : (
            <div className="py-1">
              {/* CRM: Customer Results */}
              {hasCrmAddOn &&
                filteredCustomers.map((customer) => (
                  <button
                    key={customer._id}
                    onClick={() => handleCustomerClick(customer._id)}
                    className="w-full px-4 py-2 hover:bg-gray-50 text-left flex items-start gap-3 transition-colors"
                  >
                    <User className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">
                        {customer.firstName} {customer.lastName}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                        {customer.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span>{customer.phone}</span>
                          </div>
                        )}
                        {customer.email && (
                          <div className="flex items-center gap-1 truncate">
                            <span>{customer.email}</span>
                          </div>
                        )}
                        {customer.company && (
                          <div className="flex items-center gap-1">
                            <Building className="h-3 w-3" />
                            <span>{customer.company}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

              {/* Section label when both customers and projects matched */}
              {hasCrmAddOn && filteredCustomers.length > 0 && filteredProjects.length > 0 && (
                <div className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 border-t border-gray-100 mt-1">
                  Projects
                </div>
              )}

              {/* Project Results (both modes — searchable by CRM job #) */}
              {filteredProjects.map((project) => (
                <button
                  key={project._id}
                  onClick={() => handleProjectClick(project._id)}
                  className="w-full px-4 py-2 hover:bg-gray-50 text-left flex items-start gap-3 transition-colors"
                >
                  <Folder className={`h-4 w-4 mt-0.5 flex-shrink-0 ${project.isArchived ? 'text-gray-400' : 'text-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      <span className="truncate">{project.name}</span>
                      {project.isArchived && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium text-gray-600 bg-gray-200 rounded-full flex-shrink-0">
                          Archived
                        </span>
                      )}
                    </div>
                    {(project.customerName || project.phone || crmIdLabel(project)) && (
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
                        {crmIdLabel(project) && (
                          <span className="text-gray-400">{crmIdLabel(project)}</span>
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