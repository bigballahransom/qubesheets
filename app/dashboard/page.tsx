'use client';

import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  Users,
  Truck,
  FileText,
  Phone,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  MoreHorizontal,
} from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import { Badge } from '@/components/ui/badge';
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

export default function DashboardPage() {
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
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
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

            {/* Stats Grid */}
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

            {/* Charts Row 1 - Revenue Area Chart & Weekly Jobs Bar Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Revenue Area Chart */}
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

              {/* Weekly Jobs Bar Chart */}
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

            {/* Charts Row 2 - Lead Sources Pie Chart & Conversion Line Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Lead Sources Pie Chart */}
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

              {/* Conversion Line Chart */}
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

            {/* Charts Row 3 - Performance Radar & Crew Radial */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Performance Radar Chart */}
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

              {/* Crew Performance Radial Chart */}
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

            {/* Upcoming Jobs */}
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
                        <Calendar className="h-3.5 w-3.5" />
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
          </div>
        </div>
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}
