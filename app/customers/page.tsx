'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { useOrganization } from '@clerk/nextjs';
import { hasAddOn } from '@/lib/client-utils';
import IntercomChat from '@/components/IntercomChat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Customer {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveDate: string;
  referralSource: string;
  createdAt: string;
  updatedAt: string;
}

export default function CustomersPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const [currentPage, setCurrentPage] = useState(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const itemsPerPage = 10;
  
  // Check if user has CRM add-on access
  const hasCrmAddOn = organization && hasAddOn(organization, 'crm');
  
  // Fetch customers from API
  useEffect(() => {
    const fetchCustomers = async () => {
      if (!hasCrmAddOn) return;
      
      try {
        const response = await fetch('/api/customers');
        if (response.ok) {
          const data = await response.json();
          setCustomers(data.customers || []);
        } else {
          console.error('Failed to fetch customers');
        }
      } catch (error) {
        console.error('Error fetching customers:', error);
      } finally {
        setLoading(false);
      }
    };

    if (organization !== undefined) {
      if (!hasCrmAddOn) {
        router.push('/projects');
      } else {
        fetchCustomers();
      }
    }
  }, [organization, hasCrmAddOn, router]);

  // Calculate pagination
  const totalPages = Math.ceil(customers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentCustomers = customers.slice(startIndex, endIndex);

  
  // Show loading while checking organization access or loading customers
  if (organization === undefined || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }
  
  // Don't render anything if no CRM access (will redirect)
  if (!hasCrmAddOn) {
    return null;
  }
  
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-slate-50">
        <AppSidebar />
        <DesktopHeaderBar />
        
        {/* Main content wrapper */}
        <div className="pt-16 lg:pl-64 lg:pt-16 p-6 md:ml-6 md:mt-6">
          {/* Mobile sidebar trigger */}
          <div className="lg:hidden mb-4">
            <SidebarTrigger />
          </div>
          
          {/* Customers Table - Centered on X-axis with Breadcrumb */}
          <div className="flex justify-center w-full">
            <div className="max-w-4xl w-full">
              {/* Breadcrumb and Filters Row */}
              <div className="flex justify-between items-center mb-6">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>Customers</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                
                {/* Filters */}
                <div className="flex gap-2">
                  <Select>
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="Google Search">Google Search</SelectItem>
                      <SelectItem value="Social Media">Social Media</SelectItem>
                      <SelectItem value="Referral">Referral</SelectItem>
                      <SelectItem value="Website">Website</SelectItem>
                      <SelectItem value="Advertisement">Advertisement</SelectItem>
                      <SelectItem value="Cold Call">Cold Call</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Select>
                    <SelectTrigger className="h-8 w-32 text-xs">
                      <SelectValue placeholder="Date Range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Dates</SelectItem>
                      <SelectItem value="this-month">This Month</SelectItem>
                      <SelectItem value="next-month">Next Month</SelectItem>
                      <SelectItem value="this-year">This Year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Manage</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Last Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Move Date</TableHead>
                        <TableHead>Referral Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentCustomers.map((customer) => (
                        <TableRow key={customer._id}>
                          <TableCell>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => router.push(`/customers/${customer._id}`)}
                            >
                              Manage
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{customer.firstName}</TableCell>
                          <TableCell className="font-medium">{customer.lastName}</TableCell>
                          <TableCell>{customer.email}</TableCell>
                          <TableCell>{customer.phone}</TableCell>
                          <TableCell>{new Date(customer.moveDate).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{customer.referralSource}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  
                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-6">
                    <div className="text-sm text-gray-700">
                      Showing {startIndex + 1} to {Math.min(endIndex, customers.length)} of {customers.length} customers
                    </div>
                    
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious 
                            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                            className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          />
                        </PaginationItem>
                        
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                          <PaginationItem key={page}>
                            <PaginationLink
                              onClick={() => setCurrentPage(page)}
                              isActive={currentPage === page}
                              className="cursor-pointer"
                            >
                              {page}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        
                        <PaginationItem>
                          <PaginationNext 
                            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                            className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <IntercomChat />
    </SidebarProvider>
  );
}