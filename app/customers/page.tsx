'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Plus, Loader2, Search, ChevronDown, Filter, ArrowUpDown, Phone, Mail, Building, Calendar, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import CreateCustomerModal from '@/components/modals/CreateCustomerModal';
import IntercomChat from '@/components/IntercomChat';

interface Customer {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  createdAt: string;
}

type SortField = 'name' | 'email' | 'phone' | 'company' | 'createdAt';
type SortDirection = 'asc' | 'desc';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const router = useRouter();

  // Fetch customers on component mount
  useEffect(() => {
    fetchCustomers();
  }, []);

  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      fetchCustomers();
    };

    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/customers', {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch customers: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setCustomers(data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching customers:', err);
      setError('Failed to load customers. Please try again.');
      setLoading(false);
    }
  };

  const handleCustomerCreated = (customer: Customer) => {
    router.push(`/customers/${customer._id}`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Filter and sort customers
  const filteredAndSortedCustomers = customers
    .filter((customer) => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();
      return (
        fullName.includes(search) ||
        customer.email?.toLowerCase().includes(search) ||
        customer.phone?.toLowerCase().includes(search) ||
        customer.company?.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'name':
          aVal = `${a.firstName} ${a.lastName}`.toLowerCase();
          bVal = `${b.firstName} ${b.lastName}`.toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'phone':
          aVal = a.phone || '';
          bVal = b.phone || '';
          break;
        case 'company':
          aVal = (a.company || '').toLowerCase();
          bVal = (b.company || '').toLowerCase();
          break;
        case 'createdAt':
          aVal = new Date(a.createdAt).getTime();
          bVal = new Date(b.createdAt).getTime();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(filteredAndSortedCustomers.map(c => c._id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (customerId: string, checked: boolean) => {
    if (checked) {
      setSelectedRows([...selectedRows, customerId]);
    } else {
      setSelectedRows(selectedRows.filter(id => id !== customerId));
    }
  };

  const rowCount = `${filteredAndSortedCustomers.length}/${customers.length} customers`;

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden"></div>
        <div className="min-h-screen bg-slate-50 lg:pl-64 pt-4 lg:pt-20">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {/* Breadcrumb Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-900">Customers</span>
              </div>
              <div className="flex items-center gap-2">
                <CreateCustomerModal onCustomerCreated={handleCustomerCreated}>
                  <Button
                    size="sm"
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 hover:border-blue-300 cursor-pointer transition-colors"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">Add Customer</span>
                    <span className="sm:hidden">Add</span>
                  </Button>
                </CreateCustomerModal>
              </div>
            </div>

            {/* Spreadsheet Container */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-white border-b">
                <div className="flex items-center gap-2">
                  {/* Row count */}
                  <div className="px-2 py-1 text-sm text-gray-600 bg-gray-100 rounded">
                    {rowCount}
                  </div>

                  {/* Sort dropdown */}
                  <div className="relative">
                    <button className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-gray-100 transition-colors">
                      <ArrowUpDown size={14} />
                      <span>Sort: {sortField}</span>
                    </button>
                  </div>
                </div>

                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <input
                    type="text"
                    placeholder="Search customers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Content */}
              {loading ? (
                <div className="flex justify-center items-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                </div>
              ) : error ? (
                <div className="p-6 text-center">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600">
                    {error}
                  </div>
                </div>
              ) : filteredAndSortedCustomers.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    {searchTerm ? 'No customers found' : 'No customers yet'}
                  </h3>
                  <p className="text-gray-500 mb-4">
                    {searchTerm
                      ? 'Try adjusting your search terms.'
                      : 'Get started by adding your first customer.'}
                  </p>
                  {!searchTerm && (
                    <CreateCustomerModal onCustomerCreated={handleCustomerCreated}>
                      <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Plus className="mr-2 h-4 w-4" />
                        Add Customer
                      </Button>
                    </CreateCustomerModal>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {/* Header Row */}
                  <div className="sticky top-0 z-10 bg-white flex border-b shadow-sm min-w-[800px]">
                    {/* Checkbox column */}
                    <div className="w-10 min-w-[40px] bg-gray-50 border-r flex items-center justify-center py-3">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded cursor-pointer"
                        checked={selectedRows.length === filteredAndSortedCustomers.length && filteredAndSortedCustomers.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </div>

                    {/* Name column */}
                    <div
                      className="flex-1 min-w-[180px] bg-gray-50 border-r py-3 px-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">Name</span>
                        {sortField === 'name' && (
                          <ChevronDown size={14} className={`text-gray-400 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    </div>

                    {/* Email column */}
                    <div
                      className="w-56 min-w-[200px] bg-gray-50 border-r py-3 px-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('email')}
                    >
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">Email</span>
                        {sortField === 'email' && (
                          <ChevronDown size={14} className={`text-gray-400 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    </div>

                    {/* Phone column */}
                    <div
                      className="w-40 min-w-[140px] bg-gray-50 border-r py-3 px-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('phone')}
                    >
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">Phone</span>
                        {sortField === 'phone' && (
                          <ChevronDown size={14} className={`text-gray-400 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    </div>

                    {/* Company column */}
                    <div
                      className="w-44 min-w-[160px] bg-gray-50 border-r py-3 px-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('company')}
                    >
                      <div className="flex items-center gap-2">
                        <Building size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">Company</span>
                        {sortField === 'company' && (
                          <ChevronDown size={14} className={`text-gray-400 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    </div>

                    {/* Created column */}
                    <div
                      className="w-32 min-w-[120px] bg-gray-50 py-3 px-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('createdAt')}
                    >
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">Created</span>
                        {sortField === 'createdAt' && (
                          <ChevronDown size={14} className={`text-gray-400 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Data Rows */}
                  <div className="min-w-[800px]">
                    {filteredAndSortedCustomers.map((customer, index) => (
                      <div
                        key={customer._id}
                        className={`flex border-b cursor-pointer transition-colors ${
                          selectedRows.includes(customer._id)
                            ? 'bg-blue-50'
                            : index % 2 === 0
                              ? 'bg-white hover:bg-gray-50'
                              : 'bg-slate-50/50 hover:bg-gray-50'
                        }`}
                        onClick={() => router.push(`/customers/${customer._id}`)}
                      >
                        {/* Checkbox */}
                        <div
                          className="w-10 min-w-[40px] border-r flex items-center justify-center py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded cursor-pointer"
                            checked={selectedRows.includes(customer._id)}
                            onChange={(e) => handleSelectRow(customer._id, e.target.checked)}
                          />
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-[180px] border-r py-3 px-4">
                          <span className="text-sm font-medium text-gray-900">
                            {customer.firstName} {customer.lastName}
                          </span>
                        </div>

                        {/* Email */}
                        <div className="w-56 min-w-[200px] border-r py-3 px-4">
                          <span className="text-sm text-gray-600 truncate block">
                            {customer.email || '-'}
                          </span>
                        </div>

                        {/* Phone */}
                        <div className="w-40 min-w-[140px] border-r py-3 px-4">
                          <span className="text-sm text-gray-600">
                            {customer.phone || '-'}
                          </span>
                        </div>

                        {/* Company */}
                        <div className="w-44 min-w-[160px] border-r py-3 px-4">
                          <span className="text-sm text-gray-600 truncate block">
                            {customer.company || '-'}
                          </span>
                        </div>

                        {/* Created */}
                        <div className="w-32 min-w-[120px] py-3 px-4">
                          <span className="text-sm text-gray-500">
                            {formatDate(customer.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
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
