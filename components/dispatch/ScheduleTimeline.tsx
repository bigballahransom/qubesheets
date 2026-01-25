'use client';

import { useRef, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { format, setHours, setMinutes } from 'date-fns';
import { Plus, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { JobCard } from './JobCard';
import { ScheduledJob, Truck, CrewMember } from './types';

interface ScheduleTimelineProps {
  selectedDate: Date;
  trucks: Truck[];
  crew: CrewMember[];
  scheduledJobs: ScheduledJob[];
  onAddSlot?: () => void;
}

// Generate time slots from 6am to 8pm in 15-minute intervals
function generateTimeSlots() {
  const slots = [];
  for (let hour = 6; hour <= 20; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      slots.push({
        hour,
        minute,
        label: minute === 0 ? format(setMinutes(setHours(new Date(), hour), minute), 'ha') : '',
        isHour: minute === 0,
      });
    }
  }
  return slots;
}

const timeSlots = generateTimeSlots();
const SLOT_WIDTH = 30; // pixels per 15-min slot
const ROW_LABEL_WIDTH = 180; // pixels for the truck label column

function TimelineRow({
  truck,
  jobs,
  crew,
  selectedDate,
}: {
  truck: Truck | null; // null for multi-day row
  jobs: ScheduledJob[];
  crew: CrewMember[];
  selectedDate: Date;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: truck ? `row-${truck.id}` : 'row-multiday',
    data: { type: 'timeline-row', truck },
  });

  // Calculate job position and width based on time
  const getJobStyle = (job: ScheduledJob) => {
    const startHour = job.startTime.getHours();
    const startMinute = job.startTime.getMinutes();
    const endHour = job.endTime.getHours();
    const endMinute = job.endTime.getMinutes();

    // Calculate slot index (6am = slot 0)
    const startSlot = (startHour - 6) * 4 + Math.floor(startMinute / 15);
    const endSlot = (endHour - 6) * 4 + Math.floor(endMinute / 15);
    const duration = endSlot - startSlot;

    return {
      left: `${startSlot * SLOT_WIDTH}px`,
      width: `${duration * SLOT_WIDTH}px`,
    };
  };

  const assignedCrew = (job: ScheduledJob) =>
    crew.filter((c) => job.assignedCrew.includes(c.id));

  const assignedTruck = (job: ScheduledJob) =>
    truck || undefined;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex border-b min-h-[100px] transition-colors',
        isOver && 'bg-primary/5'
      )}
    >
      {/* Row Label */}
      <div
        className="flex-shrink-0 border-r bg-muted/30 p-2 sticky left-0 z-10"
        style={{ width: ROW_LABEL_WIDTH }}
      >
        {truck ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: truck.color }}
              >
                {truck.name.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-sm leading-tight truncate max-w-[100px]">
                  {truck.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {truck.capacity} ft³
                </p>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Edit truck</DropdownMenuItem>
                <DropdownMenuItem>View all jobs</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="flex items-center h-full">
            <p className="font-medium text-sm text-muted-foreground">Multi-day jobs</p>
          </div>
        )}
      </div>

      {/* Timeline Grid */}
      <div className="flex-1 relative" style={{ minWidth: timeSlots.length * SLOT_WIDTH }}>
        {/* Grid lines */}
        <div className="absolute inset-0 flex">
          {timeSlots.map((slot, i) => (
            <div
              key={i}
              className={cn(
                'h-full flex-shrink-0',
                slot.isHour ? 'border-l border-border' : 'border-l border-border/30 border-dashed'
              )}
              style={{ width: SLOT_WIDTH }}
            />
          ))}
        </div>

        {/* Jobs */}
        <div className="absolute inset-0 p-1">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="absolute top-1 bottom-1"
              style={getJobStyle(job)}
            >
              <JobCard
                job={job}
                truck={assignedTruck(job)}
                crewMembers={assignedCrew(job)}
                variant="timeline"
              />
            </div>
          ))}
        </div>

        {/* Drop indicator */}
        {isOver && (
          <div className="absolute inset-0 border-2 border-dashed border-primary/50 rounded-md pointer-events-none" />
        )}
      </div>
    </div>
  );
}

function TimelineHeader() {
  // Find current time indicator position
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentSlot = (currentHour - 6) * 4 + Math.floor(currentMinute / 15);
  const currentTimePosition = currentSlot * SLOT_WIDTH + ((currentMinute % 15) / 15) * SLOT_WIDTH;
  const isInView = currentHour >= 6 && currentHour <= 20;

  return (
    <div className="flex border-b bg-muted/50 sticky top-0 z-20">
      {/* Empty corner for row labels */}
      <div
        className="flex-shrink-0 border-r bg-muted/50 p-2 sticky left-0 z-30"
        style={{ width: ROW_LABEL_WIDTH }}
      >
        <span className="text-xs text-muted-foreground">Templates</span>
      </div>

      {/* Time headers */}
      <div className="flex-1 relative" style={{ minWidth: timeSlots.length * SLOT_WIDTH }}>
        <div className="flex h-10">
          {timeSlots.map((slot, i) => (
            <div
              key={i}
              className={cn(
                'flex-shrink-0 flex items-center justify-start px-1',
                slot.isHour && 'border-l border-border'
              )}
              style={{ width: SLOT_WIDTH }}
            >
              {slot.isHour && (
                <span className="text-xs font-medium text-muted-foreground">
                  {slot.label}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Current time indicator */}
        {isInView && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
            style={{ left: `${currentTimePosition}px` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
}

export function ScheduleTimeline({
  selectedDate,
  trucks,
  crew,
  scheduledJobs,
  onAddSlot,
}: ScheduleTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      if (currentHour >= 6 && currentHour <= 20) {
        const scrollPosition = (currentHour - 6) * 4 * SLOT_WIDTH - 100; // Offset for visibility
        scrollRef.current.scrollLeft = Math.max(0, scrollPosition);
      }
    }
  }, []);

  // Get multi-day jobs
  const multiDayJobs = scheduledJobs.filter((job) => job.isMultiDay);

  // Get jobs for each truck
  const getJobsForTruck = (truckId: string) =>
    scheduledJobs.filter((job) => job.assignedTruck === truckId && !job.isMultiDay);

  return (
    <div className="flex-1 flex flex-col bg-card overflow-hidden">
      {/* Scrollable container */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* Header */}
        <TimelineHeader />

        {/* Multi-day row */}
        {multiDayJobs.length > 0 && (
          <TimelineRow
            truck={null}
            jobs={multiDayJobs}
            crew={crew}
            selectedDate={selectedDate}
          />
        )}

        {/* Truck rows */}
        {trucks.map((truck) => (
          <TimelineRow
            key={truck.id}
            truck={truck}
            jobs={getJobsForTruck(truck.id)}
            crew={crew}
            selectedDate={selectedDate}
          />
        ))}

        {/* Add slot row */}
        <div className="flex border-b min-h-[60px]">
          <div
            className="flex-shrink-0 border-r bg-muted/30 p-2 sticky left-0 z-10"
            style={{ width: ROW_LABEL_WIDTH }}
          >
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={onAddSlot}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Slot
            </Button>
          </div>
          <div className="flex-1 bg-muted/10" style={{ minWidth: timeSlots.length * SLOT_WIDTH }} />
        </div>
      </div>
    </div>
  );
}
