// Dispatch Schedule Types

export interface Truck {
  id: string;
  name: string;
  capacity: number; // cubic feet
  crewSize: number;
  features: string[]; // e.g., ['Attic', 'Ramp', 'Lift gate']
  hoursToday: number;
  status: 'available' | 'on_job' | 'unavailable';
  color: string; // hex color for identification
}

export interface CrewMember {
  id: string;
  name: string;
  role: 'driver' | 'mover' | 'lead';
  hoursToday: number;
  status: 'available' | 'on_job' | 'off';
  avatar?: string;
}

export interface JobAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface ScheduledJob {
  id: string;
  jobNumber: string;
  customerName: string;
  moveSize: string; // e.g., "3 Bedroom House"
  squareFeet: number;
  origin: JobAddress;
  destination: JobAddress;
  scheduledDate: Date;
  startTime: Date; // time portion
  endTime: Date; // time portion
  estimatedHours: number;
  assignedTruck?: string; // truck id
  assignedCrew: string[]; // crew member ids
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  quoteNumber?: string;
  isMultiDay: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface UnscheduledJob {
  id: string;
  jobNumber: string;
  customerName: string;
  moveSize: string;
  squareFeet: number;
  origin: JobAddress;
  destination: JobAddress;
  preferredDate?: Date;
  estimatedHours: number;
  priority: 'low' | 'medium' | 'high';
  quoteNumber?: string;
}

export interface TimeSlot {
  hour: number;
  minute: number; // 0, 15, 30, 45
  label: string;
}

export interface DragItem {
  type: 'job' | 'truck' | 'crew';
  id: string;
  data: ScheduledJob | UnscheduledJob | Truck | CrewMember;
}

export interface DropResult {
  truckId?: string;
  timeSlot?: TimeSlot;
  jobId?: string;
}
