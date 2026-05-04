'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar as CalendarIcon,
  Clock,
  Users,
  Truck,
  FileText,
  Phone,
  CheckCircle2,
  ArrowRight,
  MoreHorizontal,
  Video,
  Mail,
  ExternalLink,
  Copy,
  ChevronLeft,
  ChevronRight,
  User,
  Filter,
  XCircle,
} from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from 'recharts';
import { toast } from 'sonner';

interface Agent {
  id: string;
  name: string;
  email: string;
}

interface ScheduledCall {
  _id: string;
  projectId: string;
  userId: string;
  scheduledFor: string;
  timezone: string;
  status: 'scheduled' | 'started' | 'completed' | 'cancelled';
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  roomId: string;
  agentJoinLink: string;
  customerJoinLink: string;
  agent: Agent;
}

// Mock data for charts
const revenueData = [
  { month: 'Jan', revenue: 32000, jobs: 18 },
  { month: 'Feb', revenue: 28000, jobs: 15 },
  { month: 'Mar', revenue: 35000, jobs: 22 },
  { month: 'Apr', revenue: 42000, jobs: 28 },
  { month: 'May', revenue: 38000, jobs: 24 },
  { month: 'Jun', revenue: 47250, jobs: 28 },
];

const weeklyJobsData = [
  { day: 'Mon', completed: 4, scheduled: 2 },
  { day: 'Tue', completed: 6, scheduled: 3 },
  { day: 'Wed', completed: 5, scheduled: 4 },
  { day: 'Thu', completed: 7, scheduled: 2 },
  { day: 'Fri', completed: 8, scheduled: 1 },
  { day: 'Sat', completed: 3, scheduled: 2 },
  { day: 'Sun', completed: 0, scheduled: 1 },
];

const leadSourcesData = [
  { name: 'Google Ads', value: 24, fill: '#3b82f6' },
  { name: 'Referrals', value: 18, fill: '#8b5cf6' },
  { name: 'Website', value: 15, fill: '#10b981' },
  { name: 'Yelp', value: 8, fill: '#f59e0b' },
  { name: 'Other', value: 4, fill: '#6b7280' },
];

const performanceData = [
  { metric: 'On-Time', value: 95 },
  { metric: 'Customer Rating', value: 92 },
  { metric: 'Efficiency', value: 88 },
  { metric: 'Communication', value: 90 },
  { metric: 'Care', value: 94 },
  { metric: 'Speed', value: 85 },
];

const crewPerformanceData = [
  { name: 'Team A', performance: 92, fill: '#3b82f6' },
  { name: 'Team B', performance: 88, fill: '#8b5cf6' },
  { name: 'Team C', performance: 85, fill: '#10b981' },
  { name: 'Team D', performance: 78, fill: '#f59e0b' },
];

const conversionData = [
  { month: 'Jan', leads: 45, converted: 28 },
  { month: 'Feb', leads: 52, converted: 32 },
  { month: 'Mar', leads: 48, converted: 30 },
  { month: 'Apr', leads: 61, converted: 42 },
  { month: 'May', leads: 55, converted: 38 },
  { month: 'Jun', leads: 69, converted: 48 },
];

// Chart configurations
const revenueChartConfig = {
  revenue: {
    label: 'Revenue',
    color: '#3b82f6',
  },
  jobs: {
    label: 'Jobs',
    color: '#8b5cf6',
  },
} satisfies ChartConfig;

const jobsChartConfig = {
  completed: {
    label: 'Completed',
    color: '#10b981',
  },
  scheduled: {
    label: 'Scheduled',
    color: '#f59e0b',
  },
} satisfies ChartConfig;

const leadSourcesConfig = {
  value: {
    label: 'Leads',
  },
  'Google Ads': {
    label: 'Google Ads',
    color: '#3b82f6',
  },
  Referrals: {
    label: 'Referrals',
    color: '#8b5cf6',
  },
  Website: {
    label: 'Website',
    color: '#10b981',
  },
  Yelp: {
    label: 'Yelp',
    color: '#f59e0b',
  },
  Other: {
    label: 'Other',
    color: '#6b7280',
  },
} satisfies ChartConfig;

const performanceConfig = {
  value: {
    label: 'Score',
    color: '#3b82f6',
  },
} satisfies ChartConfig;

const crewConfig = {
  performance: {
    label: 'Performance',
  },
} satisfies ChartConfig;

const conversionConfig = {
  leads: {
    label: 'Leads',
    color: '#94a3b8',
  },
  converted: {
    label: 'Converted',
    color: '#10b981',
  },
} satisfies ChartConfig;

// Mock data for stats and lists
const stats = [
  {
    label: 'Revenue This Month',
    value: '$47,250',
    change: '+12.5%',
    trend: 'up',
    icon: DollarSign,
    color: 'green',
  },
  {
    label: 'Jobs Completed',
    value: '28',
    change: '+8.3%',
    trend: 'up',
    icon: CheckCircle2,
    color: 'blue',
  },
  {
    label: 'Jobs Today',
    value: '4',
    subtext: '2 in progress',
    icon: Truck,
    color: 'indigo',
  },
  {
    label: 'Pending Estimates',
    value: '12',
    subtext: '3 need follow-up',
    icon: FileText,
    color: 'amber',
  },
];

const upcomingJobs = [
  {
    id: 1,
    customer: 'Sarah Johnson',
    type: '3 Bedroom',
    date: 'Today',
    time: '8:00 AM - 10:00 AM',
    crew: 3,
    trucks: 1,
    status: 'in_progress',
    origin: '123 Oak St, Seattle',
    destination: '456 Pine Ave, Bellevue',
  },
  {
    id: 2,
    customer: 'Mike Thompson',
    type: '2 Bedroom',
    date: 'Today',
    time: '1:00 PM - 3:00 PM',
    crew: 2,
    trucks: 1,
    status: 'scheduled',
    origin: '789 Maple Dr, Seattle',
    destination: '321 Cedar Ln, Kirkland',
  },
  {
    id: 3,
    customer: 'Emily Davis',
    type: 'Office',
    date: 'Tomorrow',
    time: '9:00 AM - 11:00 AM',
    crew: 4,
    trucks: 2,
    status: 'scheduled',
    origin: '555 Business Park, Seattle',
    destination: '777 Corporate Blvd, Redmond',
  },
];

export default function QubesheetsDashboardPage() {
  const router = useRouter();
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCall[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [selectedTimezone, setSelectedTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedCall, setSelectedCall] = useState<ScheduledCall | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Reschedule modal state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>();
  const [rescheduleTime, setRescheduleTime] = useState('10:00');
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Cancel modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [sendCancellationSms, setSendCancellationSms] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  // Store the call being acted on (separate from selectedCall to avoid modal-on-modal)
  const [actionCall, setActionCall] = useState<ScheduledCall | null>(null);

  // Status filter
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'completed' | 'cancelled'>('all');

  // Common US timezones
  const timezones = [
    { value: 'America/New_York', label: 'Eastern (ET)' },
    { value: 'America/Chicago', label: 'Central (CT)' },
    { value: 'America/Denver', label: 'Mountain (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
    { value: 'America/Anchorage', label: 'Alaska (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
  ];

  // Get friendly timezone label
  const getTimezoneLabel = (tz: string) => {
    const found = timezones.find((t) => t.value === tz);
    return found ? found.label : tz;
  };

  // Fetch user's saved timezone
  useEffect(() => {
    const fetchUserTimezone = async () => {
      try {
        const response = await fetch('/api/user/timezone');
        if (response.ok) {
          const data = await response.json();
          if (data.timezone) {
            setSelectedTimezone(data.timezone);
          }
        }
      } catch (error) {
        console.error('Error fetching user timezone:', error);
      }
    };
    fetchUserTimezone();
  }, []);

  // Fetch scheduled calls
  useEffect(() => {
    fetchScheduledCalls();
  }, []);

  const fetchScheduledCalls = async () => {
    try {
      setLoadingCalls(true);
      const response = await fetch('/api/scheduled-calls');
      if (response.ok) {
        const data = await response.json();
        setScheduledCalls(data.calls || []);
        setAgents(data.agents || []);
      }
    } catch (error) {
      console.error('Error fetching scheduled calls:', error);
    } finally {
      setLoadingCalls(false);
    }
  };

  // Filter calls by selected agent and status
  const filteredCalls = scheduledCalls
    .filter(call => selectedAgentId === 'all' || call.userId === selectedAgentId)
    .filter(call => statusFilter === 'all' || call.status === statusFilter);

  // Get calls for a specific date (using filtered calls)
  const getCallsForDate = (date: Date) => {
    return filteredCalls.filter((call) => {
      const callDate = new Date(call.scheduledFor);
      return (
        callDate.getFullYear() === date.getFullYear() &&
        callDate.getMonth() === date.getMonth() &&
        callDate.getDate() === date.getDate()
      );
    });
  };

  // Get dates that have scheduled calls (using filtered calls)
  const datesWithCalls = filteredCalls.map((call) => {
    const d = new Date(call.scheduledFor);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });

  // Format time for display
  const formatTime = (dateString: string, timezone: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  };

  // Copy link to clipboard
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  // Reschedule handler
  const handleReschedule = async () => {
    if (!actionCall || !rescheduleDate) return;
    setIsRescheduling(true);

    try {
      // Combine date and time into ISO string with timezone
      const [hours, minutes] = rescheduleTime.split(':');
      const scheduledFor = new Date(rescheduleDate);
      scheduledFor.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const response = await fetch(
        `/api/projects/${actionCall.projectId}/scheduled-calls/${actionCall._id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduledFor: scheduledFor.toISOString(),
            timezone: selectedTimezone
          })
        }
      );

      if (response.ok) {
        toast.success(`Call rescheduled. ${actionCall.customerName} will receive an SMS with the new time.`);
        setShowRescheduleModal(false);
        setActionCall(null);
        fetchScheduledCalls();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to reschedule call');
      }
    } catch (error) {
      toast.error('Failed to reschedule call');
    }
    setIsRescheduling(false);
  };

  // Cancel handler
  const handleCancel = async () => {
    if (!actionCall) return;
    setIsCancelling(true);

    try {
      const response = await fetch(
        `/api/projects/${actionCall.projectId}/scheduled-calls/${actionCall._id}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendSms: sendCancellationSms })
        }
      );

      if (response.ok) {
        toast.success(
          sendCancellationSms
            ? `Call cancelled. ${actionCall.customerName} has been notified.`
            : 'Call cancelled.'
        );
        setShowCancelModal(false);
        setActionCall(null);
        fetchScheduledCalls();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to cancel call');
      }
    } catch (error) {
      toast.error('Failed to cancel call');
    }
    setIsCancelling(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">In Progress</Badge>;
      case 'scheduled':
        return <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">Scheduled</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Completed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      green: { bg: 'bg-green-100', text: 'text-green-600' },
      blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
      indigo: { bg: 'bg-indigo-100', text: 'text-indigo-600' },
      amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
    };
    return colors[color] || colors.blue;
  };

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden"></div>
        <div className="min-h-screen bg-slate-50 lg:pl-64 pt-4 lg:pt-20">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Dashboard</h1>
                <p className="text-sm text-gray-500 mt-1">Welcome back! Here's what's happening today.</p>
              </div>
              <div className="text-sm text-gray-500">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>
            </div>

            {/* Stats Grid - COMMENTED OUT
            <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
              {stats.map((stat, index) => {
                const Icon = stat.icon;
                const colorClasses = getColorClasses(stat.color);
                return (
                  <div
                    key={index}
                    className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  >
                    <div className={`w-10 h-10 rounded-lg ${colorClasses.bg} flex items-center justify-center mr-3 flex-shrink-0`}>
                      <Icon className={`h-5 w-5 ${colorClasses.text}`} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
                        {stat.trend && (
                          <div className={`flex items-center gap-0.5 text-xs ${
                            stat.trend === 'up' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {stat.trend === 'up' ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {stat.change}
                          </div>
                        )}
                      </div>
                      {stat.subtext && (
                        <p className="text-xs text-slate-500">{stat.subtext}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            */}

            {/* Charts Row 1 - Revenue Area Chart & Weekly Jobs Bar Chart - COMMENTED OUT
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue Overview</h2>
                <ChartContainer config={revenueChartConfig} className="h-[250px] w-full">
                  <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `$${value / 1000}k`} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
              <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Weekly Jobs</h2>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                      <span className="text-gray-600">Completed</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-sm bg-amber-500" />
                      <span className="text-gray-600">Scheduled</span>
                    </div>
                  </div>
                </div>
                <ChartContainer config={jobsChartConfig} className="h-[250px] w-full">
                  <BarChart data={weeklyJobsData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="scheduled" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            </div>
            */}

            {/* Charts Row 2 - Lead Sources Pie Chart & Conversion Line Chart - COMMENTED OUT
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Lead Sources</h2>
                <div className="flex items-center gap-6">
                  <ChartContainer config={leadSourcesConfig} className="h-[200px] w-[200px]">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                      <Pie
                        data={leadSourcesData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {leadSourcesData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="flex flex-col gap-2">
                    {leadSourcesData.map((item) => (
                      <div key={item.name} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.fill }} />
                        <span className="text-gray-600">{item.name}</span>
                        <span className="text-gray-400 ml-auto">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Lead Conversion</h2>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-slate-400" />
                      <span className="text-gray-600">Leads</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-gray-600">Converted</span>
                    </div>
                  </div>
                </div>
                <ChartContainer config={conversionConfig} className="h-[250px] w-full">
                  <LineChart data={conversionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="leads"
                      stroke="#94a3b8"
                      strokeWidth={2}
                      dot={{ fill: '#94a3b8', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="converted"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ fill: '#10b981', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ChartContainer>
              </div>
            </div>
            */}

            {/* Charts Row 3 - Performance Radar & Crew Radial - COMMENTED OUT
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Metrics</h2>
                <ChartContainer config={performanceConfig} className="h-[250px] w-full">
                  <RadarChart data={performanceData} cx="50%" cy="50%" outerRadius="80%">
                    <PolarGrid className="stroke-slate-200" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.3}
                    />
                  </RadarChart>
                </ChartContainer>
              </div>
              <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Crew Performance</h2>
                <div className="flex items-center gap-6">
                  <ChartContainer config={crewConfig} className="h-[200px] w-[200px]">
                    <RadialBarChart
                      data={crewPerformanceData}
                      cx="50%"
                      cy="50%"
                      innerRadius="20%"
                      outerRadius="100%"
                      startAngle={180}
                      endAngle={0}
                    >
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                      <RadialBar
                        dataKey="performance"
                        background
                        cornerRadius={10}
                      >
                        {crewPerformanceData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </RadialBar>
                    </RadialBarChart>
                  </ChartContainer>
                  <div className="flex flex-col gap-2">
                    {crewPerformanceData.map((item) => (
                      <div key={item.name} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.fill }} />
                        <span className="text-gray-600">{item.name}</span>
                        <span className="text-gray-400 ml-auto">{item.performance}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            */}

            {/* Upcoming Jobs - COMMENTED OUT
            <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Upcoming Jobs</h2>
                <button className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 cursor-pointer">
                  View All <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                {upcomingJobs.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="font-medium text-gray-900">{job.customer}</div>
                        {getStatusBadge(job.status)}
                      </div>
                      <button className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {job.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {job.time}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {job.crew} crew
                      </span>
                      <span className="flex items-center gap-1">
                        <Truck className="h-3.5 w-3.5" />
                        {job.trucks} truck{job.trucks > 1 ? 's' : ''}
                      </span>
                      <Badge variant="outline" className="text-xs">{job.type}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      {job.origin} → {job.destination}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            */}

            {/* Scheduled Virtual Calls Calendar */}
            <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Phone className="h-5 w-5 text-blue-500" />
                  Scheduled Virtual Calls
                </h2>

                {/* Filters */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Timezone Filter */}
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <select
                      value={selectedTimezone}
                      onChange={(e) => setSelectedTimezone(e.target.value)}
                      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                    >
                      {timezones.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Agent Filter */}
                  {agents.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-gray-400" />
                      <select
                        value={selectedAgentId}
                        onChange={(e) => setSelectedAgentId(e.target.value)}
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                      >
                        <option value="all">All Agents</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Status Filter */}
                  <div className="flex items-center gap-2">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                    >
                      <option value="all">All Statuses</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Calendar */}
                <div className="lg:col-span-1 flex flex-col items-center">
                  {/* Month Navigation */}
                  <div className="flex items-center justify-between w-full max-w-[280px] mb-2">
                    <button
                      onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="h-5 w-5 text-gray-600" />
                    </button>
                    <span className="text-sm font-medium text-gray-900">
                      {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                    >
                      <ChevronRight className="h-5 w-5 text-gray-600" />
                    </button>
                  </div>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    modifiers={{
                      hasEvent: datesWithCalls,
                    }}
                    classNames={{
                      month_caption: 'hidden',
                      button_previous: 'hidden',
                      button_next: 'hidden',
                      day: 'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:!bg-blue-600 [&:has([aria-selected])]:rounded-full',
                      day_button: 'h-8 w-8 p-0 font-normal hover:bg-gray-100 rounded-full aria-selected:!bg-blue-600 aria-selected:!text-white aria-selected:hover:!bg-blue-600 aria-selected:hover:!text-white aria-selected:font-semibold',
                      selected: '!bg-blue-600 !text-white hover:!bg-blue-600 hover:!text-white font-semibold rounded-full',
                    }}
                    modifiersClassNames={{
                      hasEvent: 'font-bold bg-blue-100 text-blue-700 rounded-full',
                    }}
                    className="rounded-md"
                  />
                </div>

                {/* Events for selected date */}
                <div className="lg:col-span-2">
                  <div className="mb-3">
                    <h3 className="text-sm font-medium text-gray-700">
                      {selectedDate ? (
                        <>
                          Calls for{' '}
                          {selectedDate.toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </>
                      ) : (
                        'Select a date'
                      )}
                    </h3>
                  </div>

                  {loadingCalls ? (
                    <div className="text-center py-8 text-gray-500">Loading calls...</div>
                  ) : selectedDate && getCallsForDate(selectedDate).length > 0 ? (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {getCallsForDate(selectedDate).map((call) => (
                        <div
                          key={call._id}
                          onClick={() => setSelectedCall(call)}
                          className="p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                                <Phone className="h-5 w-5 text-blue-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">{call.customerName}</p>
                                <p className="text-sm text-gray-500">
                                  {formatTime(call.scheduledFor, selectedTimezone)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                className={
                                  call.status === 'scheduled'
                                    ? 'bg-blue-100 text-blue-700'
                                    : call.status === 'started'
                                    ? 'bg-amber-100 text-amber-700'
                                    : call.status === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : call.status === 'cancelled'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-gray-100 text-gray-700'
                                }
                              >
                                {call.status === 'started' ? 'In Progress' : call.status.charAt(0).toUpperCase() + call.status.slice(1)}
                              </Badge>

                              {/* Quick actions - only for scheduled calls */}
                              {call.status === 'scheduled' && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const currentDate = new Date(call.scheduledFor);
                                      setRescheduleDate(currentDate);
                                      setRescheduleTime(currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
                                      setActionCall(call);
                                      setShowRescheduleModal(true);
                                    }}
                                    className="p-1.5 hover:bg-amber-100 rounded-full transition-colors"
                                    title="Reschedule"
                                  >
                                    <CalendarIcon className="h-4 w-4 text-amber-600" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActionCall(call);
                                      setShowCancelModal(true);
                                    }}
                                    className="p-1.5 hover:bg-red-100 rounded-full transition-colors"
                                    title="Cancel"
                                  >
                                    <XCircle className="h-4 w-4 text-red-500" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              {call.agent?.name || 'Unknown'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Phone className="h-3.5 w-3.5" />
                              {call.customerPhone}
                            </span>
                            {call.customerEmail && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3.5 w-3.5" />
                                {call.customerEmail}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500 bg-slate-50 rounded-lg">
                      <Phone className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p>No virtual calls scheduled for this date</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <SidebarTrigger />
      </SidebarProvider>

      {/* Call Details Modal */}
      <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-blue-500 flex-shrink-0" />
              Virtual Call Details
            </DialogTitle>
          </DialogHeader>

          {selectedCall && (
            <div className="space-y-4 overflow-y-auto flex-1 pr-1">
              {/* Customer Info */}
              <div className="bg-slate-50 rounded-lg p-4 overflow-hidden">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Customer</h4>
                <p className="font-semibold text-gray-900 text-lg truncate">{selectedCall.customerName}</p>
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <Phone className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{selectedCall.customerPhone}</span>
                  </p>
                  {selectedCall.customerEmail && (
                    <p className="text-sm text-gray-600 flex items-center gap-2">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{selectedCall.customerEmail}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Scheduled By */}
              <div className="bg-slate-50 rounded-lg p-4 overflow-hidden">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Scheduled By</h4>
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <User className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  <span className="truncate">{selectedCall.agent?.name || selectedCall.agent?.email || 'Unknown'}</span>
                </p>
                {selectedCall.agent?.name && selectedCall.agent?.email && (
                  <p className="text-sm text-gray-600 mt-1 truncate">{selectedCall.agent.email}</p>
                )}
              </div>

              {/* Schedule Info */}
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Scheduled For</h4>
                <p className="font-medium text-gray-900">
                  {new Date(selectedCall.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                <p className="text-sm text-gray-600">
                  {formatTime(selectedCall.scheduledFor, selectedTimezone)} ({getTimezoneLabel(selectedTimezone)})
                </p>
              </div>

              {/* Join Call Button */}
              <div className="space-y-3 overflow-hidden">
                <a
                  href={selectedCall.agentJoinLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-full font-medium transition-colors"
                >
                  <Phone className="h-5 w-5" />
                  Join Virtual Call
                </a>

                {/* Customer Link */}
                <div className="bg-gray-50 rounded-lg p-3 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-gray-700">Customer Join Link</span>
                      <p className="text-xs text-gray-500 truncate overflow-hidden mt-0.5">{selectedCall.customerJoinLink}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(selectedCall.customerJoinLink, 'Customer link')}
                      className="p-2 hover:bg-gray-200 rounded-lg cursor-pointer flex-shrink-0 transition-colors"
                      title="Copy link"
                    >
                      <Copy className="h-5 w-5 text-gray-600" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3 pt-2 flex-shrink-0">
                <button
                  onClick={() => router.push(`/projects/${selectedCall.projectId}`)}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <ArrowRight className="h-4 w-4 flex-shrink-0" />
                  Go to Project
                </button>

                {selectedCall.status === 'scheduled' && (
                  <div className="flex items-center justify-center gap-4 text-sm">
                    <button
                      onClick={() => {
                        const currentDate = new Date(selectedCall.scheduledFor);
                        setRescheduleDate(currentDate);
                        setRescheduleTime(currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
                        setActionCall(selectedCall);
                        setSelectedCall(null);
                        setShowRescheduleModal(true);
                      }}
                      className="text-gray-600 hover:text-amber-600 font-medium cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <CalendarIcon className="h-4 w-4" />
                      Reschedule
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => {
                        setActionCall(selectedCall);
                        setSelectedCall(null);
                        setShowCancelModal(true);
                      }}
                      className="text-gray-600 hover:text-red-600 font-medium cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <XCircle className="h-4 w-4" />
                      Cancel Call
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reschedule Modal */}
      <Dialog open={showRescheduleModal} onOpenChange={(open) => {
        setShowRescheduleModal(open);
        if (!open) setActionCall(null);
      }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-amber-500" />
              Reschedule Virtual Call
            </DialogTitle>
          </DialogHeader>

          {actionCall && (
            <div className="space-y-4">
              {/* Current schedule info */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-500">Currently scheduled for</p>
                <p className="font-medium text-gray-900">
                  {new Date(actionCall.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric'
                  })} at {formatTime(actionCall.scheduledFor, selectedTimezone)}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Customer: {actionCall.customerName} ({actionCall.customerPhone})
                </p>
              </div>

              {/* Quick date options */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setRescheduleDate(tomorrow);
                  }}
                  className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Tomorrow
                </button>
                <button
                  onClick={() => {
                    const nextWeek = new Date();
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    setRescheduleDate(nextWeek);
                  }}
                  className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Next Week
                </button>
              </div>

              {/* Date picker */}
              <div>
                <label className="text-sm font-medium text-gray-700">New Date</label>
                <Calendar
                  mode="single"
                  selected={rescheduleDate}
                  onSelect={setRescheduleDate}
                  disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                  className="rounded-md border mt-1"
                />
              </div>

              {/* Time picker */}
              <div>
                <label className="text-sm font-medium text-gray-700">New Time</label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* SMS notification info */}
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <p className="text-blue-700">
                  <strong>Note:</strong> The customer will receive an SMS with the updated time and a new join link.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleReschedule}
                  disabled={!rescheduleDate || isRescheduling}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isRescheduling ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Rescheduling...
                    </>
                  ) : (
                    'Confirm Reschedule'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowRescheduleModal(false);
                    setActionCall(null);
                  }}
                  className="px-4 py-2.5 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Modal */}
      <Dialog open={showCancelModal} onOpenChange={(open) => {
        setShowCancelModal(open);
        if (!open) setActionCall(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Cancel Virtual Call
            </DialogTitle>
          </DialogHeader>

          {actionCall && (
            <div className="space-y-4">
              {/* Warning */}
              <div className="bg-red-50 rounded-lg p-4">
                <p className="text-red-700 font-medium">
                  Are you sure you want to cancel this call?
                </p>
                <p className="text-red-600 text-sm mt-1">
                  This will remove the calendar event. This action cannot be undone.
                </p>
              </div>

              {/* Call details */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="font-medium text-gray-900">{actionCall.customerName}</p>
                <p className="text-sm text-gray-500">{actionCall.customerPhone}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Scheduled for {new Date(actionCall.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric'
                  })} at {formatTime(actionCall.scheduledFor, selectedTimezone)}
                </p>
              </div>

              {/* SMS option */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendCancellationSms}
                  onChange={(e) => setSendCancellationSms(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Send cancellation SMS to {actionCall.customerName}
                </span>
              </label>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isCancelling ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    'Yes, Cancel Call'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowCancelModal(false);
                    setActionCall(null);
                  }}
                  className="px-4 py-2.5 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Keep Call
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <IntercomChat />
    </>
  );
}
