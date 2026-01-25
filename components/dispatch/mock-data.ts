// Mock data for dispatch schedule development

import { Truck, CrewMember, ScheduledJob, UnscheduledJob } from './types';

export const mockTrucks: Truck[] = [
  {
    id: 'truck-1',
    name: 'Boot Truck',
    capacity: 1975,
    crewSize: 3,
    features: ['Attic', 'Ramp'],
    hoursToday: 6.5,
    status: 'on_job',
    color: '#3b82f6', // blue
  },
  {
    id: 'truck-2',
    name: "MV-J (John's Truck)",
    capacity: 1790,
    crewSize: 3,
    features: ['Lift gate', 'Ramp'],
    hoursToday: 0,
    status: 'available',
    color: '#8b5cf6', // purple
  },
  {
    id: 'truck-3',
    name: "MV-S (Shawn's Truck)",
    capacity: 1790,
    crewSize: 3,
    features: ['Lift gate', 'Ramp'],
    hoursToday: 4.25,
    status: 'on_job',
    color: '#10b981', // green
  },
  {
    id: 'truck-4',
    name: 'Spaceship (Freightliner)',
    capacity: 1975,
    crewSize: 4,
    features: ['Attic', 'Ramp'],
    hoursToday: 8.25,
    status: 'on_job',
    color: '#f59e0b', // amber
  },
  {
    id: 'truck-5',
    name: 'ULT 1728',
    capacity: 1728,
    crewSize: 3,
    features: ['Lift gate', 'Ramp'],
    hoursToday: 0,
    status: 'available',
    color: '#ef4444', // red
  },
];

export const mockCrew: CrewMember[] = [
  {
    id: 'crew-1',
    name: 'John Smith',
    role: 'driver',
    hoursToday: 8,
    status: 'on_job',
  },
  {
    id: 'crew-2',
    name: 'Fernando B',
    role: 'mover',
    hoursToday: 4.5,
    status: 'on_job',
  },
  {
    id: 'crew-3',
    name: 'Elijah G',
    role: 'mover',
    hoursToday: 6,
    status: 'on_job',
  },
  {
    id: 'crew-4',
    name: 'Joshua C',
    role: 'lead',
    hoursToday: 7.5,
    status: 'on_job',
  },
  {
    id: 'crew-5',
    name: 'Shawn T',
    role: 'driver',
    hoursToday: 4,
    status: 'on_job',
  },
  {
    id: 'crew-6',
    name: 'Eddie R',
    role: 'mover',
    hoursToday: 0,
    status: 'available',
  },
  {
    id: 'crew-7',
    name: 'Johnathan W',
    role: 'mover',
    hoursToday: 0,
    status: 'available',
  },
  {
    id: 'crew-8',
    name: 'Marcus D',
    role: 'lead',
    hoursToday: 0,
    status: 'off',
  },
];

const today = new Date();
today.setHours(0, 0, 0, 0);

export const mockScheduledJobs: ScheduledJob[] = [
  {
    id: 'job-1',
    jobNumber: '7728-1',
    customerName: 'Jim Sturdevanr',
    moveSize: '3 Bedroom House',
    squareFeet: 2200,
    origin: {
      street: '123 Main St',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
    },
    destination: {
      street: '456 Oak Ave',
      city: 'Hillsboro',
      state: 'OR',
      zip: '97124',
    },
    scheduledDate: today,
    startTime: new Date(today.getTime() + 7 * 60 * 60 * 1000 + 45 * 60 * 1000), // 7:45am
    endTime: new Date(today.getTime() + 16 * 60 * 60 * 1000), // 4pm
    estimatedHours: 8,
    assignedTruck: 'truck-3',
    assignedCrew: ['crew-1', 'crew-3', 'crew-4', 'crew-5'],
    status: 'in_progress',
    quoteNumber: '97024',
    isMultiDay: true,
    dateRange: {
      start: today,
      end: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days later
    },
  },
  {
    id: 'job-2',
    jobNumber: '7702-1',
    customerName: 'Zachary Kovitch',
    moveSize: '2 Bedroom Apartment',
    squareFeet: 1200,
    origin: {
      street: '789 Pine Rd',
      city: 'Portland',
      state: 'OR',
      zip: '97205',
    },
    destination: {
      street: '321 Elm St',
      city: 'Hillsboro',
      state: 'OR',
      zip: '97123',
    },
    scheduledDate: today,
    startTime: new Date(today.getTime() + 7 * 60 * 60 * 1000 + 30 * 60 * 1000), // 7:30am
    endTime: new Date(today.getTime() + 12 * 60 * 60 * 1000), // 12pm
    estimatedHours: 4.5,
    assignedTruck: 'truck-1',
    assignedCrew: ['crew-2', 'crew-6', 'crew-7'],
    status: 'scheduled',
    quoteNumber: '97123',
    isMultiDay: false,
  },
  {
    id: 'job-3',
    jobNumber: '7715-1',
    customerName: 'Sarah Connor',
    moveSize: '1 Bedroom',
    squareFeet: 600,
    origin: {
      street: '555 Tech Blvd',
      city: 'Portland',
      state: 'OR',
      zip: '97209',
    },
    destination: {
      street: '888 Future Way',
      city: 'Portland',
      state: 'OR',
      zip: '97210',
    },
    scheduledDate: today,
    startTime: new Date(today.getTime() + 10 * 60 * 60 * 1000), // 10am
    endTime: new Date(today.getTime() + 13 * 60 * 60 * 1000), // 1pm
    estimatedHours: 3,
    assignedTruck: 'truck-2',
    assignedCrew: ['crew-2'],
    status: 'scheduled',
    isMultiDay: false,
  },
];

export const mockUnscheduledJobs: UnscheduledJob[] = [
  {
    id: 'unsched-1',
    jobNumber: '7731-2',
    customerName: 'Mike Johnson',
    moveSize: '2 Bedroom Apartment',
    squareFeet: 800,
    origin: {
      street: '111 River Rd',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
    },
    destination: {
      street: '222 Creek Dr',
      city: 'Beaverton',
      state: 'OR',
      zip: '97005',
    },
    estimatedHours: 4,
    priority: 'medium',
  },
  {
    id: 'unsched-2',
    jobNumber: '7732-1',
    customerName: 'Lisa Park',
    moveSize: '3 Bedroom House',
    squareFeet: 1800,
    origin: {
      street: '333 Lake Ave',
      city: 'Lake Oswego',
      state: 'OR',
      zip: '97034',
    },
    destination: {
      street: '444 Hill St',
      city: 'West Linn',
      state: 'OR',
      zip: '97068',
    },
    preferredDate: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
    estimatedHours: 6,
    priority: 'high',
  },
  {
    id: 'unsched-3',
    jobNumber: '7733-1',
    customerName: 'Tom Wilson',
    moveSize: 'Studio',
    squareFeet: 400,
    origin: {
      street: '555 Downtown Blvd',
      city: 'Portland',
      state: 'OR',
      zip: '97204',
    },
    destination: {
      street: '666 Pearl District',
      city: 'Portland',
      state: 'OR',
      zip: '97209',
    },
    estimatedHours: 2,
    priority: 'low',
  },
];

// Helper to calculate booking percentage
export function calculateBookingPercentage(jobs: ScheduledJob[]): number {
  const totalAvailableHours = mockTrucks.length * 10; // 10 hours per truck
  const bookedHours = jobs.reduce((sum, job) => sum + job.estimatedHours, 0);
  return Math.round((bookedHours / totalAvailableHours) * 100);
}
