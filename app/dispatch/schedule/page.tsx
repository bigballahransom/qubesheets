'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';
import IntercomChat from '@/components/IntercomChat';

import { ScheduleHeader } from '@/components/dispatch/ScheduleHeader';
import { ResourcesPanel } from '@/components/dispatch/ResourcesPanel';
import { ScheduleTimeline } from '@/components/dispatch/ScheduleTimeline';
import { JobsPanel } from '@/components/dispatch/JobsPanel';
import { JobCard } from '@/components/dispatch/JobCard';

import {
  mockTrucks,
  mockCrew,
  mockScheduledJobs,
  mockUnscheduledJobs,
  calculateBookingPercentage,
} from '@/components/dispatch/mock-data';
import { ScheduledJob, UnscheduledJob, Truck, CrewMember } from '@/components/dispatch/types';

type ActiveDragItem =
  | { type: 'job'; data: ScheduledJob }
  | { type: 'unscheduled-job'; data: UnscheduledJob }
  | { type: 'truck'; data: Truck }
  | { type: 'crew'; data: CrewMember }
  | null;

export default function DispatchSchedulePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduledJobs, setScheduledJobs] = useState(mockScheduledJobs);
  const [unscheduledJobs, setUnscheduledJobs] = useState(mockUnscheduledJobs);
  const [activeDragItem, setActiveDragItem] = useState<ActiveDragItem>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current;

    if (data?.type === 'job') {
      setActiveDragItem({ type: 'job', data: data.job });
    } else if (data?.type === 'unscheduled-job') {
      setActiveDragItem({ type: 'unscheduled-job', data: data.job });
    } else if (data?.type === 'truck') {
      setActiveDragItem({ type: 'truck', data: data.truck });
    } else if (data?.type === 'crew') {
      setActiveDragItem({ type: 'crew', data: data.member });
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // Handle unscheduled job dropped on timeline row
    if (activeData?.type === 'unscheduled-job' && overData?.type === 'timeline-row') {
      const job = activeData.job as UnscheduledJob;
      const truck = overData.truck as Truck | null;

      if (truck) {
        // Create a new scheduled job from the unscheduled one
        const startTime = new Date(selectedDate);
        startTime.setHours(8, 0, 0, 0); // Default to 8am
        const endTime = new Date(startTime);
        endTime.setHours(startTime.getHours() + job.estimatedHours);

        const newScheduledJob: ScheduledJob = {
          id: `scheduled-${job.id}`,
          jobNumber: job.jobNumber,
          customerName: job.customerName,
          moveSize: job.moveSize,
          squareFeet: job.squareFeet,
          origin: job.origin,
          destination: job.destination,
          scheduledDate: selectedDate,
          startTime,
          endTime,
          estimatedHours: job.estimatedHours,
          assignedTruck: truck.id,
          assignedCrew: [],
          status: 'scheduled',
          quoteNumber: job.quoteNumber,
          isMultiDay: false,
        };

        setScheduledJobs((prev) => [...prev, newScheduledJob]);
        setUnscheduledJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
    }

    // Handle scheduled job dropped back to unscheduled zone
    if (activeData?.type === 'job' && overData?.type === 'unscheduled-zone') {
      const scheduledJob = activeData.job as ScheduledJob;

      // Convert back to unscheduled job
      const unscheduledJob: UnscheduledJob = {
        id: scheduledJob.id.replace('scheduled-', ''),
        jobNumber: scheduledJob.jobNumber,
        customerName: scheduledJob.customerName,
        moveSize: scheduledJob.moveSize,
        squareFeet: scheduledJob.squareFeet,
        origin: scheduledJob.origin,
        destination: scheduledJob.destination,
        estimatedHours: scheduledJob.estimatedHours,
        quoteNumber: scheduledJob.quoteNumber,
        priority: 'medium', // Default priority
      };

      setUnscheduledJobs((prev) => [...prev, unscheduledJob]);
      setScheduledJobs((prev) => prev.filter((j) => j.id !== scheduledJob.id));
    }

    // Handle scheduled job moved to a different truck row
    if (activeData?.type === 'job' && overData?.type === 'timeline-row') {
      const scheduledJob = activeData.job as ScheduledJob;
      const targetTruck = overData.truck as Truck | null;

      if (targetTruck && scheduledJob.assignedTruck !== targetTruck.id) {
        setScheduledJobs((prev) =>
          prev.map((job) => {
            if (job.id === scheduledJob.id) {
              return { ...job, assignedTruck: targetTruck.id };
            }
            return job;
          })
        );
      }
    }

    // Handle crew dropped on job card
    if (activeData?.type === 'crew' && over.id.toString().startsWith('job-')) {
      const member = activeData.member as CrewMember;
      const jobId = over.id.toString().replace('job-', '');

      setScheduledJobs((prev) =>
        prev.map((job) => {
          if (job.id === jobId && !job.assignedCrew.includes(member.id)) {
            return { ...job, assignedCrew: [...job.assignedCrew, member.id] };
          }
          return job;
        })
      );
    }

    // Handle truck dropped on job card
    if (activeData?.type === 'truck' && over.id.toString().startsWith('job-')) {
      const truck = activeData.truck as Truck;
      const jobId = over.id.toString().replace('job-', '');

      setScheduledJobs((prev) =>
        prev.map((job) => {
          if (job.id === jobId) {
            return { ...job, assignedTruck: truck.id };
          }
          return job;
        })
      );
    }
  }, [selectedDate]);

  const bookingPercentage = calculateBookingPercentage(scheduledJobs);

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden" />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="min-h-screen bg-muted/30 lg:pl-64 pt-0 lg:pt-16 flex flex-col">
            {/* Header */}
            <ScheduleHeader
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
            />

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Resources Panel */}
              <ResourcesPanel trucks={mockTrucks} crew={mockCrew} />

              {/* Center: Timeline */}
              <ScheduleTimeline
                selectedDate={selectedDate}
                trucks={mockTrucks}
                crew={mockCrew}
                scheduledJobs={scheduledJobs}
              />

              {/* Right: Jobs Panel */}
              <JobsPanel
                unscheduledJobs={unscheduledJobs}
                cancelledCount={0}
                bookingPercentage={bookingPercentage}
              />
            </div>
          </div>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeDragItem?.type === 'job' && (
              <div className="opacity-90 rotate-2">
                <JobCard job={activeDragItem.data} variant="compact" />
              </div>
            )}
            {activeDragItem?.type === 'unscheduled-job' && (
              <div className="bg-background border rounded-lg p-3 shadow-xl rotate-2 w-64">
                <p className="font-semibold text-sm">{activeDragItem.data.jobNumber}</p>
                <p className="text-sm">{activeDragItem.data.customerName}</p>
                <p className="text-xs text-muted-foreground">{activeDragItem.data.moveSize}</p>
              </div>
            )}
            {activeDragItem?.type === 'truck' && (
              <div className="bg-background border rounded-lg p-3 shadow-xl rotate-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: activeDragItem.data.color }}
                  >
                    {activeDragItem.data.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{activeDragItem.data.name}</p>
                    <p className="text-xs text-muted-foreground">{activeDragItem.data.capacity} ft³</p>
                  </div>
                </div>
              </div>
            )}
            {activeDragItem?.type === 'crew' && (
              <div className="bg-background border rounded-lg p-3 shadow-xl rotate-2">
                <p className="font-medium text-sm">{activeDragItem.data.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{activeDragItem.data.role}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}
