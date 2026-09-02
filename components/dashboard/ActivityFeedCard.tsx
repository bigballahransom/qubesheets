'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity as ActivityIcon,
  Archive,
  Calendar,
  CalendarClock,
  CalendarX,
  Camera,
  Eye,
  FileCheck,
  Film,
  FolderPlus,
  Loader2,
  MessageSquare,
  Package,
  PenTool,
  PhoneCall,
  Send,
  Users,
} from 'lucide-react';
import { useDashboard } from './DashboardContext';
import RepFilter from './RepFilter';

interface FeedActivity {
  _id: string;
  activityType: string;
  action: string;
  details: Record<string, any>;
  createdAt: string;
  projectId: string;
  projectName: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    imageUrl: string | null;
  };
}

const PAGE_SIZE = 20;

export default function ActivityFeedCard() {
  const { me, isPersonalAccount, bootstrapLoading } = useDashboard();

  // null = not initialized yet; defaults to "my projects" once we know who I am
  const [rep, setRep] = useState<string | null>(null);
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (bootstrapLoading || rep !== null) return;
    setRep(isPersonalAccount ? 'all' : me?.userId || 'all');
  }, [bootstrapLoading, isPersonalAccount, me, rep]);

  useEffect(() => {
    if (rep === null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ rep, page: '1', limit: String(PAGE_SIZE) });
        const response = await fetch(`/api/dashboard/activity-feed?${params}`);
        if (response.ok && !cancelled) {
          const data = await response.json();
          setActivities(data.activities || []);
          setHasMore(!!data.hasMore);
          setPage(1);
        }
      } catch (error) {
        console.error('Failed to fetch activity feed:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rep]);

  const loadMore = async () => {
    if (rep === null) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const params = new URLSearchParams({ rep, page: String(nextPage), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/dashboard/activity-feed?${params}`);
      if (response.ok) {
        const data = await response.json();
        setActivities((prev) => [...prev, ...(data.activities || [])]);
        setHasMore(!!data.hasMore);
        setPage(nextPage);
      }
    } catch (error) {
      console.error('Failed to fetch more activity:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ActivityIcon className="h-5 w-5 text-blue-500" />
          Recent Activity
        </h2>
        <RepFilter value={rep ?? 'all'} onChange={setRep} allLabel="All reps" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 py-2 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex-shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-8 text-gray-500 bg-slate-50 rounded-lg">
          <ActivityIcon className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p>{rep !== 'all' ? 'No recent activity on your projects' : 'No recent activity yet'}</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {activities.map((activity) => (
              <div key={activity._id} className="flex gap-3 py-3">
                <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
                  {getActivityIcon(activity)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700">{getActivityDescription(activity)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    <Link
                      href={`/projects/${activity.projectId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {activity.projectName}
                    </Link>
                    {' · '}
                    {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}

function getActivityIcon(activity: FeedActivity) {
  switch (activity.activityType) {
    case 'upload':
      return activity.details?.fileType === 'video'
        ? <Film className="w-4 h-4 text-purple-600" />
        : <Camera className="w-4 h-4 text-blue-600" />;
    case 'inventory_update':
      return <Package className="w-4 h-4 text-green-600" />;
    case 'video_call':
      return <PhoneCall className="w-4 h-4 text-orange-600" />;
    case 'upload_link_sent':
      return <Send className="w-4 h-4 text-indigo-600" />;
    case 'upload_link_visited':
      return <Eye className="w-4 h-4 text-teal-600" />;
    case 'note_activity':
      return <MessageSquare className="w-4 h-4 text-amber-600" />;
    case 'review_link_shared':
      return <FileCheck className="w-4 h-4 text-emerald-600" />;
    case 'review_link_signed':
      return <PenTool className="w-4 h-4 text-emerald-600" />;
    case 'crew_link_shared':
      return <Users className="w-4 h-4 text-cyan-600" />;
    case 'project_created':
      return <FolderPlus className="w-4 h-4 text-blue-600" />;
    case 'video_call_scheduled':
      if (activity.action === 'cancelled') return <CalendarX className="w-4 h-4 text-red-600" />;
      if (activity.action === 'rescheduled') return <CalendarClock className="w-4 h-4 text-amber-600" />;
      return <Calendar className="w-4 h-4 text-blue-600" />;
    default:
      return <Archive className="w-4 h-4 text-gray-600" />;
  }
}

function getActivityDescription(activity: FeedActivity) {
  const d = activity.details || {};
  const userName =
    `${activity.user.firstName || ''} ${activity.user.lastName || ''}`.trim() ||
    activity.user.email ||
    'User';

  switch (activity.activityType) {
    case 'upload': {
      const uploadedBy = d.uploadSource === 'customer' ? d.userName || 'Customer' : userName;
      const what = d.fileCount && d.fileCount > 1 ? `${d.fileCount} files` : d.fileType || 'a file';
      return (
        <span>
          <strong>{uploadedBy}</strong> uploaded {what}
          {d.uploadSource === 'customer' && ' via upload link'}
        </span>
      );
    }
    case 'inventory_update':
      if (d.itemsCount) {
        return (
          <span>
            <strong>{userName}</strong> updated inventory
            <span className="font-medium"> ({d.itemsCount} items)</span>
          </span>
        );
      }
      return (
        <span>
          <strong>{userName}</strong> {activity.action} item
          {d.itemName && <span className="font-medium"> {d.itemName}</span>}
        </span>
      );
    case 'video_call':
      return <span><strong>{userName}</strong> completed a video call session</span>;
    case 'upload_link_sent':
      return (
        <span>
          <strong>{userName}</strong> sent upload link to
          <span className="font-medium"> {d.customerName}</span>
        </span>
      );
    case 'upload_link_visited':
      return <span>Customer <strong>{d.customerName || ''}</strong> opened the upload link</span>;
    case 'note_activity':
      return (
        <span>
          <strong>{userName}</strong> {activity.action}
          {d.noteTitle && <span className="font-medium"> {d.noteTitle}</span>}
        </span>
      );
    case 'review_link_shared':
      return (
        <span>
          <strong>{userName}</strong> shared inventory review link
          {d.customerName && <span> with <span className="font-medium">{d.customerName}</span></span>}
        </span>
      );
    case 'review_link_signed':
      return <span>Customer <strong>{d.customerName || 'Customer'}</strong> signed the inventory review</span>;
    case 'crew_link_shared':
      return <span><strong>{userName}</strong> generated crew review link</span>;
    case 'project_created':
      return <span><strong>{userName}</strong> created the project</span>;
    case 'video_call_scheduled': {
      const when = d.scheduledFor
        ? new Date(d.scheduledFor).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: d.timezone || undefined,
          })
        : null;
      const verb = activity.action === 'rescheduled' ? 'rescheduled' : activity.action === 'cancelled' ? 'cancelled' : 'scheduled';
      return (
        <span>
          <strong>{userName}</strong> {verb} video call
          {d.customerName && <span> with <span className="font-medium">{d.customerName}</span></span>}
          {when && verb !== 'cancelled' && <span className="text-gray-500"> for {when}</span>}
        </span>
      );
    }
    default:
      return <span>{activity.action}</span>;
  }
}
