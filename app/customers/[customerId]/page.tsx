'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2, Video, Camera, MessageSquare, Clock, Download } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { useOrganization } from '@clerk/nextjs';
import { hasAddOn } from '@/lib/client-utils';
import IntercomChat from '@/components/IntercomChat';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";
import InventoryContent from "@/components/inventory/InventoryContent";
import AdminPhotoUploader from "@/components/AdminPhotoUploader";
import SendUploadLinkModal from "@/components/SendUploadLinkModal";
import ShareVideoLinkModal from "@/components/video/ShareVideoLinkModal";
import ActivityLog from "@/components/ActivityLog";
import VideoProcessingStatus from "@/components/VideoProcessingStatus";
import simpleRealTime from '@/lib/simple-realtime';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X } from 'lucide-react';

interface Customer {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveDate: string;
  referralSource: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { organization } = useOrganization();
  const customerId = params?.customerId as string;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentProject, setCurrentProject] = useState<any>(null);
  const [inventoryStats, setInventoryStats] = useState<any[]>([]);
  
  // Modal states for actions
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [isSendLinkModalOpen, setIsSendLinkModalOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [videoRoomId, setVideoRoomId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  
  // Processing status states
  const [processingStatus, setProcessingStatus] = useState<any[]>([]);
  const [showProcessingNotification, setShowProcessingNotification] = useState(false);
  const [imageGalleryKey, setImageGalleryKey] = useState(0);
  
  // Check if user has CRM add-on access
  const hasCrmAddOn = organization && hasAddOn(organization, 'crm');
  
  // Action handlers for menubar
  const generateVideoRoomId = (projectId: string) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${projectId}-${timestamp}-${random}`;
  };

  const handleStartVideoInventory = () => {
    if (!currentProject) return;
    const roomId = generateVideoRoomId(currentProject._id);
    setVideoRoomId(roomId);
    setIsVideoModalOpen(true);
  };

  const handleUploadInventory = () => {
    setIsUploaderOpen(true);
  };

  const handleSendUploadLink = () => {
    setIsSendLinkModalOpen(true);
  };

  const handleActivityLog = () => {
    setIsActivityLogOpen(true);
  };

  const handleDownloadProject = () => {
    if (!currentProject || !inventoryStats.length) {
      console.log('No project or stats available for download');
      return;
    }

    // Dynamic import to ensure jspdf-autotable is loaded
    const jsPDF = require('jspdf');
    const doc = new jsPDF();
    
    // Set up fonts and colors
    const primaryColor = [59, 130, 246]; // blue-500
    const textColor = [71, 85, 105]; // slate-600
    const lightGray = [248, 250, 252]; // slate-50
    
    // Add header with project name
    doc.setFontSize(24);
    doc.setTextColor(...primaryColor);
    doc.text(currentProject?.name || 'Inventory Report', 20, 20);
    
    // Add date
    doc.setFontSize(10);
    doc.setTextColor(...textColor);
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 20, 30);
    
    // Calculate stats from inventoryStats
    const totalItems = inventoryStats.reduce((sum, row) => sum + (parseFloat(row.cells?.col3) || 0), 0);
    const totalBoxes = totalItems; // Assuming items = boxes for simplicity
    const totalCuft = inventoryStats.reduce((sum, row) => sum + (parseFloat(row.cells?.col4) || 0), 0);
    const totalWeight = inventoryStats.reduce((sum, row) => sum + (parseFloat(row.cells?.col5) || 0), 0);
    
    // Add stats section
    let yPosition = 45;
    doc.setFontSize(16);
    doc.setTextColor(...primaryColor);
    doc.text('Summary Statistics', 20, yPosition);
    
    yPosition += 15;
    
    // Stats grid
    const stats = [
      { label: 'Total Items', value: totalItems.toString(), icon: '📦' },
      { label: 'Total Boxes', value: totalBoxes.toString(), icon: '📦' },
      { label: 'Total Cu.Ft.', value: totalCuft.toString(), icon: '📐' },
      { label: 'Total Weight', value: `${totalWeight} lbs`, icon: '⚖️' }
    ];
    
    doc.setFontSize(11);
    stats.forEach((stat, index) => {
      const xPos = 20 + (index % 2) * 90;
      const yPos = yPosition + Math.floor(index / 2) * 20;
      
      // Stat box background
      doc.setFillColor(...lightGray);
      doc.roundedRect(xPos - 5, yPos - 10, 80, 15, 2, 2, 'F');
      
      // Stat label
      doc.setTextColor(...textColor);
      doc.setFontSize(9);
      doc.text(stat.label, xPos, yPos - 3);
      
      // Stat value
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(stat.value, xPos, yPos + 4);
      doc.setFont('helvetica', 'normal');
    });
    
    yPosition += 50;
    
    // Add inventory table
    doc.setFontSize(16);
    doc.setTextColor(...primaryColor);
    doc.text('Inventory Items', 20, yPosition);
    
    yPosition += 10;
    
    // Save the PDF
    const fileName = `${currentProject.name || 'inventory'}-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}.pdf`;
    doc.save(fileName);
  };

  // Handle file upload for AdminPhotoUploader (copied from InventoryManager)
  const handleFileUpload = async (file: File) => {
    if (!currentProject) return;
    
    setUploading(true);
    
    // IMMEDIATE: Add to processing status for instant UI feedback
    const uploadId = `upload-${Date.now()}`;
    const isVideo = file.type.startsWith('video/');
    
    simpleRealTime.addProcessing(currentProject._id, {
      id: uploadId,
      name: file.name,
      type: isVideo ? 'video' : 'image',
      itemType: isVideo ? 'video' : 'image',
      status: isVideo ? 'AI video analysis in progress...' : 'AI analysis in progress...'
    });
    
    try {
      console.log('🚀 Starting admin file upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        projectId: currentProject._id,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
      });
      
      const formData = new FormData();
      formData.append('image', file); // Use 'image' field name like the original
      
      const response = await fetch(`/api/projects/${currentProject._id}/admin-upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });
      
      console.log('📡 Admin upload response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Admin upload API error:', errorText);
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Upload successful:', result);
      
      // Mark processing as completed
      simpleRealTime.completeProcessing(currentProject._id, uploadId);

      toast.success(`${isVideo ? 'Video' : 'Image'} uploaded successfully!`);
      
    } catch (error) {
      console.error('Error uploading file:', error);
      // Complete processing on error to remove it from the list
      simpleRealTime.completeProcessing(currentProject._id, uploadId);
      toast.error(`Failed to upload ${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`);
    } finally {
      setUploading(false);
    }
  };
  
  // Fetch customer data and project data
  useEffect(() => {
    const fetchCustomer = async () => {
      if (!hasCrmAddOn) return;
      
      try {
        const response = await fetch('/api/customers');
        if (response.ok) {
          const data = await response.json();
          const foundCustomer = data.customers.find((c: Customer) => c._id === customerId);
          setCustomer(foundCustomer || null);
          
          // If customer has a project, fetch the project data immediately
          if (foundCustomer?.projectId) {
            const projectResponse = await fetch(`/api/projects/${foundCustomer.projectId}`);
            if (projectResponse.ok) {
              const projectData = await projectResponse.json();
              setCurrentProject(projectData);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching customer:', error);
      } finally {
        setLoading(false);
      }
    };

    if (organization !== undefined) {
      if (!hasCrmAddOn) {
        router.push('/projects');
      } else {
        fetchCustomer();
      }
    }
  }, [organization, hasCrmAddOn, router, customerId]);

  // Real-time processing updates (copied from InventoryManager)
  useEffect(() => {
    if (!currentProject) return;
    
    const handleRealTimeUpdate = (event: any) => {
      switch (event.type) {
        case 'processing-added':
          setProcessingStatus(event.processingItems);
          setShowProcessingNotification(event.processingItems.length > 0);
          toast.info(`Started processing: ${event.data.name}`);
          break;
          
        case 'processing-completed':
          setProcessingStatus(event.processingItems);
          setShowProcessingNotification(event.processingItems.length > 0);
          toast.success(`✅ Completed: ${event.data.name}`);
          // Refresh image gallery when processing completes
          setImageGalleryKey(prev => prev + 1);
          break;
      }
    };
    
    // Add listener and get initial state
    const initialProcessing = simpleRealTime.addListener(currentProject._id, handleRealTimeUpdate);
    setProcessingStatus(initialProcessing);
    setShowProcessingNotification(initialProcessing.length > 0);

    return () => {
      simpleRealTime.removeListener(currentProject._id, handleRealTimeUpdate);
    };
  }, [currentProject?._id]);

  // Processing Notification Component (copied from InventoryManager)
  const ProcessingNotification = () => {
    if (!showProcessingNotification || processingStatus.length === 0) {
      return null;
    }

    const imageCount = processingStatus.filter(p => p.itemType === 'image').length;
    const videoCount = processingStatus.filter(p => p.itemType === 'video').length;
    const customerUploadCount = processingStatus.filter(p => p.isCustomerUpload).length;
    
    let message = 'Processing ';
    const parts = [];
    
    if (imageCount > 0) {
      parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);
    }
    if (videoCount > 0) {
      parts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
    }
    
    message += parts.join(' and ');
    
    if (customerUploadCount > 0) {
      if (customerUploadCount === processingStatus.length) {
        message += ' (customer uploads)';
      } else {
        message += ` (${customerUploadCount} customer upload${customerUploadCount > 1 ? 's' : ''})`;
      }
    }
    
    message += '...';

    return (
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700 font-medium">{message}</p>
          </div>
        </div>
      </div>
    );
  };

  // Show loading while checking organization access or loading customer
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

  // Show 404 if customer not found
  if (!customer) {
    return (
      <SidebarProvider>
        <div className="min-h-screen bg-slate-50">
          <AppSidebar />
          <DesktopHeaderBar />
          
          <div className="pt-16 lg:pl-64 lg:pt-16 p-6 md:ml-6 md:mt-6">
            <div className="lg:hidden mb-4">
              <SidebarTrigger />
            </div>
            
            <div className="flex justify-center w-full">
              <div className="max-w-4xl w-full">
                <div className="text-center py-12">
                  <h1 className="text-2xl font-semibold text-gray-900 mb-2">Customer not found</h1>
                  <p className="text-gray-600">The customer you're looking for doesn't exist.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <IntercomChat />
      </SidebarProvider>
    );
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
          
          {/* Customer Detail Content */}
          <div className="flex justify-center w-full">
            <div className="max-w-4xl w-full">
              {/* Breadcrumb */}
              <div className="mb-6">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink onClick={() => router.push('/customers')} className="cursor-pointer">
                        Customers
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{customer.firstName} {customer.lastName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>

              {/* Processing Notification */}
              <ProcessingNotification />

              {/* Tab System */}
              <Tabs defaultValue="overview" className="w-full">
                <div className="flex justify-between items-center mb-6">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="inventory">
                      Inventory
                    </TabsTrigger>
                    <TabsTrigger value="files">Files</TabsTrigger>
                    <TabsTrigger value="billing">Billing</TabsTrigger>
                  </TabsList>
                  
                  {/* Actions Menubar - Only show if we have a project */}
                  {currentProject && (
                    <Menubar>
                      <MenubarMenu>
                        <MenubarTrigger className="gap-1 cursor-pointer">
                          Actions
                        </MenubarTrigger>
                        <MenubarContent>
                          <MenubarItem onClick={handleStartVideoInventory}>
                            <Video size={16} className="mr-1" /> Start Video Inventory
                          </MenubarItem>
                          <MenubarItem onClick={handleUploadInventory}>
                            <Camera size={16} className="mr-1" />Upload Inventory
                          </MenubarItem>
                          <MenubarItem onClick={handleSendUploadLink}>
                            <MessageSquare size={16} className="mr-1" />
                            Send Customer Upload Link
                          </MenubarItem>
                          <MenubarSeparator />
                          <MenubarItem onClick={handleActivityLog}>
                            <Clock size={16} className="mr-1" />
                            Activity Log
                          </MenubarItem>
                          <MenubarSeparator />
                          <MenubarItem onClick={handleDownloadProject}>
                            <Download size={16} className="mr-1" />
                            Download
                          </MenubarItem>
                        </MenubarContent>
                      </MenubarMenu>
                    </Menubar>
                  )}
                </div>

                <TabsContent value="overview">
                  {/* Overview Layout */}
                  <div className="flex flex-col lg:flex-row gap-4">
                    {/* Left Column - 2/3 width on large screens */}
                    <div className="lg:w-2/3 space-y-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Customer Information</CardTitle>
                          <CardDescription>Basic details about the customer</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-700">Name:</span>
                              <span>{customer.firstName} {customer.lastName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-700">Email:</span>
                              <span>{customer.email}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-700">Phone:</span>
                              <span>{customer.phone}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-700">Move Date:</span>
                              <span>{new Date(customer.moveDate).toLocaleDateString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-700">Referral Source:</span>
                              <span>{customer.referralSource}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <CardHeader>
                          <CardTitle>Move Details</CardTitle>
                          <CardDescription>Information about the move</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p>Move details content here</p>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <CardHeader>
                          <CardTitle>Communication History</CardTitle>
                          <CardDescription>Past conversations and interactions</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p>Communication history content here</p>
                        </CardContent>
                      </Card>
                    </div>
                    
                    {/* Right Column - 1/3 width on large screens */}
                    <div className="lg:w-1/3 space-y-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Status</CardTitle>
                          <CardDescription>Current customer status</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p>Status content here</p>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <CardHeader>
                          <CardTitle>Quick Actions</CardTitle>
                          <CardDescription>Common tasks</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p>Quick actions content here</p>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <CardHeader>
                          <CardTitle>Notes</CardTitle>
                          <CardDescription>Important notes and reminders</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p>Notes content here</p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="inventory">
                  {customer?.projectId ? (
                    <InventoryContent 
                      customerId={customer._id}
                    />
                  ) : (
                    <Card>
                      <CardHeader>
                        <CardTitle>No Project Associated</CardTitle>
                        <CardDescription>This customer doesn't have an associated project for inventory management</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p>To manage inventory, a project must be associated with this customer.</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="files">
                  <Card>
                    <CardHeader>
                      <CardTitle>Files</CardTitle>
                      <CardDescription>Customer files and documents</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p>Files content here</p>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="billing">
                  <Card>
                    <CardHeader>
                      <CardTitle>Billing Information</CardTitle>
                      <CardDescription>Invoices, payments, and billing history</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p>Billing content here</p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
              
            </div>
          </div>
        </div>
      </div>
      
      {/* Modal Components - Moved from InventoryContent */}
      
      {/* Photo Uploader Modal */}
      {isUploaderOpen && currentProject && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 p-3 sm:p-4 flex justify-between items-center border-b bg-white">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">Add Items from Photos or Videos</h2>
              <button 
                onClick={() => setIsUploaderOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 transition-colors cursor-pointer focus:ring-2 focus:ring-slate-500 focus:outline-none"
              >
                <X size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-smooth p-3 sm:p-6 overscroll-contain" style={{ maxHeight: 'calc(95vh - 4rem)', WebkitOverflowScrolling: 'touch' }}>
              <AdminPhotoUploader 
                onUpload={handleFileUpload}
                uploading={uploading}
                onClose={() => setIsUploaderOpen(false)}
                projectId={currentProject._id}
              />
            </div>
          </div>
        </div>
      )}

      {/* Send Upload Link Modal */}
      {isSendLinkModalOpen && currentProject && (
        <SendUploadLinkModal
          isOpen={isSendLinkModalOpen}
          onClose={() => setIsSendLinkModalOpen(false)}
          projectId={currentProject._id}
          projectName={currentProject.name}
          customerName={currentProject.customerName}
        />
      )}

      {/* Activity Log Dialog */}
      {isActivityLogOpen && currentProject && (
        <Dialog open={isActivityLogOpen} onOpenChange={setIsActivityLogOpen}>
          <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Activity Log</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-hidden">
              <ActivityLog 
                projectId={currentProject._id} 
                onClose={() => setIsActivityLogOpen(false)}
                embedded={true}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Video Share Modal */}
      {isVideoModalOpen && videoRoomId && currentProject && (
        <ShareVideoLinkModal
          isOpen={isVideoModalOpen}
          onClose={() => setIsVideoModalOpen(false)}
          roomId={videoRoomId}
          projectId={currentProject._id}
          projectName={currentProject.name}
          customerName={currentProject.customerName}
        />
      )}

      {/* Video Processing Status - Hidden but handles completion events */}
      {currentProject && (
        <div style={{ display: 'none' }}>
          <VideoProcessingStatus 
            projectId={currentProject._id}
            onProcessingComplete={(completedVideos: any[]) => {
              // Refresh the image gallery when video processing completes
              setImageGalleryKey(prev => prev + 1);
              
              // Show notification about completed videos
              if (completedVideos.length > 0) {
                toast.success(
                  `Video processing complete! ${completedVideos.length} video${completedVideos.length > 1 ? 's' : ''} analyzed successfully.`
                );
              }
            }}
          />
        </div>
      )}
      
      <IntercomChat />
    </SidebarProvider>
  );
}