// app/crew-review/[token]/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  Building2,
  Calendar,
  MapPin,
  ArrowRight,
  Package,
  Image as ImageIcon,
  Video,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  MessageSquare,
  Mail,
  Briefcase,
  Boxes,
  Scale,
  Ruler,
  Phone,
  Play,
  Home,
  BedDouble
} from 'lucide-react';
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
  location: string;
  cuft: number;
  weight: number;
  going: 'going' | 'not going' | 'partial';
  goingQuantity: number;
  packed_by: string;
  itemType: string;
  sourceImageId?: string;
  sourceVideoId?: string;
  sourceVideoRecordingId?: string;
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

interface Stats {
  totalItems: number;
  totalBoxes: number;
  totalBoxesWithRec: number;
  totalCuft: number;
  totalCuftWithRec: number;
  totalWeight: number;
  totalWeightWithRec: number;
  totalRooms: number;
  totalBedrooms: number;
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

interface ProjectNote {
  _id: string;
  title?: string;
  content: string;
  category: string;
  isPinned: boolean;
  createdAt: string;
}

interface ReviewData {
  isValid: boolean;
  projectInfo: ProjectInfo;
  branding?: BrandingData | null;
  mediaSections: MediaSection[];
  boxRecommendationsByRoom: { [room: string]: BoxRecommendation[] };
  stats: Stats;
  projectNotes: ProjectNote[];
  expiresAt: string;
}

export default function CrewReviewPage() {
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);

  // Collapsible room state
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  // Media loading state
  const [videoUrls, setVideoUrls] = useState<{ [key: string]: string }>({});
  const [loadingVideos, setLoadingVideos] = useState<Set<string>>(new Set());

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

  // Expand all rooms by default
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

  // Fetch video streaming URL
  const fetchVideoUrl = useCallback(async (mediaType: string, mediaId: string) => {
    const cacheKey = `${mediaType}-${mediaId}`;
    if (videoUrls[cacheKey] || loadingVideos.has(cacheKey)) return;

    setLoadingVideos(prev => new Set([...prev, cacheKey]));

    try {
      let endpoint = '';
      if (mediaType === 'video') {
        endpoint = `/api/crew-review/${token}/videos/${mediaId}/stream`;
      } else if (mediaType === 'videoRecording') {
        endpoint = `/api/crew-review/${token}/recordings/${mediaId}/stream`;
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
        const response = await fetch(`/api/crew-review/${token}/validate`);

        if (!response.ok) {
          const errorData = await response.json();
          setError(errorData.error || 'Invalid review link');
          setLoading(false);
          return;
        }

        const data = await response.json();
        setReviewData(data);
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

  // Render going status badge
  const renderGoingBadge = (item: InventoryItem) => {
    if (item.going === 'going') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
          <Check className="w-3 h-3" />
        </span>
      );
    } else if (item.going === 'not going') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
          <X className="w-3 h-3" />
        </span>
      );
    } else {
      const going = item.goingQuantity ?? 0;
      const total = item.quantity ?? 1;
      return (
        <span className="inline-flex items-center px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">
          {going}/{total}
        </span>
      );
    }
  };

  // Render item type badge
  const renderItemTypeBadge = (itemType: string) => {
    if (itemType === 'boxes_needed') {
      return <span className="ml-1 text-xs text-amber-600">(Rec)</span>;
    } else if (itemType === 'existing_box' || itemType === 'packed_box') {
      return <span className="ml-1 text-xs text-blue-600">(Box)</span>;
    }
    return null;
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading Crew Inventory</h2>
            <p className="text-slate-600">Please wait while we load the inventory...</p>
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
              Please contact your supervisor for a new link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { projectInfo, branding, mediaSections, boxRecommendationsByRoom, stats, projectNotes } = reviewData;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-slate-100">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-slate-200/50 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {branding?.companyLogo ? (
                <img
                  src={branding.companyLogo}
                  alt={branding.companyName}
                  className="w-10 h-10 object-contain rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-indigo-600" />
                </div>
              )}
              <div>
                <p className="font-medium text-slate-800">
                  {branding?.companyName || 'Moving Company'}
                </p>
                <p className="text-sm text-slate-500">Crew Inventory View</p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm font-medium text-slate-800">{projectInfo.customerName}</p>
              {projectInfo.jobDate && (
                <p className="text-xs text-slate-500">
                  {new Date(projectInfo.jobDate).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Project Info Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4 border-b border-indigo-100">
            <h2 className="text-lg font-semibold text-indigo-800">Project Details</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Customer</p>
                  <p className="font-medium text-slate-800">{projectInfo.customerName}</p>
                </div>
              </div>

              {projectInfo.customerCompanyName && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                    <Briefcase className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Company</p>
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
                    <p className="text-xs text-slate-500">Phone</p>
                    <a
                      href={`tel:${projectInfo.customerPhone}`}
                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {formatPhoneDisplay(projectInfo.customerPhone)}
                    </a>
                  </div>
                </div>
              )}

              {projectInfo.customerEmail && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                    <Mail className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
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
                    <p className="text-xs text-slate-500">Move Date</p>
                    <p className="font-medium text-slate-800">
                      {new Date(projectInfo.jobDate).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {(projectInfo.origin?.address || projectInfo.destination?.address) && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center mt-1">
                    <MapPin className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-500">Moving Route</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {projectInfo.origin?.address && (
                        <span className="text-slate-800 text-sm">
                          {projectInfo.origin.address}
                          {projectInfo.origin.unit && `, ${projectInfo.origin.unit}`}
                        </span>
                      )}
                      {projectInfo.origin?.address && projectInfo.destination?.address && (
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                      )}
                      {projectInfo.destination?.address && (
                        <span className="text-slate-800 text-sm">
                          {projectInfo.destination.address}
                          {projectInfo.destination.unit && `, ${projectInfo.destination.unit}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {stats && stats.totalRooms > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center mt-1">
                    <Home className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-500">Property Size</p>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-slate-800 text-sm">
                        <span className="font-medium">{stats.totalRooms}</span> {stats.totalRooms === 1 ? 'Room' : 'Rooms'}
                      </span>
                      {stats.totalBedrooms > 0 && (
                        <span className="text-slate-800 text-sm flex items-center gap-1">
                          <BedDouble className="w-4 h-4 text-slate-400" />
                          <span className="font-medium">{stats.totalBedrooms}</span> {stats.totalBedrooms === 1 ? 'Bedroom' : 'Bedrooms'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Summary Cards */}
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
            {stats.totalBoxesWithRec > stats.totalBoxes ? (
              <p className="text-xs text-amber-600 mt-1">
                {stats.totalBoxesWithRec.toLocaleString()} with rec
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">total</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Ruler className="w-5 h-5 text-green-600" />
              </div>
              <p className="text-sm font-medium text-slate-600">Volume</p>
            </div>
            <p className="text-2xl font-bold text-slate-800">{stats.totalCuft.toLocaleString()}</p>
            {stats.totalCuftWithRec > stats.totalCuft ? (
              <p className="text-xs text-green-600">
                {stats.totalCuftWithRec.toLocaleString()} cuft with rec
              </p>
            ) : (
              <p className="text-xs text-slate-500">cuft</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Scale className="w-5 h-5 text-purple-600" />
              </div>
              <p className="text-sm font-medium text-slate-600">Weight</p>
            </div>
            <p className="text-2xl font-bold text-slate-800">{stats.totalWeight.toLocaleString()}</p>
            {stats.totalWeightWithRec > stats.totalWeight ? (
              <p className="text-xs text-purple-600">
                {stats.totalWeightWithRec.toLocaleString()} lbs with rec
              </p>
            ) : (
              <p className="text-xs text-slate-500">lbs</p>
            )}
          </div>
        </div>

        {/* Media Sections */}
        {mediaSections.map((section, sectionIndex) => (
          <div key={`${section.type}-${section.mediaId}-${sectionIndex}`} className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
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
                      src={`/api/crew-review/${token}/images/${section.mediaId}`}
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

              {/* Items by Room - Full Spreadsheet View */}
              {Object.keys(section.items).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(section.items).map(([room, items]) => {
                    const roomKey = `${sectionIndex}-${room}`;
                    const isExpanded = expandedRooms.has(roomKey);

                    return (
                      <div key={room} className="border border-slate-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleRoom(sectionIndex, room)}
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
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50/50">
                                  <th className="py-2 px-3 font-medium">Item</th>
                                  <th className="py-2 px-3 font-medium text-center w-16">Qty</th>
                                  <th className="py-2 px-3 font-medium text-center w-16">Cuft</th>
                                  <th className="py-2 px-3 font-medium text-center w-16">Weight</th>
                                  <th className="py-2 px-3 font-medium text-center w-20">Going</th>
                                  <th className="py-2 px-3 font-medium text-center w-16">PBO</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {items.map((item) => (
                                  <tr key={item._id} className="hover:bg-slate-50">
                                    <td className="py-2 px-3">
                                      <span className="font-medium text-slate-800">{item.name}</span>
                                      {renderItemTypeBadge(item.itemType)}
                                      {item.special_handling && (
                                        <p className="text-xs text-blue-600 mt-0.5">{item.special_handling}</p>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center text-slate-600">
                                      {item.quantity}
                                    </td>
                                    <td className="py-2 px-3 text-center text-slate-600">
                                      {item.cuft > 0 ? item.cuft : '-'}
                                    </td>
                                    <td className="py-2 px-3 text-center text-slate-600">
                                      {item.weight > 0 ? item.weight : '-'}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      {renderGoingBadge(item)}
                                    </td>
                                    <td className="py-2 px-3 text-center text-slate-600">
                                      {item.packed_by !== 'N/A' ? item.packed_by : '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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
        {boxRecommendationsByRoom && Object.keys(boxRecommendationsByRoom).length > 0 && (
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
                      <span>-</span>
                      <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
    </div>
  );
}
