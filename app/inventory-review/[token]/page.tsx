// app/inventory-review/[token]/page.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  Building2,
  Calendar,
  MapPin,
  ArrowRight,
  CheckCircle,
  Package,
  Image as ImageIcon,
  Video,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  PenTool,
  MessageSquare,
  Mail,
  Briefcase,
  Phone,
  Play,
  Boxes,
  Scale,
  Truck,
  Home,
  BedDouble
} from 'lucide-react';
import SignatureCanvas from '@/components/SignatureCanvas';
import { toast } from 'sonner';
import Logo from '../../../public/logo';

// Format phone number for display
const formatPhoneDisplay = (phone: string): string => {
  if (!phone) return '';
  // Handle Twilio format (+1XXXXXXXXXX)
  if (phone.startsWith('+1') && phone.length === 12) {
    const digits = phone.slice(2);
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Handle raw 10 digits
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
};

interface ProjectInfo {
  projectId: string;
  projectName: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerCompanyName?: string;
  jobDate?: string;
  origin?: { address: string; unit?: string };
  destination?: { address: string; unit?: string };
}

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

interface InventoryItem {
  _id: string;
  name: string;
  quantity: number;
  location?: string;
  going: 'going' | 'not going' | 'partial';
  goingQuantity?: number;
  special_handling?: string;
}

interface GroupedItems {
  [room: string]: InventoryItem[];
}

interface MediaSection {
  type: 'image' | 'video' | 'videoRecording';
  mediaId: string;
  mediaName: string;
  roomEntry?: string;
  items: GroupedItems;
  aiSummary?: {
    analysisSummary?: string | null;
    transcriptSummary?: string | null;
  };
}

interface BoxRecommendation {
  _id: string;
  name: string;
  quantity: number;
  location?: string;
  box_details?: {
    box_type?: string;
    capacity_cuft?: number;
    for_items?: string;
    room?: string;
  };
  box_recommendation?: {
    box_type?: string;
    box_quantity?: number;
  };
}

interface ExistingSignature {
  customerName: string;
  signatureDataUrl?: string;
  signedAt: string;
}

interface ProjectNote {
  _id: string;
  title?: string;
  content: string;
  category: string;
  isPinned: boolean;
  createdAt: string;
}

interface Stats {
  totalItems: number;
  totalBoxes: number;
  totalCuft: number;
  totalWeight: number;
  totalRooms: number;
  totalBedrooms: number;
}

interface ReviewData {
  isValid: boolean;
  projectInfo: ProjectInfo;
  branding?: BrandingData | null;
  stats: Stats;
  mediaSections: MediaSection[];
  boxRecommendationsByRoom: { [room: string]: BoxRecommendation[] };
  projectNotes: ProjectNote[];
  existingSignature?: ExistingSignature | null;
  expiresAt: string;
}

// Get recommended truck size based on cubic feet
function getTruckRecommendation(cuft: number): { size: string; description: string } {
  if (cuft <= 400) {
    return { size: 'Cargo Van', description: 'Studio or small delivery' };
  } else if (cuft <= 475) {
    return { size: '10-12 Foot Truck', description: 'Studio or 1-bedroom apartment' };
  } else if (cuft <= 920) {
    return { size: '15-17 Foot Truck', description: '1-2 bedroom home' };
  } else if (cuft <= 1070) {
    return { size: '20 Foot Truck', description: '2-3 bedroom home' };
  } else if (cuft <= 1200) {
    return { size: '22 Foot Truck', description: '3-4 bedroom home' };
  } else {
    return { size: '26 Foot Truck', description: '4+ bedroom home' };
  }
}

// Generate auto-signature from name using canvas
function generateAutoSignature(name: string): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  canvas.width = 400;
  canvas.height = 150;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Signature style
  ctx.fillStyle = '#1e293b';
  ctx.font = 'italic 48px "Brush Script MT", cursive, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw the name as signature
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);

  return canvas.toDataURL('image/png');
}

export default function InventoryReviewPage() {
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);

  // Signature modal state
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [useAutoSignature, setUseAutoSignature] = useState(true);
  const [autoSignatureUrl, setAutoSignatureUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(false);

  // Media loading state
  const [videoUrls, setVideoUrls] = useState<{ [key: string]: string }>({});
  const [loadingVideos, setLoadingVideos] = useState<Set<string>>(new Set());

  // Collapsible room state
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  const signOffRef = useRef<HTMLDivElement>(null);

  // Toggle room expansion
  const toggleRoom = (sectionIndex: number, room: string) => {
    const key = `${sectionIndex}-${room}`;
    setExpandedRooms(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Fetch video streaming URL
  const fetchVideoUrl = useCallback(async (mediaType: string, mediaId: string) => {
    const cacheKey = `${mediaType}-${mediaId}`;
    if (videoUrls[cacheKey] || loadingVideos.has(cacheKey)) return;

    setLoadingVideos(prev => new Set([...prev, cacheKey]));

    try {
      let endpoint = '';
      if (mediaType === 'video') {
        endpoint = `/api/inventory-review/${token}/videos/${mediaId}/stream`;
      } else if (mediaType === 'videoRecording') {
        endpoint = `/api/inventory-review/${token}/recordings/${mediaId}/stream`;
      }

      if (!endpoint) return;

      const response = await fetch(endpoint);
      if (response.ok) {
        const data = await response.json();
        setVideoUrls(prev => ({ ...prev, [cacheKey]: data.streamUrl }));
      }
    } catch (error) {
      console.error('Error fetching video URL:', error);
    } finally {
      setLoadingVideos(prev => {
        const next = new Set(prev);
        next.delete(cacheKey);
        return next;
      });
    }
  }, [token, videoUrls, loadingVideos]);

  // Fetch review data
  useEffect(() => {
    const fetchReviewData = async () => {
      try {
        const response = await fetch(`/api/inventory-review/${token}/validate`);

        if (!response.ok) {
          const errorData = await response.json();
          setError(errorData.error || 'Invalid review link');
          setLoading(false);
          return;
        }

        const data = await response.json();
        setReviewData(data);

        if (data.existingSignature) {
          setSigned(true);
        }

        // Pre-fill signature name from customer name
        if (data.projectInfo?.customerName) {
          setSignatureName(data.projectInfo.customerName);
        }
      } catch (err) {
        console.error('Error fetching review data:', err);
        setError('Failed to load inventory review');
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      fetchReviewData();
    }
  }, [token]);

  // Expand all rooms by default when review data loads
  useEffect(() => {
    if (reviewData) {
      const allRoomKeys = new Set<string>();
      reviewData.mediaSections.forEach((section, sectionIndex) => {
        Object.keys(section.items).forEach(room => {
          allRoomKeys.add(`${sectionIndex}-${room}`);
        });
      });
      setExpandedRooms(allRoomKeys);
    }
  }, [reviewData]);

  // Generate auto-signature when name changes
  useEffect(() => {
    if (signatureName.trim()) {
      const autoSig = generateAutoSignature(signatureName.trim());
      setAutoSignatureUrl(autoSig);
      if (useAutoSignature) {
        setSignatureDataUrl(autoSig);
      }
    } else {
      setAutoSignatureUrl(null);
      if (useAutoSignature) {
        setSignatureDataUrl(null);
      }
    }
  }, [signatureName, useAutoSignature]);

  const scrollToSignOff = () => {
    signOffRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const openSignatureModal = () => {
    setIsSignatureModalOpen(true);
  };

  const closeSignatureModal = () => {
    setIsSignatureModalOpen(false);
  };

  const handleSubmitSignature = async () => {
    if (!signatureName.trim()) {
      toast.error('Please enter your name');
      return;
    }

    const finalSignature = useAutoSignature ? autoSignatureUrl : signatureDataUrl;

    if (!finalSignature) {
      toast.error('Please provide a signature');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/inventory-review/${token}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: signatureName.trim(),
          signatureDataUrl: finalSignature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit signature');
      }

      const result = await response.json();
      setSigned(true);
      setReviewData(prev => prev ? {
        ...prev,
        existingSignature: result.signature
      } : null);
      setIsSignatureModalOpen(false);
      toast.success('Inventory signed successfully!');
    } catch (error) {
      console.error('Error submitting signature:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  // Render going status badge
  const renderGoingBadge = (item: InventoryItem) => {
    if (item.going === 'going') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
          <Check className="w-3 h-3" />
          Going
        </span>
      );
    } else if (item.going === 'not going') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
          <X className="w-3 h-3" />
          Not Going
        </span>
      );
    } else {
      const going = item.goingQuantity ?? 0;
      const total = item.quantity ?? 1;
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">
          Partial ({going}/{total})
        </span>
      );
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading Inventory Review</h2>
            <p className="text-slate-600">Please wait while we load your inventory...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !reviewData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <X className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Link Not Found</h2>
            <p className="text-slate-600">{error || 'This review link is invalid or has expired.'}</p>
            <p className="text-slate-500 text-sm mt-4">
              Please contact your moving company for a new link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { projectInfo, branding, stats, mediaSections, boxRecommendationsByRoom, projectNotes, existingSignature } = reviewData;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-slate-200/50 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {branding?.companyLogo ? (
                <img
                  src={branding.companyLogo}
                  alt={branding.companyName}
                  className="w-10 h-10 object-contain rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
              )}
              <div>
                <p className="font-medium text-slate-800">
                  {branding?.companyName || 'Moving Company'}
                </p>
                <p className="text-sm text-slate-500">Inventory Review</p>
              </div>
            </div>

            <button
              onClick={scrollToSignOff}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
              Sign Off on Inventory
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Project Info Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
            <h2 className="text-lg font-semibold text-blue-800">Project Information</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Customer</p>
                <p className="font-medium text-slate-800">{projectInfo.customerName}</p>
              </div>
            </div>

            {projectInfo.customerCompanyName && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Briefcase className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Company</p>
                  <p className="font-medium text-slate-800">{projectInfo.customerCompanyName}</p>
                </div>
              </div>
            )}

            {projectInfo.customerPhone && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Phone className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Phone</p>
                  <p className="font-medium text-slate-800">{formatPhoneDisplay(projectInfo.customerPhone)}</p>
                </div>
              </div>
            )}

            {projectInfo.customerEmail && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Mail className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Email</p>
                  <p className="font-medium text-slate-800">{projectInfo.customerEmail}</p>
                </div>
              </div>
            )}

            {projectInfo.jobDate && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Move Date</p>
                  <p className="font-medium text-slate-800">
                    {new Date(projectInfo.jobDate).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            )}

            {(projectInfo.origin?.address || projectInfo.destination?.address) && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center mt-1">
                  <MapPin className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-500">Moving Route</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {projectInfo.origin?.address && (
                      <span className="text-slate-800">
                        {projectInfo.origin.address}
                        {projectInfo.origin.unit && `, ${projectInfo.origin.unit}`}
                      </span>
                    )}
                    {projectInfo.origin?.address && projectInfo.destination?.address && (
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    )}
                    {projectInfo.destination?.address && (
                      <span className="text-slate-800">
                        {projectInfo.destination.address}
                        {projectInfo.destination.unit && `, ${projectInfo.destination.unit}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {stats && stats.totalRooms > 0 && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center mt-1">
                  <Home className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-500">Property Size</p>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-slate-800">
                      <span className="font-medium">{stats.totalRooms}</span> {stats.totalRooms === 1 ? 'Room' : 'Rooms'}
                    </span>
                    {stats.totalBedrooms > 0 && (
                      <span className="text-slate-800 flex items-center gap-1">
                        <BedDouble className="w-4 h-4 text-slate-400" />
                        <span className="font-medium">{stats.totalBedrooms}</span> {stats.totalBedrooms === 1 ? 'Bedroom' : 'Bedrooms'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Summary */}
        {stats && (stats.totalItems > 0 || stats.totalBoxes > 0) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Package className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-sm font-medium text-slate-600">Items</p>
              </div>
              <p className="text-2xl font-bold text-slate-800">{stats.totalItems.toLocaleString()}</p>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-amber-600" />
                </div>
                <p className="text-sm font-medium text-slate-600">Boxes</p>
              </div>
              <p className="text-2xl font-bold text-slate-800">{stats.totalBoxes.toLocaleString()}</p>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Scale className="w-5 h-5 text-green-600" />
                </div>
                <p className="text-sm font-medium text-slate-600">Weight</p>
              </div>
              <p className="text-2xl font-bold text-slate-800">{stats.totalWeight.toLocaleString()}</p>
              <p className="text-xs text-slate-500">lbs</p>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Truck className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-sm font-medium text-slate-600">Truck Size</p>
              </div>
              <p className="text-lg font-bold text-slate-800">{getTruckRecommendation(stats.totalCuft).size}</p>
              <p className="text-xs text-slate-500">{stats.totalCuft.toLocaleString()} cu ft</p>
            </div>
          </div>
        )}

        {/* Media Sections */}
        {mediaSections.map((section, index) => (
          <div key={`${section.type}-${section.mediaId}-${index}`} className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                  {section.type === 'image' ? (
                    <ImageIcon className="w-4 h-4 text-slate-600" />
                  ) : (
                    <Video className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{section.mediaName}</h3>
                  {section.roomEntry && (
                    <p className="text-sm text-slate-500">Room: {section.roomEntry}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Media Display */}
              {section.mediaId !== 'manual' && (
                <div className="rounded-lg overflow-hidden bg-slate-100 aspect-video flex items-center justify-center">
                  {section.type === 'image' ? (
                    <img
                      src={`/api/inventory-review/${token}/images/${section.mediaId}`}
                      alt={section.mediaName}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full">
                      {videoUrls[`${section.type}-${section.mediaId}`] ? (
                        <video
                          src={videoUrls[`${section.type}-${section.mediaId}`]}
                          controls
                          className="w-full h-full"
                        />
                      ) : loadingVideos.has(`${section.type}-${section.mediaId}`) ? (
                        <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-slate-500">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <span>Loading video...</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => fetchVideoUrl(section.type, section.mediaId)}
                          className="flex flex-col items-center justify-center w-full h-full gap-3 text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                          <Play className="w-12 h-12" />
                          <span className="font-medium">Click to load video</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* AI Summary for Video Recordings */}
              {section.type === 'videoRecording' && section.aiSummary && (section.aiSummary.analysisSummary || section.aiSummary.transcriptSummary) && (
                <div className="space-y-3">
                  {section.aiSummary.transcriptSummary && (
                    <div className="p-4 rounded-lg border bg-green-50 border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="w-4 h-4 text-green-600" />
                        <h4 className="font-medium text-green-800">AI Summary</h4>
                      </div>
                      <p className="text-slate-600 whitespace-pre-wrap">{section.aiSummary.transcriptSummary}</p>
                    </div>
                  )}
                  {section.aiSummary.analysisSummary && (
                    <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Package className="w-4 h-4 text-blue-600" />
                        <h4 className="font-medium text-blue-800">Packing Notes</h4>
                      </div>
                      <p className="text-slate-600 whitespace-pre-wrap">{section.aiSummary.analysisSummary}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Items by Room */}
              {Object.keys(section.items).length > 0 ? (
                <div className="space-y-3">
                  <h4 className="font-medium text-slate-700">Items Found</h4>
                  {Object.entries(section.items).map(([room, items]) => {
                    const roomKey = `${index}-${room}`;
                    const isExpanded = expandedRooms.has(roomKey);

                    return (
                      <div key={room} className="border border-slate-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleRoom(index, room)}
                          className="w-full bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-slate-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-500" />
                            )}
                            <h5 className="font-medium text-slate-700">{room}</h5>
                            <span className="text-xs text-slate-500">({items.length} items)</span>
                          </div>
                        </button>

                        {isExpanded && (
                          <table className="w-full">
                            <thead>
                              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                                <th className="py-2 px-4 font-medium">Item</th>
                                <th className="py-2 px-4 font-medium w-16 text-center">Qty</th>
                                <th className="py-2 px-4 font-medium text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {items.map((item) => (
                                <tr key={item._id}>
                                  <td className="py-3 px-4">
                                    <p className="font-medium text-slate-800">{item.name}</p>
                                    {item.special_handling && (
                                      <p className="text-xs text-blue-600 mt-0.5">{item.special_handling}</p>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-center text-slate-600">
                                    {item.quantity}
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    {renderGoingBadge(item)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-slate-500 text-center py-4">No items found in this media</p>
              )}
            </div>
          </div>
        ))}

        {/* Box Recommendations by Room */}
        {Object.keys(boxRecommendationsByRoom).length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-amber-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                  <Package className="w-4 h-4 text-amber-600" />
                </div>
                <h3 className="font-semibold text-amber-800">Recommended Boxes</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {Object.entries(boxRecommendationsByRoom).map(([room, boxes]) => (
                  <div key={room} className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Home className="w-4 h-4 text-slate-500" />
                      <h4 className="font-semibold text-slate-700">{room}</h4>
                    </div>
                    <div className="space-y-2">
                      {boxes.map((box) => (
                        <div key={box._id} className="bg-white rounded-lg px-4 py-3 flex items-center justify-between shadow-sm">
                          <div className="flex-1">
                            <p className="font-medium text-slate-800">
                              {box.box_recommendation?.box_type || box.box_details?.box_type || box.name}
                            </p>
                            {box.box_details?.for_items && (
                              <p className="text-sm text-slate-500 mt-0.5">{box.box_details.for_items}</p>
                            )}
                          </div>
                          <div className="ml-4 text-slate-900 font-semibold">
                            {box.box_recommendation?.box_quantity || box.quantity}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Total */}
              <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center">
                <span className="font-semibold text-slate-700">Total Boxes</span>
                <span className="text-slate-900 font-bold text-lg">
                  {Object.values(boxRecommendationsByRoom).flat().reduce((sum, box) => sum + (box.box_recommendation?.box_quantity || box.quantity), 0)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Project Notes */}
        {projectNotes && projectNotes.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-50 to-violet-50 px-6 py-4 border-b border-purple-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                  <MessageSquare className="w-4 h-4 text-purple-600" />
                </div>
                <h3 className="font-semibold text-purple-800">Notes</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {projectNotes.map((note) => (
                  <div
                    key={note._id}
                    className={`p-4 rounded-lg border ${
                      note.isPinned
                        ? 'bg-purple-50 border-purple-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    {note.title && (
                      <h4 className="font-medium text-slate-800 mb-2">{note.title}</h4>
                    )}
                    <p className="text-slate-600 whitespace-pre-wrap">{note.content}</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                      <span className="capitalize">{note.category.replace('-', ' ')}</span>
                      <span>•</span>
                      <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Sign-Off Section */}
        <div ref={signOffRef} id="sign-off" className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-green-100">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
              </div>
              <h3 className="font-semibold text-green-800">Sign Off on Inventory</h3>
            </div>
          </div>

          <div className="p-6">
            {signed || existingSignature ? (
              <div className="py-8">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-slate-800 mb-2">
                    Inventory Approved
                  </h4>
                </div>

                {/* Signature Display */}
                {(existingSignature?.signatureDataUrl || signatureDataUrl) && (
                  <div className="max-w-sm mx-auto mb-6">
                    <div className="border-2 border-green-200 rounded-lg bg-green-50 p-4">
                      <img
                        src={existingSignature?.signatureDataUrl || signatureDataUrl || ''}
                        alt="Customer signature"
                        className="w-full h-auto"
                      />
                    </div>
                  </div>
                )}

                <div className="text-center">
                  <p className="text-slate-600">
                    Signed by <strong>{existingSignature?.customerName || signatureName}</strong>
                  </p>
                  <p className="text-slate-500 text-sm mt-1">
                    {new Date(existingSignature?.signedAt || new Date()).toLocaleString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-600 mb-6">
                  By signing, you confirm that the inventory listed above is accurate and complete to the best of your knowledge.
                </p>
                <button
                  onClick={openSignatureModal}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  <PenTool className="w-5 h-5" />
                  Sign Inventory
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <div className="inline-flex items-center text-slate-400 text-sm">
            <span>Powered by</span>
            <div className="scale-[0.8] origin-center -ml-2">
              <Logo />
            </div>
          </div>
        </div>
      </div>

      {/* Signature Modal */}
      {isSignatureModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <PenTool className="text-green-600" size={24} />
                  Sign Inventory
                </h2>
                <button
                  onClick={closeSignatureModal}
                  className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                  disabled={submitting}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Name Input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  disabled={submitting}
                />
              </div>

              {/* Auto Signature Preview */}
              {autoSignatureUrl && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Signature
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useAutoSignature}
                        onChange={(e) => {
                          setUseAutoSignature(e.target.checked);
                          if (e.target.checked) {
                            setSignatureDataUrl(autoSignatureUrl);
                          } else {
                            setSignatureDataUrl(null);
                          }
                        }}
                        className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                        disabled={submitting}
                      />
                      Use auto-generated signature
                    </label>
                  </div>

                  {useAutoSignature ? (
                    <div className="border-2 border-green-200 rounded-lg p-4 bg-green-50">
                      <img
                        src={autoSignatureUrl}
                        alt="Auto-generated signature"
                        className="w-full h-auto"
                      />
                      <p className="text-xs text-green-700 text-center mt-2">
                        Click the checkbox above to draw your own signature
                      </p>
                    </div>
                  ) : (
                    <div>
                      <SignatureCanvas
                        onSignatureChange={setSignatureDataUrl}
                        width={Math.min(350, typeof window !== 'undefined' ? window.innerWidth - 100 : 350)}
                        height={150}
                        disabled={submitting}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Terms */}
              <p className="text-xs text-slate-500">
                By clicking "Approve Inventory", you confirm that the inventory is accurate and complete to the best of your knowledge.
              </p>

              {/* Submit Button */}
              <button
                onClick={handleSubmitSignature}
                disabled={submitting || !signatureName.trim() || (!useAutoSignature && !signatureDataUrl)}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Approve Inventory
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
