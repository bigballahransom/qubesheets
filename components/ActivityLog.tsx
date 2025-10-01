'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  Camera,
  Film,
  PhoneCall,
  Send,
  Archive,
  Eye
} from 'lucide-react';
import { Button } from './ui/button';

interface ActivityLogProps {
  projectId: string;
  onClose?: () => void;
  embedded?: boolean; // Whether this is embedded in a Dialog or standalone
}

interface Activity {
  _id: string;
  activityType: 'upload' | 'inventory_update' | 'video_call' | 'upload_link_sent' | 'upload_link_visited';
  action: string;
  details: {
    fileName?: string;
    fileType?: 'image' | 'video';
    uploadSource?: string;
    itemName?: string;
    itemsCount?: number;
    customerName?: string;
    customerPhone?: string;
    roomId?: string;
    videosRecorded?: number;
    userName?: string;
  };
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    imageUrl: string | null;
  };
}

export default function ActivityLog({ projectId, onClose, embedded = false }: ActivityLogProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filterType] = useState<string>('all');
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchActivities();
  }, [projectId, page, filterType]);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50'
      });
      
      if (filterType !== 'all') {
        params.append('activityType', filterType);
      }

      const response = await fetch(`/api/projects/${projectId}/activity-log?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setActivities(data.activities);
        setHasMore(data.pagination.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (activity: Activity) => {
    switch (activity.activityType) {
      case 'upload':
        return activity.details.fileType === 'video' ? 
          <Film className="w-4 h-4 text-purple-600" /> : 
          <Camera className="w-4 h-4 text-blue-600" />;
      case 'inventory_update':
        return <Package className="w-4 h-4 text-green-600" />;
      case 'video_call':
        return <PhoneCall className="w-4 h-4 text-orange-600" />;
      case 'upload_link_sent':
        return <Send className="w-4 h-4 text-indigo-600" />;
      case 'upload_link_visited':
        return <Eye className="w-4 h-4 text-teal-600" />;
      default:
        return <Archive className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActivityDescription = (activity: Activity) => {
    const userName = `${activity.user.firstName || ''} ${activity.user.lastName || ''}`.trim() || activity.user.email || 'User';
    
    switch (activity.activityType) {
      case 'upload':
        const uploadedBy = activity.details.uploadSource === 'customer' ? 
          activity.details.userName || 'Customer' : userName;
        return (
          <span>
            <strong>{uploadedBy}</strong> uploaded {activity.details.fileType} 
            <span className="font-medium"> {activity.details.fileName}</span>
            {activity.details.uploadSource === 'customer' && ' via customer upload link'}
          </span>
        );
        
      case 'inventory_update':
        if (activity.action === 'bulk_added') {
          return (
            <span>
              <strong>{userName}</strong> added 
              <span className="font-medium"> {activity.details.itemsCount} items</span> to inventory
            </span>
          );
        }
        return (
          <span>
            <strong>{userName}</strong> {activity.action} item
            <span className="font-medium"> {activity.details.itemName}</span>
          </span>
        );
        
      case 'video_call':
        return (
          <span>
            <strong>{userName}</strong> completed video call session
            {activity.details.videosRecorded && 
              <span className="font-medium"> ({activity.details.videosRecorded} videos recorded)</span>
            }
          </span>
        );
        
      case 'upload_link_sent':
        return (
          <span>
            <strong>{userName}</strong> sent upload link to 
            <span className="font-medium"> {activity.details.customerName}</span>
            <span className="text-gray-500"> ({activity.details.customerPhone})</span>
          </span>
        );
        
      case 'upload_link_visited':
        return (
          <span>
            Customer <strong>{activity.details.customerName}</strong> opened the upload link
          </span>
        );
        
      default:
        return <span>{activity.action}</span>;
    }
  };

  const toggleExpanded = (activityId: string) => {
    const newExpanded = new Set(expandedActivities);
    if (newExpanded.has(activityId)) {
      newExpanded.delete(activityId);
    } else {
      newExpanded.add(activityId);
    }
    setExpandedActivities(newExpanded);
  };

  const wrapperClass = embedded 
    ? "h-full flex flex-col min-h-0" 
    : "bg-white rounded-lg shadow-sm border h-full flex flex-col";

  const headerClass = embedded 
    ? "pb-4 flex items-center justify-between" 
    : "p-4 border-b flex items-center justify-between";

  return (
    <div className={wrapperClass}>
      {/* Header - only show if not embedded */}
      {!embedded && (
        <div className={headerClass}>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold">Activity Log</h3>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      )}


      {/* Activity List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && activities.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No activities found</p>
          </div>
        ) : (
          <div className="divide-y">
            {activities.map((activity) => {
              const isExpanded = expandedActivities.has(activity._id);
              return (
                <div
                  key={activity._id}
                  className="p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {getActivityIcon(activity)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Main description */}
                      <div className="text-sm text-gray-900">
                        {getActivityDescription(activity)}
                      </div>
                      
                      {/* Timestamp */}
                      <div className="text-xs text-gray-500 mt-1">
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </div>
                      
                      {/* Expandable details */}
                      {(activity.activityType === 'inventory_update' && activity.details.itemsCount && activity.details.itemsCount > 1) && (
                        <button
                          onClick={() => toggleExpanded(activity._id)}
                          className="text-xs text-blue-600 hover:text-blue-700 mt-1 flex items-center gap-1"
                        >
                          {isExpanded ? (
                            <><ChevronUp className="w-3 h-3" /> Hide details</>
                          ) : (
                            <><ChevronDown className="w-3 h-3" /> Show details</>
                          )}
                        </button>
                      )}
                      
                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
                          <pre>{JSON.stringify(activity.details, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                    
                    {/* User avatar */}
                    <div className="flex-shrink-0">
                      {activity.user.imageUrl ? (
                        <img
                          src={activity.user.imageUrl}
                          alt={activity.user.firstName || activity.user.email || 'User'}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                          {(activity.user.firstName?.[0] || activity.user.email?.[0] || 'U').toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="p-4 border-t">
          <Button
            onClick={() => setPage(page + 1)}
            variant="outline"
            className="w-full"
            disabled={loading}
          >
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}