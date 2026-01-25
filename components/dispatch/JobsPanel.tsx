'use client';

import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import {
  Filter,
  Home,
  MapPin,
  Calendar,
  Clock,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { UnscheduledJob } from './types';

interface JobsPanelProps {
  unscheduledJobs: UnscheduledJob[];
  cancelledCount: number;
  bookingPercentage: number;
}

function DraggableUnscheduledJob({ job }: { job: UnscheduledJob }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `unscheduled-${job.id}`,
    data: { type: 'unscheduled-job', job },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const priorityColors = {
    low: 'bg-gray-400',
    medium: 'bg-blue-500',
    high: 'bg-red-500',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'bg-background border rounded-lg p-3 cursor-grab active:cursor-grabbing',
        'hover:border-primary/50 hover:shadow-md transition-all group',
        isDragging && 'opacity-50 shadow-xl ring-2 ring-primary/30 rotate-1'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', priorityColors[job.priority])} />
          <span className="font-semibold text-sm">{job.jobNumber}</span>
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Customer Name */}
      <p className="font-medium text-sm mb-2">{job.customerName}</p>

      {/* Move Details */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Home className="h-3 w-3" />
          <span>{job.moveSize}</span>
          <span>•</span>
          <span>{job.squareFeet} SQFT</span>
        </div>

        <div className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          <span>{job.origin.city} → {job.destination.city}</span>
        </div>

        {job.preferredDate && (
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>Preferred: {format(job.preferredDate, 'MMM d')}</span>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>Est. {job.estimatedHours} hours</span>
        </div>
      </div>
    </div>
  );
}

export function JobsPanel({
  unscheduledJobs,
  cancelledCount,
  bookingPercentage,
}: JobsPanelProps) {
  const [activeTab, setActiveTab] = useState<'unscheduled' | 'cancelled'>('unscheduled');

  const { isOver, setNodeRef } = useDroppable({
    id: 'unscheduled-drop-zone',
    data: { type: 'unscheduled-zone' },
  });

  return (
    <div className="w-72 bg-card border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Jobs</h2>
          <Button variant="ghost" size="sm" className="h-7">
            <Filter className="h-3 w-3 mr-1" />
            Filters
          </Button>
        </div>

        {/* Booking Progress */}
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{bookingPercentage}% Booked Today</span>
          </div>
          <Progress value={bookingPercentage} className="h-2" />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 py-2 border-b">
        <div className="flex bg-muted rounded-lg p-1">
          <button
            onClick={() => setActiveTab('unscheduled')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'unscheduled'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Unscheduled ({unscheduledJobs.length})
          </button>
          <button
            onClick={() => setActiveTab('cancelled')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'cancelled'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Cancelled ({cancelledCount})
          </button>
        </div>
      </div>

      {/* Job List */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 overflow-y-auto p-3 space-y-2 transition-colors',
          isOver && 'bg-primary/5 ring-2 ring-primary/30 ring-inset'
        )}
      >
        {activeTab === 'unscheduled' ? (
          <>
            {isOver && (
              <div className="border-2 border-dashed border-primary/50 rounded-lg p-4 mb-2 text-center">
                <p className="text-sm font-medium text-primary">Drop to unschedule</p>
              </div>
            )}
            {unscheduledJobs.length === 0 && !isOver ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No unscheduled jobs</p>
              </div>
            ) : (
              <>
                {!isOver && (
                  <p className="text-xs text-muted-foreground text-center mb-2">
                    Drag jobs to the schedule
                  </p>
                )}
                {unscheduledJobs.map((job) => (
                  <DraggableUnscheduledJob key={job.id} job={job} />
                ))}
              </>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No cancelled jobs</p>
          </div>
        )}
      </div>
    </div>
  );
}
