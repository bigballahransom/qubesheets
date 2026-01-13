'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  User,
  Phone,
  Building,
  Mail,
  Loader2,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Calendar,
  Clock,
  MapPin,
  Package,
  Calculator,
  Users,
  DollarSign,
  Truck,
  Shield,
  Plus,
  Pencil,
  FileText,
  PhoneCall,
  StickyNote,
  CircleDot,
  Download,
  Send,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import EditCustomerModal from '@/components/modals/EditCustomerModal';
import EditJobDetailsModal from '@/components/modals/EditJobDetailsModal';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";

interface Customer {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  _id: string;
  name: string;
  customerName: string;
  updatedAt: string;
  jobDate?: string;
  arrivalWindowStart?: string;
  arrivalWindowEnd?: string;
  opportunityType?: string;
  jobType?: string;
}

export default function CustomerDetailPage() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [jobDetailsModalOpen, setJobDetailsModalOpen] = useState(false);

  const params = useParams();
  const router = useRouter();
  const customerId = params?.customerId as string;

  useEffect(() => {
    if (customerId) {
      fetchCustomer();
      fetchProjects();
    }
  }, [customerId]);

  const fetchCustomer = async () => {
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        cache: 'no-store'
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError('Customer not found');
        } else {
          throw new Error('Failed to fetch customer');
        }
        return;
      }

      const data = await response.json();
      setCustomer(data);
    } catch (err) {
      console.error('Error fetching customer:', err);
      setError('Failed to load customer');
    } finally {
      setLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch(`/api/customers/${customerId}/projects`, {
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  };

  const handleProjectUpdated = (updatedProject: Project) => {
    setProjects(prev => prev.map(p => p._id === updatedProject._id ? updatedProject : p));
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime12Hour = (time24?: string) => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const formatArrivalWindow = (start?: string, end?: string) => {
    if (!start && !end) return 'Not set';
    if (start && end) return `${formatTime12Hour(start)} - ${formatTime12Hour(end)}`;
    return formatTime12Hour(start) || formatTime12Hour(end) || 'Not set';
  };

  if (loading) {
    return (
      <>
        <SidebarProvider>
          <AppSidebar />
          <DesktopHeaderBar />
          <div className="flex items-center justify-center min-h-screen lg:pl-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        </SidebarProvider>
      </>
    );
  }

  if (error || !customer) {
    return (
      <>
        <SidebarProvider>
          <AppSidebar />
          <DesktopHeaderBar />
          <div className="h-16"></div>
          <div className="container mx-auto p-4 max-w-6xl lg:pl-64 lg:pt-16">
            <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
              <p className="text-red-600">{error || 'Customer not found'}</p>
              <Button
                variant="outline"
                onClick={() => router.push('/customers')}
                className="mt-4"
              >
                Back to Customers
              </Button>
            </div>
          </div>
          <SidebarTrigger />
        </SidebarProvider>
      </>
    );
  }

  const fullName = `${customer.firstName} ${customer.lastName}`;
  const firstProject = projects[0];

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden"></div>

        {/* Sticky Header Bar */}
        <header className="sticky top-16 z-30 bg-white border-b shadow-sm lg:ml-64">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            {/* Customer Name and Status */}
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-gray-900">{fullName}</h1>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                Booked
              </Badge>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                Organic
              </Badge>
              {firstProject && (
                <button
                  onClick={() => router.push(`/projects/${firstProject._id}`)}
                  className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 transition-colors cursor-pointer"
                  title="View Inventory"
                >
                  <Package size={18} />
                </button>
              )}
            </div>

            {/* Action Menu */}
            <div className="flex items-center gap-2">
              <Menubar>
                <MenubarMenu>
                  <MenubarTrigger className="gap-1 cursor-pointer">
                    Actions
                  </MenubarTrigger>
                  <MenubarContent>
                    {/* View section */}
                    <MenubarItem onClick={() => firstProject && router.push(`/projects/${firstProject._id}`)}>
                      <Package size={16} className="mr-2" />
                      View Inventory
                    </MenubarItem>
                    <MenubarItem>
                      <FileText size={16} className="mr-2" />
                      View Estimate
                    </MenubarItem>
                    <MenubarSeparator />
                    {/* Send section */}
                    <MenubarItem>
                      <MessageSquare size={16} className="mr-2" />
                      Send SMS
                    </MenubarItem>
                    <MenubarItem>
                      <Mail size={16} className="mr-2" />
                      Send Email
                    </MenubarItem>
                    <MenubarItem>
                      <Send size={16} className="mr-2" />
                      Send Estimate
                    </MenubarItem>
                    <MenubarSeparator />
                    {/* Export section */}
                    <MenubarItem>
                      <Download size={16} className="mr-2" />
                      Export as PDF
                    </MenubarItem>
                    <MenubarItem>
                      <Download size={16} className="mr-2" />
                      Export as CSV
                    </MenubarItem>
                    <MenubarSeparator />
                    {/* Management section */}
                    <MenubarItem onClick={() => setEditModalOpen(true)}>
                      <Pencil size={16} className="mr-2" />
                      Edit Customer
                    </MenubarItem>
                    <MenubarItem onClick={() => setJobDetailsModalOpen(true)}>
                      <Calendar size={16} className="mr-2" />
                      Edit Job Details
                    </MenubarItem>
                    <MenubarItem>
                      <Clock size={16} className="mr-2" />
                      Activity Log
                    </MenubarItem>
                    <MenubarSeparator />
                    {/* Destructive section */}
                    <MenubarItem className="text-red-600 focus:text-red-600 focus:bg-red-50">
                      <Trash2 size={16} className="mr-2" />
                      Delete Customer
                    </MenubarItem>
                  </MenubarContent>
                </MenubarMenu>
              </Menubar>
            </div>
          </div>
        </header>

        <div className="min-h-screen bg-slate-50 lg:ml-64 lg:pt-14">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {/* Main Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Left Column */}
              <div className="lg:col-span-2 space-y-6">

                {/* Customer Details Card */}
                <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <User className="h-5 w-5 text-blue-600" />
                      </div>
                      <h2 className="text-lg font-semibold text-gray-900">Customer Details</h2>
                    </div>
                    <button
                      onClick={() => setEditModalOpen(true)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex items-start gap-3">
                      <User className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Name</p>
                        <p className="font-medium text-gray-900">{fullName}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Phone className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Phone</p>
                        <p className="font-medium text-gray-900">{customer.phone || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Building className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Company</p>
                        <p className="font-medium text-gray-900">{customer.company || 'Not provided'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Email</p>
                        <p className="font-medium text-gray-900">{customer.email || 'Not provided'}</p>
                      </div>
                    </div>
                  </div>

                  <EditCustomerModal
                    open={editModalOpen}
                    onOpenChange={setEditModalOpen}
                    customer={customer}
                    onCustomerUpdated={(updatedCustomer) => setCustomer(updatedCustomer)}
                  />
                </div>

                {/* Mobile: Inventory Card (appears here on mobile, hidden on desktop) */}
                <div className="lg:hidden">
                  <InventoryCard projectId={firstProject?._id} router={router} />
                </div>

                {/* Communications Card */}
                <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <MessageSquare className="h-5 w-5 text-purple-600" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900">Communications</h2>
                  </div>

                  <Tabs defaultValue="sms" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 mb-6">
                      <TabsTrigger value="sms" className="flex items-center gap-1.5 text-sm">
                        <MessageSquare className="h-4 w-4" />
                        <span className="hidden sm:inline">SMS</span>
                      </TabsTrigger>
                      <TabsTrigger value="email" className="flex items-center gap-1.5 text-sm">
                        <Mail className="h-4 w-4" />
                        <span className="hidden sm:inline">Email</span>
                      </TabsTrigger>
                      <TabsTrigger value="calls" className="flex items-center gap-1.5 text-sm">
                        <PhoneCall className="h-4 w-4" />
                        <span className="hidden sm:inline">Calls</span>
                      </TabsTrigger>
                      <TabsTrigger value="notes" className="flex items-center gap-1.5 text-sm">
                        <StickyNote className="h-4 w-4" />
                        <span className="hidden sm:inline">Notes</span>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="sms" className="space-y-4">
                      <Select defaultValue="custom">
                        <SelectTrigger>
                          <SelectValue placeholder="Select message template" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom Message</SelectItem>
                          <SelectItem value="reminder">Appointment Reminder</SelectItem>
                          <SelectItem value="confirmation">Booking Confirmation</SelectItem>
                          <SelectItem value="followup">Follow-up</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="relative">
                        <Textarea
                          placeholder="Type your message..."
                          className="min-h-[100px] resize-none"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          maxLength={160}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Character count: {message.length}/160
                        </p>
                      </div>

                      <Button
                        variant="outline"
                        className="w-full text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Send Message
                      </Button>

                      {/* Communication History */}
                      <button
                        onClick={() => setHistoryExpanded(!historyExpanded)}
                        className="flex items-center justify-between w-full py-3 px-2 -mx-2 border-t mt-4 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <span className="font-medium text-gray-900">
                          Communication History
                          <Badge variant="secondary" className="ml-2">8</Badge>
                        </span>
                        <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {historyExpanded && (
                        <div className="space-y-2 pt-2">
                          <button className="w-full text-left p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
                            <p className="text-sm text-gray-600">SMS sent on Nov 10, 2025</p>
                            <p className="text-sm text-gray-900 mt-1">Reminder: Your move is scheduled for tomorrow...</p>
                          </button>
                          <button className="w-full text-left p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
                            <p className="text-sm text-gray-600">SMS sent on Nov 8, 2025</p>
                            <p className="text-sm text-gray-900 mt-1">Your booking has been confirmed...</p>
                          </button>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="email">
                      <p className="text-gray-500 text-center py-8">Email functionality coming soon</p>
                    </TabsContent>

                    <TabsContent value="calls">
                      <p className="text-gray-500 text-center py-8">Call log coming soon</p>
                    </TabsContent>

                    <TabsContent value="notes">
                      <p className="text-gray-500 text-center py-8">Notes functionality coming soon</p>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Mobile: Estimate Card */}
                <div className="lg:hidden">
                  <EstimateCard />
                </div>

                {/* Date, Time, and Job Type Card */}
                <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-indigo-100 rounded-lg">
                        <Calendar className="h-5 w-5 text-indigo-600" />
                      </div>
                      <h2 className="text-lg font-semibold text-gray-900">Date, Time, and Job Type</h2>
                    </div>
                    <button
                      onClick={() => setJobDetailsModalOpen(true)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex items-start gap-3">
                      <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Date</p>
                        <p className="font-medium text-gray-900">{formatDate(firstProject?.jobDate)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Arrival Window</p>
                        <p className="font-medium text-gray-900">{formatArrivalWindow(firstProject?.arrivalWindowStart, firstProject?.arrivalWindowEnd)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <FileText className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Opportunity Type</p>
                        <p className="font-medium text-gray-900">{firstProject?.opportunityType || 'Not set'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Package className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Job Type</p>
                        <p className="font-medium text-gray-900">{firstProject?.jobType || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  <EditJobDetailsModal
                    open={jobDetailsModalOpen}
                    onOpenChange={setJobDetailsModalOpen}
                    project={firstProject || null}
                    onProjectUpdated={handleProjectUpdated}
                  />
                </div>

                {/* Mobile: Materials & Services Card */}
                <div className="lg:hidden">
                  <MaterialsServicesCard />
                </div>

                {/* Locations Card */}
                <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-orange-100 rounded-lg">
                        <MapPin className="h-5 w-5 text-orange-600" />
                      </div>
                      <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
                    </div>
                    <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    {/* Origin */}
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <CircleDot className="h-5 w-5 text-blue-500" />
                          <span className="font-medium text-gray-900">Origin</span>
                        </div>
                        <p className="text-gray-700 ml-7">618 N 41st St, Seattle, WA 98103, USA</p>
                        <p className="text-sm text-gray-500 ml-7 mt-1">
                          Unit: <span className="font-medium">N/A</span>
                        </p>
                      </div>
                      <div className="w-24 h-20 bg-slate-100 rounded-lg flex items-center justify-center text-xs text-gray-400 overflow-hidden">
                        <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
                          <MapPin className="h-6 w-6 text-slate-400" />
                        </div>
                      </div>
                    </div>

                    <div className="border-t"></div>

                    {/* Stop One */}
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <CircleDot className="h-5 w-5 text-green-500" />
                          <span className="font-medium text-gray-900">Stop One</span>
                        </div>
                        <p className="text-gray-700 ml-7">718-C N 94th St, Seattle, WA 98103, USA</p>
                      </div>
                      <div className="w-24 h-20 bg-slate-100 rounded-lg flex items-center justify-center text-xs text-gray-400 overflow-hidden">
                        <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
                          <MapPin className="h-6 w-6 text-slate-400" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - Hidden on mobile (cards appear inline above) */}
              <div className="hidden lg:block space-y-6">
                <InventoryCard projectId={firstProject?._id} router={router} />
                <EstimateCard />
                <MaterialsServicesCard />
              </div>
            </div>
          </div>
        </div>

        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}

// Inventory Card Component
function InventoryCard({ projectId, router }: { projectId?: string; router: any }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-blue-100 rounded-lg">
          <Package className="h-5 w-5 text-blue-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Inventory</h2>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Items:</span>
          <Badge variant="secondary" className="bg-blue-100 text-blue-700 font-semibold">13</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Volume:</span>
          <span className="font-semibold text-gray-900">604.0 ft³</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Weight:</span>
          <span className="font-semibold text-gray-900">4228.0 lbs</span>
        </div>
      </div>

      <button
        className="w-full flex items-center justify-center gap-2 text-blue-600 font-medium py-2.5 px-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => projectId && router.push(`/projects/${projectId}`)}
        disabled={!projectId}
      >
        <Package className="h-4 w-4" />
        Manage Inventory
      </button>
    </div>
  );
}

// Estimate Card Component
function EstimateCard() {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-amber-100 rounded-lg">
          <Calculator className="h-5 w-5 text-amber-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Estimate</h2>
      </div>

      <button className="w-full flex items-center justify-center gap-2 text-green-700 font-medium py-2.5 px-4 bg-green-100 rounded-lg hover:bg-green-200 transition-colors cursor-pointer mb-4">
        <Calculator className="h-4 w-4" />
        Calculate Estimate
      </button>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
        <div className="text-center">
          <Users className="h-5 w-5 text-gray-400 mx-auto mb-1" />
          <p className="text-xs text-gray-500">Crew</p>
          <p className="font-semibold text-gray-900">2</p>
        </div>
        <div className="text-center">
          <DollarSign className="h-5 w-5 text-gray-400 mx-auto mb-1" />
          <p className="text-xs text-gray-500">Rate</p>
          <p className="font-semibold text-gray-900">$179.00/hr</p>
        </div>
        <div className="text-center">
          <Truck className="h-5 w-5 text-gray-400 mx-auto mb-1" />
          <p className="text-xs text-gray-500">Trucks</p>
          <p className="font-semibold text-gray-900">1</p>
        </div>
      </div>

      {/* Dropdowns */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Select defaultValue="local">
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local</SelectItem>
            <SelectItem value="long-distance">Long Distance</SelectItem>
          </SelectContent>
        </Select>
        <Select defaultValue="hourly">
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hourly">Hourly Rate</SelectItem>
            <SelectItem value="flat">Flat Rate</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Time Breakdown */}
      <div className="space-y-3 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">Moving Time</span>
          <span className="text-gray-900">4 hrs 19 min</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">Drive Time</span>
          <span className="text-gray-900">0 min</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">Total Job Time</span>
          <span className="text-gray-900">5 hrs 35 min</span>
        </div>
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">Moving Cost</span>
          <span className="font-semibold text-gray-900">$998.38</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">Travel Fees</span>
          <span className="font-semibold text-gray-900">$0.00</span>
        </div>
      </div>

      {/* Protection */}
      <button className="mt-4 p-3 bg-slate-50 rounded-lg flex items-center gap-2 w-full hover:bg-slate-100 transition-colors cursor-pointer">
        <Shield className="h-5 w-5 text-slate-500" />
        <span className="text-sm text-gray-700">Basic Protection</span>
        <ChevronRight className="h-4 w-4 ml-auto text-gray-400" />
      </button>
    </div>
  );
}

// Materials & Services Card Component
function MaterialsServicesCard() {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-rose-100 rounded-lg">
          <Truck className="h-5 w-5 text-rose-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Materials & Services</h2>
      </div>

      {/* Materials */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-600">Materials</span>
          <Button variant="outline" size="sm" className="h-8">
            <Plus className="h-4 w-4 mr-1" />
            Add Material
          </Button>
        </div>
        <p className="text-sm text-gray-400 text-center py-4">No materials selected</p>
      </div>

      <div className="border-t pt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-600">Services</span>
          <Button variant="outline" size="sm" className="h-8">
            <Plus className="h-4 w-4 mr-1" />
            Add Service
          </Button>
        </div>
        <p className="text-sm text-gray-400 text-center py-4">No services selected</p>
      </div>
    </div>
  );
}
