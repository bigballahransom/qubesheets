'use client';

import React, { useState, useEffect } from 'react';
import {
  Building2,
  Settings,
  Calculator,
  Truck,
  Users,
  Link,
  FileText,
  Shield,
  Globe,
  Mail,
  MessageSquare,
  Zap,
  ScrollText,
  Clock,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  ArrowRight,
  Minus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import { cn } from '@/lib/utils';

interface IArrivalOption {
  id: string;
  type: 'single' | 'window';
  startTime: string;
  endTime?: string;
  label: string;
}

type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type CrewSize = '1' | '2' | '3' | '4' | '5' | '6' | 'additional';

interface IHourlyRates {
  [crew: string]: {
    [day: string]: number;
  };
}

const DEFAULT_HOURLY_RATES: IHourlyRates = {
  '1': { mon: 99, tue: 99, wed: 99, thu: 99, fri: 99, sat: 99, sun: 99 },
  '2': { mon: 159, tue: 159, wed: 159, thu: 159, fri: 159, sat: 159, sun: 159 },
  '3': { mon: 229, tue: 229, wed: 229, thu: 229, fri: 229, sat: 229, sun: 229 },
  '4': { mon: 279, tue: 279, wed: 279, thu: 279, fri: 279, sat: 279, sun: 279 },
  '5': { mon: 325, tue: 325, wed: 325, thu: 325, fri: 325, sat: 325, sun: 325 },
  '6': { mon: 375, tue: 375, wed: 375, thu: 375, fri: 375, sat: 375, sun: 375 },
  'additional': { mon: 70, tue: 70, wed: 70, thu: 70, fri: 70, sat: 70, sun: 70 },
  'minimum': { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
};

interface NavItem {
  id: string;
  label: string;
  icon: any;
  children?: { id: string; label: string; icon: any }[];
}

const settingsNavItems: NavItem[] = [
  { id: 'organization', label: 'Organization Settings', icon: Settings },
  {
    id: 'estimate',
    label: 'Estimate Settings',
    icon: Calculator,
    children: [
      { id: 'estimate-arrival-times', label: 'Arrival Times', icon: Clock },
      { id: 'estimate-hourly-rates', label: 'Hourly Rates', icon: Calculator },
      { id: 'estimate-tariffs', label: 'Tariffs', icon: FileText },
    ],
  },
  { id: 'long-distance', label: 'Long Distance Settings', icon: Truck },
  { id: 'crew-truck', label: 'Crew and Truck', icon: Users },
  { id: 'integrations', label: 'Integration Settings', icon: Link },
  { id: 'lead-providers', label: 'Lead Providers', icon: FileText },
  { id: 'valuation', label: 'Valuation Protection', icon: Shield },
  { id: 'website-forms', label: 'Website Forms', icon: Globe },
  { id: 'email-templates', label: 'Email Templates', icon: Mail },
  { id: 'sms-templates', label: 'SMS Templates', icon: MessageSquare },
  { id: 'email-automations', label: 'Email Automations', icon: Zap },
  { id: 'sales-scripts', label: 'Sales Scripts', icon: ScrollText },
];

export default function CrmSettingsPage() {
  const [activeSection, setActiveSection] = useState('organization');
  const [expandedSections, setExpandedSections] = useState<string[]>(['estimate']);

  const toggleExpanded = (id: string) => {
    setExpandedSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'organization':
        return <OrganizationSettingsContent />;
      case 'estimate-arrival-times':
        return <EstimateArrivalTimesContent />;
      case 'estimate-hourly-rates':
        return <EstimateHourlyRatesContent />;
      case 'estimate-tariffs':
        return <EstimateTariffsContent />;
      case 'long-distance':
        return <PlaceholderContent title="Long Distance Settings" description="Configure settings for long distance moves." />;
      case 'crew-truck':
        return <PlaceholderContent title="Crew and Truck" description="Manage your crew members and truck inventory." />;
      case 'integrations':
        return <PlaceholderContent title="Integration Settings" description="Connect with third-party services and APIs." />;
      case 'lead-providers':
        return <PlaceholderContent title="Lead Providers" description="Configure your lead provider integrations." />;
      case 'valuation':
        return <PlaceholderContent title="Valuation Protection" description="Set up valuation protection options for customers." />;
      case 'website-forms':
        return <PlaceholderContent title="Website Forms" description="Customize forms for your website." />;
      case 'email-templates':
        return <PlaceholderContent title="Email Templates" description="Create and manage email templates." />;
      case 'sms-templates':
        return <PlaceholderContent title="SMS Templates" description="Create and manage SMS templates." />;
      case 'email-automations':
        return <PlaceholderContent title="Email Automations" description="Set up automated email sequences." />;
      case 'sales-scripts':
        return <PlaceholderContent title="Sales Scripts" description="Create scripts for your sales team." />;
      default:
        return <OrganizationSettingsContent />;
    }
  };

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16"></div>

        <div className="min-h-screen bg-slate-50 lg:pl-64 pt-4 lg:pt-20">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {/* Breadcrumb Header */}
            <div className="flex items-center gap-2 text-sm mb-6">
              <span className="text-gray-500">Settings</span>
              <span className="text-gray-400">/</span>
              <span className="font-medium text-gray-900">CRM Settings</span>
            </div>

            {/* Main Layout */}
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Left Sidebar Navigation */}
              <div className="w-full lg:w-64 flex-shrink-0">
                <nav className="bg-white rounded-xl border shadow-sm p-2">
                  <ul className="space-y-1">
                    {settingsNavItems.map((item) => {
                      const Icon = item.icon;
                      const hasChildren = item.children && item.children.length > 0;
                      const isExpanded = expandedSections.includes(item.id);
                      const isActive = activeSection === item.id ||
                        (hasChildren && item.children?.some(child => child.id === activeSection));

                      return (
                        <li key={item.id}>
                          <button
                            onClick={() => {
                              if (hasChildren) {
                                toggleExpanded(item.id);
                              } else {
                                setActiveSection(item.id);
                              }
                            }}
                            className={cn(
                              'flex items-center w-full px-3 py-2.5 rounded-lg text-left text-sm transition-colors',
                              isActive
                                ? 'bg-slate-100 text-slate-900 font-medium'
                                : 'text-slate-600 hover:bg-slate-50'
                            )}
                          >
                            <Icon size={18} className="mr-3 flex-shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            {hasChildren && (
                              <ChevronDown
                                size={16}
                                className={cn(
                                  'text-slate-400 transition-transform',
                                  isExpanded && 'rotate-180'
                                )}
                              />
                            )}
                          </button>

                          {/* Children items */}
                          {hasChildren && isExpanded && (
                            <ul className="ml-6 mt-1 space-y-1 border-l border-slate-200 pl-3">
                              {item.children?.map((child) => {
                                const ChildIcon = child.icon;
                                const isChildActive = activeSection === child.id;
                                return (
                                  <li key={child.id}>
                                    <button
                                      onClick={() => setActiveSection(child.id)}
                                      className={cn(
                                        'flex items-center w-full px-3 py-2 rounded-lg text-left text-sm transition-colors',
                                        isChildActive
                                          ? 'bg-slate-100 text-slate-900 font-medium'
                                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                      )}
                                    >
                                      <ChildIcon size={16} className="mr-2 flex-shrink-0" />
                                      <span>{child.label}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </div>

              {/* Right Content Area */}
              <div className="flex-1 min-w-0">
                {renderContent()}
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

function OrganizationSettingsContent() {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Organization Profile</h2>
        <p className="text-sm text-gray-500 mt-1">Update your organization's contact information and details</p>
      </div>

      <div className="space-y-5">
        {/* Organization ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Organization ID</label>
          <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500">
            org_placeholder_id
          </div>
        </div>

        {/* Company Name */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <Building2 size={16} className="text-gray-400" />
            Company Name
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter company name"
          />
        </div>

        {/* Phone Number */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <MessageSquare size={16} className="text-gray-400" />
            Phone Number
          </label>
          <input
            type="tel"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="(555) 123-4567"
          />
        </div>

        {/* DOT Number */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <FileText size={16} className="text-gray-400" />
            DOT Number
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="DOT #0000000"
          />
        </div>

        {/* State Permit Number */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <FileText size={16} className="text-gray-400" />
            State Permit Number
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="HG #000000"
          />
        </div>

        {/* Website URL */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <Globe size={16} className="text-gray-400" />
            Website URL
          </label>
          <input
            type="url"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="https://yourcompany.com"
          />
        </div>

        {/* Company Logo */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <Building2 size={16} className="text-gray-400" />
            Company Logo
          </label>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center">
              <Building2 size={24} className="text-slate-400" />
            </div>
            <div className="flex-1">
              <input
                type="file"
                className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 file:cursor-pointer"
                accept="image/png,image/jpeg,image/gif"
              />
              <p className="text-xs text-gray-400 mt-1">Max file size: 2MB. Supported formats: PNG, JPG, GIF</p>
            </div>
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
            <Globe size={16} className="text-gray-400" />
            Address
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="123 Main St, City, State 00000"
          />
        </div>

        {/* Save Button */}
        <div className="pt-4">
          <button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function EstimateArrivalTimesContent() {
  const [arrivalOptions, setArrivalOptions] = useState<IArrivalOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<IArrivalOption | null>(null);
  const [optionType, setOptionType] = useState<'single' | 'window'>('window');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('10:00');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings/crm');
      if (response.ok) {
        const data = await response.json();
        setArrivalOptions(data.arrivalOptions || []);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeForDisplay = (time24: string): string => {
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const generateLabel = (type: 'single' | 'window', start: string, end?: string): string => {
    if (type === 'single') {
      return formatTimeForDisplay(start);
    }
    return `${formatTimeForDisplay(start)} - ${formatTimeForDisplay(end || '')}`;
  };

  const openAddModal = () => {
    setEditingOption(null);
    setOptionType('window');
    setStartTime('08:00');
    setEndTime('10:00');
    setModalOpen(true);
  };

  const openEditModal = (option: IArrivalOption) => {
    setEditingOption(option);
    setOptionType(option.type);
    setStartTime(option.startTime);
    setEndTime(option.endTime || '10:00');
    setModalOpen(true);
  };

  const handleSaveOption = () => {
    const label = generateLabel(optionType, startTime, optionType === 'window' ? endTime : undefined);

    if (editingOption) {
      // Update existing option
      setArrivalOptions(prev =>
        prev.map(opt =>
          opt.id === editingOption.id
            ? { ...opt, type: optionType, startTime, endTime: optionType === 'window' ? endTime : undefined, label }
            : opt
        )
      );
    } else {
      // Add new option
      const newOption: IArrivalOption = {
        id: `option-${Date.now()}`,
        type: optionType,
        startTime,
        endTime: optionType === 'window' ? endTime : undefined,
        label,
      };
      setArrivalOptions(prev => [...prev, newOption]);
    }
    setModalOpen(false);
  };

  const handleDeleteOption = (id: string) => {
    setArrivalOptions(prev => prev.filter(opt => opt.id !== id));
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivalOptions }),
      });
      if (!response.ok) {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2 mb-6"></div>
          <div className="space-y-3">
            <div className="h-12 bg-slate-200 rounded"></div>
            <div className="h-12 bg-slate-200 rounded"></div>
            <div className="h-12 bg-slate-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Arrival Times</h2>
              <p className="text-sm text-gray-500 mt-1">Configure the arrival time options available when scheduling jobs</p>
            </div>
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 text-sm bg-slate-900 hover:bg-slate-800 text-white font-medium py-2 px-3 rounded-lg transition-colors"
            >
              <Plus size={16} />
              Add Option
            </button>
          </div>
        </div>

        {/* Options List */}
        <div className="space-y-2">
          {arrivalOptions.length === 0 ? (
            <div className="py-12 text-center text-gray-400 border border-dashed rounded-lg">
              <Clock size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No arrival options configured</p>
              <p className="text-xs mt-1">Click "Add Option" to create one</p>
            </div>
          ) : (
            arrivalOptions.map((option) => (
              <div
                key={option.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-white rounded-md border border-slate-200">
                    <Clock size={16} className="text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{option.label}</p>
                    <p className="text-xs text-gray-500">
                      {option.type === 'single' ? 'Single time' : 'Time window'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(option)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-slate-100 rounded-md transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteOption(option.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Save Button */}
        <div className="pt-6 mt-6 border-t">
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingOption ? 'Edit Arrival Option' : 'Add Arrival Option'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Option Type Toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Option Type
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setOptionType('single')}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors border',
                    optionType === 'single'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-gray-700 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  Single Time
                </button>
                <button
                  onClick={() => setOptionType('window')}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors border',
                    optionType === 'window'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-gray-700 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  Time Window
                </button>
              </div>
            </div>

            {/* Time Inputs */}
            {optionType === 'single' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Arrival Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Preview */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-gray-500 mb-1">Preview</p>
              <p className="text-sm font-medium text-gray-900">
                {generateLabel(optionType, startTime, optionType === 'window' ? endTime : undefined)}
              </p>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setModalOpen(false)}
              className="flex-1 py-2.5 px-4 border border-slate-200 text-gray-700 font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveOption}
              className="flex-1 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors"
            >
              {editingOption ? 'Update' : 'Add'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EstimateHourlyRatesContent() {
  const [rates, setRates] = useState<IHourlyRates>(DEFAULT_HOURLY_RATES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const days: { key: DayOfWeek; label: string }[] = [
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
    { key: 'sun', label: 'Sun' },
  ];

  const crewSizes: { key: CrewSize; label: string }[] = [
    { key: '1', label: '1 Crew' },
    { key: '2', label: '2 Crew' },
    { key: '3', label: '3 Crew' },
    { key: '4', label: '4 Crew' },
    { key: '5', label: '5 Crew' },
    { key: '6', label: '6 Crew' },
    { key: 'additional', label: 'Each Additional' },
  ];

  useEffect(() => {
    fetchRates();
  }, []);

  const fetchRates = async () => {
    try {
      const response = await fetch('/api/settings/crm');
      if (response.ok) {
        const data = await response.json();
        if (data.hourlyRates) {
          setRates(data.hourlyRates);
        }
      }
    } catch (error) {
      console.error('Error fetching rates:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const [editingCell, setEditingCell] = useState<{ crew: string; day: string; value: string } | null>(null);

  const handleRateChange = (crew: string, day: string, value: string) => {
    // Allow empty string while editing
    setEditingCell({ crew, day, value });
  };

  const handleRateBlur = (crew: string, day: string) => {
    if (editingCell && editingCell.crew === crew && editingCell.day === day) {
      const numValue = parseFloat(editingCell.value) || 0;
      setRates((prev) => ({
        ...prev,
        [crew]: {
          ...prev[crew],
          [day]: numValue,
        },
      }));
      setEditingCell(null);
    }
  };

  const handleRateFocus = (crew: string, day: string) => {
    const currentValue = rates[crew]?.[day] || 0;
    setEditingCell({ crew, day, value: currentValue.toString() });
  };

  const getRateDisplayValue = (crew: string, day: string) => {
    if (editingCell && editingCell.crew === crew && editingCell.day === day) {
      return editingCell.value;
    }
    return rates[crew]?.[day]?.toString() || '0';
  };

  const handleMinimumChange = (day: string, delta: number) => {
    setRates((prev) => {
      const currentValue = prev['minimum']?.[day] || 1;
      const newValue = Math.max(1, currentValue + delta);
      return {
        ...prev,
        ['minimum']: {
          ...prev['minimum'],
          [day]: newValue,
        },
      };
    });
  };

  const copyRatesToNextDay = (fromDayIndex: number) => {
    const fromDay = days[fromDayIndex].key;
    const toDay = days[fromDayIndex + 1].key;

    setRates((prev) => {
      const newRates = { ...prev };
      crewSizes.forEach((crew) => {
        newRates[crew.key] = {
          ...newRates[crew.key],
          [toDay]: prev[crew.key]?.[fromDay] || 0,
        };
      });
      return newRates;
    });
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hourlyRates: rates }),
      });
      if (!response.ok) {
        throw new Error('Failed to save rates');
      }
    } catch (error) {
      console.error('Error saving rates:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2 mb-6"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Hourly Rates</h2>
        <p className="text-sm text-gray-500 mt-1">Configure hourly rates by day of week and crew size</p>
      </div>

      {/* Rates Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider p-2 bg-slate-50 border border-slate-200 rounded-tl-lg">
                # Crew
              </th>
              {days.map((day, index) => (
                <React.Fragment key={day.key}>
                  <th
                    className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider p-2 bg-slate-50 border border-slate-200 min-w-[80px]"
                  >
                    {day.label}
                  </th>
                  {index < days.length - 1 && (
                    <th className="w-0 p-0 border-0 bg-slate-50 relative">
                      <button
                        onClick={() => copyRatesToNextDay(index)}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-6 h-6 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
                        title={`Copy ${day.label} rates to ${days[index + 1].label}`}
                      >
                        <ArrowRight size={12} />
                      </button>
                    </th>
                  )}
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {crewSizes.map((crew) => (
              <tr key={crew.key}>
                <td className="text-sm font-medium text-gray-700 p-2 bg-slate-50 border border-slate-200 whitespace-nowrap">
                  {crew.label}
                </td>
                {days.map((day, index) => (
                  <React.Fragment key={day.key}>
                    <td className="p-1 border border-slate-200">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={getRateDisplayValue(crew.key, day.key)}
                          onChange={(e) => handleRateChange(crew.key, day.key, e.target.value)}
                          onFocus={() => handleRateFocus(crew.key, day.key)}
                          onBlur={() => handleRateBlur(crew.key, day.key)}
                          className="w-full pl-6 pr-2 py-2 text-sm text-center border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded"
                        />
                      </div>
                    </td>
                    {index < days.length - 1 && (
                      <td className="w-0 p-0 border-0" />
                    )}
                  </React.Fragment>
                ))}
              </tr>
            ))}
            {/* Hourly Minimum Row */}
            <tr>
              <td className="text-sm font-medium text-gray-700 p-2 bg-slate-100 border border-slate-200 whitespace-nowrap">
                Hourly Minimum
              </td>
              {days.map((day, index) => {
                const currentValue = rates['minimum']?.[day.key] || 1;
                return (
                  <React.Fragment key={day.key}>
                    <td className="p-1 border border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleMinimumChange(day.key, -1)}
                          disabled={currentValue <= 1}
                          className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-6 text-center text-sm font-medium">{currentValue}</span>
                        <button
                          onClick={() => handleMinimumChange(day.key, 1)}
                          className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    {index < days.length - 1 && (
                      <td className="w-0 p-0 border-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Save Button */}
      <div className="pt-6 mt-6 border-t">
        <button
          onClick={handleSaveAll}
          disabled={isSaving}
          className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

interface ITariffItem {
  id: string;
  name: string;
  price: number;
  unit: string;
}

const DEFAULT_TARIFFS: ITariffItem[] = [
  { id: 'travel-time', name: 'Travel Time', price: 50, unit: 'per hour' },
  { id: 'fuel-surcharge', name: 'Fuel Surcharge', price: 0, unit: 'percentage' },
  { id: 'stair-carry', name: 'Stair Carry', price: 75, unit: 'per flight' },
  { id: 'long-carry', name: 'Long Carry (75+ ft)', price: 75, unit: 'flat fee' },
  { id: 'elevator', name: 'Elevator Fee', price: 75, unit: 'flat fee' },
  { id: 'packing-materials', name: 'Packing Materials', price: 0, unit: 'at cost' },
];

function EstimateTariffsContent() {
  const [tariffs, setTariffs] = useState<ITariffItem[]>(DEFAULT_TARIFFS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; value: string } | null>(null);

  useEffect(() => {
    fetchTariffs();
  }, []);

  const fetchTariffs = async () => {
    try {
      const response = await fetch('/api/settings/crm');
      if (response.ok) {
        const data = await response.json();
        if (data.tariffs && data.tariffs.length > 0) {
          setTariffs(data.tariffs);
        }
      }
    } catch (error) {
      console.error('Error fetching tariffs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePriceChange = (id: string, value: string) => {
    setEditingCell({ id, value });
  };

  const handlePriceBlur = (id: string) => {
    if (editingCell && editingCell.id === id) {
      const numValue = parseFloat(editingCell.value) || 0;
      setTariffs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, price: numValue } : t))
      );
      setEditingCell(null);
    }
  };

  const handlePriceFocus = (id: string) => {
    const tariff = tariffs.find((t) => t.id === id);
    if (tariff) {
      setEditingCell({ id, value: tariff.price.toString() });
    }
  };

  const getPriceDisplayValue = (id: string) => {
    if (editingCell && editingCell.id === id) {
      return editingCell.value;
    }
    const tariff = tariffs.find((t) => t.id === id);
    return tariff?.price.toString() || '0';
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tariffs }),
      });
      if (!response.ok) {
        throw new Error('Failed to save tariffs');
      }
    } catch (error) {
      console.error('Error saving tariffs:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2 mb-6"></div>
          <div className="space-y-3">
            <div className="h-12 bg-slate-200 rounded"></div>
            <div className="h-12 bg-slate-200 rounded"></div>
            <div className="h-12 bg-slate-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Tariffs</h2>
        <p className="text-sm text-gray-500 mt-1">Configure additional charges and fees for estimates</p>
      </div>

      {/* Tariffs List */}
      <div className="space-y-3">
        {tariffs.map((tariff) => (
          <div
            key={tariff.id}
            className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200"
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{tariff.name}</p>
              <p className="text-xs text-gray-500">{tariff.unit}</p>
            </div>
            <div className="w-32">
              <div className="relative">
                {tariff.unit === 'percentage' ? (
                  <>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={getPriceDisplayValue(tariff.id)}
                      onChange={(e) => handlePriceChange(tariff.id, e.target.value)}
                      onFocus={() => handlePriceFocus(tariff.id)}
                      onBlur={() => handlePriceBlur(tariff.id)}
                      className="w-full pl-3 pr-8 py-2 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </>
                ) : tariff.unit === 'at cost' ? (
                  <div className="w-full px-3 py-2 text-sm text-right text-gray-500 bg-slate-100 border border-slate-200 rounded-lg">
                    At Cost
                  </div>
                ) : (
                  <>
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={getPriceDisplayValue(tariff.id)}
                      onChange={(e) => handlePriceChange(tariff.id, e.target.value)}
                      onFocus={() => handlePriceFocus(tariff.id)}
                      onBlur={() => handlePriceBlur(tariff.id)}
                      className="w-full pl-7 pr-3 py-2 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Save Button */}
      <div className="pt-6 mt-6 border-t">
        <button
          onClick={handleSaveAll}
          disabled={isSaving}
          className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

function PlaceholderContent({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      <div className="py-12 text-center text-gray-400">
        <p>Coming soon</p>
      </div>
    </div>
  );
}
