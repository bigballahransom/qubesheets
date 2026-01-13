'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Folder, User, Phone, Loader2, Building } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { filterProjects } from '@/components/providers/SearchProvider';
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

  // Fetch data when component mounts
  useEffect(() => {
    if (hasCrmAddOn) {
      fetchCustomers();
    } else {
      fetchProjects();
    }
  }, [hasCrmAddOn]);

  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      if (hasCrmAddOn) {
        fetchCustomers();
      } else {
        fetchProjects();
      }
    };

    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, [hasCrmAddOn]);

  // Filter results when search query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      if (hasCrmAddOn) {
        const filtered = filterCustomers(customers, searchQuery);
        setFilteredCustomers(filtered);
      } else {
        const filtered = filterProjects(projects, searchQuery);
        setFilteredProjects(filtered);
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
      const hasResults = hasCrmAddOn ? filteredCustomers.length > 0 : filteredProjects.length > 0;
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
      ? "Search by customer name, phone, or email..."
      : "Search by project name, customer, or phone...";
  };

  const resultsEmpty = hasCrmAddOn ? filteredCustomers.length === 0 : filteredProjects.length === 0;

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
              {hasCrmAddOn ? 'No customers found' : 'No projects found'}
            </div>
          ) : hasCrmAddOn ? (
            /* CRM: Customer Results */
            <div className="py-1">
              {filteredCustomers.map((customer) => (
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
            </div>
          ) : (
            /* Non-CRM: Project Results */
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