'use client';

import { useState, useEffect } from 'react';
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

const settingsNavItems = [
  { id: 'organization', label: 'Organization Settings', icon: Settings },
  { id: 'estimate', label: 'Estimate Settings', icon: Calculator },
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

  const renderContent = () => {
    switch (activeSection) {
      case 'organization':
        return <OrganizationSettingsContent />;
      case 'estimate':
        return <EstimateSettingsContent />;
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
                      const isActive = activeSection === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            onClick={() => setActiveSection(item.id)}
                            className={cn(
                              'flex items-center w-full px-3 py-2.5 rounded-lg text-left text-sm transition-colors',
                              isActive
                                ? 'bg-slate-100 text-slate-900 font-medium'
                                : 'text-slate-600 hover:bg-slate-50'
                            )}
                          >
                            <Icon size={18} className="mr-3 flex-shrink-0" />
                            <span>{item.label}</span>
                          </button>
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

function EstimateSettingsContent() {
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
          <h2 className="text-xl font-semibold text-gray-900">Estimate Settings</h2>
          <p className="text-sm text-gray-500 mt-1">Configure settings for your estimates and scheduling</p>
        </div>

        {/* Arrival Time Options Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-gray-400" />
              <h3 className="text-sm font-medium text-gray-700">Arrival Time Options</h3>
            </div>
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <Plus size={16} />
              Add Option
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Configure the arrival time options available when scheduling jobs
          </p>

          {/* Options List */}
          <div className="space-y-2">
            {arrivalOptions.length === 0 ? (
              <div className="py-8 text-center text-gray-400 border border-dashed rounded-lg">
                <Clock size={24} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No arrival options configured</p>
                <p className="text-xs mt-1">Click "Add Option" to create one</p>
              </div>
            ) : (
              arrivalOptions.map((option) => (
                <div
                  key={option.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 bg-white rounded-md border border-slate-200">
                      <Clock size={14} className="text-slate-500" />
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
