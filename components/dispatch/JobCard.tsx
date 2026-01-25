'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import {
  Home,
  MapPin,
  Truck,
  Users,
  Clock,
  X,
  MoreHorizontal,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ScheduledJob, Truck as TruckType, CrewMember } from './types';

interface JobCardProps {
  job: ScheduledJob;
  truck?: TruckType;
  crewMembers?: CrewMember[];
  variant?: 'timeline' | 'compact';
  onRemove?: () => void;
}

export function JobCard({
  job,
  truck,
  crewMembers = [],
  variant = 'timeline',
  onRemove,
}: JobCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `job-${job.id}`,
    data: { type: 'job', job },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const statusStyles = {
    scheduled: {
      bg: 'bg-blue-50 dark:bg-blue-950/50',
      border: 'border-l-blue-500',
      icon: 'text-blue-500',
    },
    in_progress: {
      bg: 'bg-amber-50 dark:bg-amber-950/50',
      border: 'border-l-amber-500',
      icon: 'text-amber-500',
    },
    completed: {
      bg: 'bg-green-50 dark:bg-green-950/50',
      border: 'border-l-green-500',
      icon: 'text-green-500',
    },
    cancelled: {
      bg: 'bg-gray-50 dark:bg-gray-900/50',
      border: 'border-l-gray-400',
      icon: 'text-gray-400',
    },
  };

  const statusConfig = statusStyles[job.status];

  const StatusIcon = () => {
    switch (job.status) {
      case 'scheduled':
        return <div className="w-3 h-3 rounded-full border-2 border-current" />;
      case 'in_progress':
        return (
          <div className="w-3 h-3 rounded-full border-2 border-current relative">
            <div className="absolute inset-0 bg-current rounded-full" style={{ clipPath: 'inset(0 50% 0 0)' }} />
          </div>
        );
      case 'completed':
        return <div className="w-3 h-3 rounded-full bg-current" />;
      case 'cancelled':
        return <X className="w-3 h-3" />;
    }
  };

  if (variant === 'compact') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        className={cn(
          'rounded-lg border border-l-4 p-3 cursor-grab active:cursor-grabbing',
          'hover:shadow-md transition-all',
          statusConfig.bg,
          statusConfig.border,
          isDragging && 'opacity-50 shadow-lg ring-2 ring-primary/20 rotate-1'
        )}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={cn('flex-shrink-0', statusConfig.icon)}>
              <StatusIcon />
            </span>
            <span className="font-medium text-sm">{job.jobNumber}</span>
          </div>
          {job.quoteNumber && (
            <span className="text-xs text-muted-foreground">{job.quoteNumber}</span>
          )}
        </div>

        <p className="font-medium text-sm mb-1">{job.customerName}</p>

        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          <Home className="h-3 w-3" />
          <span>{job.moveSize}</span>
          <span>•</span>
          <span>{job.squareFeet} SQFT</span>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          <MapPin className="h-3 w-3" />
          <span>{job.origin.city}</span>
          <span>→</span>
          <span>{job.destination.city}</span>
        </div>

        {job.isMultiDay && job.dateRange && (
          <Badge variant="secondary" className="text-xs">
            <Calendar className="h-3 w-3 mr-1" />
            {format(job.dateRange.start, 'MMM d')} - {format(job.dateRange.end, 'MMM d')}
          </Badge>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {format(job.startTime, 'h:mma')}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {job.assignedCrew.length}
          </span>
        </div>
      </div>
    );
  }

  // Timeline variant (full card)
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'rounded-lg border border-l-4 p-3 cursor-grab active:cursor-grabbing',
        'hover:shadow-md hover:ring-2 hover:ring-primary/20 transition-all',
        statusConfig.bg,
        statusConfig.border,
        isDragging && 'opacity-50 shadow-xl ring-2 ring-primary/30 rotate-1'
      )}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex-shrink-0', statusConfig.icon)}>
            <StatusIcon />
          </span>
          <span className="font-semibold text-sm">{job.jobNumber}</span>
          <span className="text-muted-foreground">•</span>
          <span className="font-medium text-sm">{job.customerName}</span>
        </div>

        <div className="flex items-center gap-2">
          {job.isMultiDay && job.dateRange && (
            <Badge variant="outline" className="text-xs">
              Drop: {format(job.dateRange.end, 'M/d')}
            </Badge>
          )}
          {job.quoteNumber && (
            <span className="text-xs text-muted-foreground">{job.quoteNumber}</span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Edit job</DropdownMenuItem>
              <DropdownMenuItem>View details</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onRemove}>
                Remove from schedule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Details Row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
        <span className="flex items-center gap-1">
          <Home className="h-3 w-3" />
          {job.moveSize} ({job.squareFeet} SQFT)
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {job.origin.city}, {job.origin.state} → {job.destination.city}, {job.destination.state}
        </span>
      </div>

      {/* Resources Row */}
      <div className="flex items-center gap-4 text-xs">
        {truck && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Truck className="h-3 w-3" />
            {truck.name}
          </span>
        )}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3 w-3" />
          {job.assignedCrew.length}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {format(job.startTime, 'h:mma')}
        </span>
      </div>

      {/* Crew Tags */}
      {crewMembers.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/50">
          {crewMembers.map((member) => (
            <Badge key={member.id} variant="secondary" className="text-xs px-2 py-0">
              {member.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
