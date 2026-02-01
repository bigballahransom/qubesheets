'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useOrganization, useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
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
  Copy,
  Check,
  Code,
  Eye,
  Bell,
  Loader2,
  Phone,
  UserCog,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  { id: 'notifications', label: 'Notifications', icon: Bell },
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
      case 'notifications':
        return <NotificationsContent />;
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
        return <WebsiteFormsContent />;
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

interface CrmNotificationSettingsData {
  smsNewLead: boolean;
  phoneNumber: string | null;
  lastSmsStatus?: {
    status: 'delivered' | 'failed' | 'unknown';
    timestamp: string;
    errorCode?: string;
    errorMessage?: string;
  } | null;
}

interface TeamMemberSettings {
  userId: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  identifier: string;
  role: string;
  smsNewLead: boolean;
  phoneNumber: string | null;
  lastSmsStatus?: {
    status: 'delivered' | 'failed' | 'unknown';
    timestamp: string;
  } | null;
  lastUpdatedBy: string | null;
  updatedAt: string | null;
  hasChanges?: boolean;
  phoneInput?: string;
}

// Phone formatting utilities
const formatPhoneNumber = (value: string, previousValue: string = ''): string => {
  const digits = value.replace(/\D/g, '');
  const prevDigits = previousValue.replace(/\D/g, '');
  const isDeleting = digits.length < prevDigits.length;
  const limitedDigits = digits.slice(0, 10);

  if (limitedDigits.length === 0) return '';
  if (isDeleting && limitedDigits.length <= 3) return limitedDigits;

  if (limitedDigits.length >= 7) {
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
  } else if (limitedDigits.length >= 4) {
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
  } else if (limitedDigits.length >= 1) {
    return isDeleting ? limitedDigits : `(${limitedDigits}`;
  }
  return limitedDigits;
};

const formatPhoneForDisplay = (twilioPhone: string | null): string => {
  if (!twilioPhone) return '';
  const digits = twilioPhone.replace(/^\+1/, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return twilioPhone;
};

function SmsStatusDot({ status }: { status?: { status: string } | null }) {
  if (!status) return null;
  const color =
    status.status === 'delivered'
      ? 'bg-green-500'
      : status.status === 'failed'
      ? 'bg-red-500'
      : 'bg-gray-400';
  const label =
    status.status === 'delivered'
      ? 'Last SMS delivered'
      : status.status === 'failed'
      ? 'Last SMS failed'
      : 'Status unknown';
  return (
    <span
      title={label}
      className={`inline-block w-2 h-2 rounded-full ${color}`}
    />
  );
}

function NotificationsContent() {
  const { organization, membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';

  return (
    <div className="space-y-6">
      <YourNotificationSettings organization={organization} />
      {isAdmin && <TeamNotificationSettings />}
    </div>
  );
}

function YourNotificationSettings({ organization }: { organization: any }) {
  const [settings, setSettings] = useState<CrmNotificationSettingsData>({
    smsNewLead: false,
    phoneNumber: null,
    lastSmsStatus: null,
  });
  const [phoneInput, setPhoneInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/crm/notification-settings');
        if (response.ok) {
          const data = await response.json();
          setSettings({
            smsNewLead: data.smsNewLead || false,
            phoneNumber: data.phoneNumber || null,
            lastSmsStatus: data.lastSmsStatus || null,
          });
          setPhoneInput(formatPhoneForDisplay(data.phoneNumber));
        }
      } catch (error) {
        console.error('Error fetching CRM notification settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (organization) {
      fetchSettings();
    } else {
      setIsLoading(false);
    }
  }, [organization]);

  const handleToggle = (enabled: boolean) => {
    setSettings((prev) => ({ ...prev, smsNewLead: enabled }));
    setHasChanges(true);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = formatPhoneNumber(e.target.value, phoneInput);
    setPhoneInput(newValue);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/crm/notification-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smsNewLead: settings.smsNewLead,
          phoneNumber: phoneInput.trim() || null,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save settings');
      }
      const data = await response.json();
      setSettings({
        smsNewLead: data.smsNewLead,
        phoneNumber: data.phoneNumber,
        lastSmsStatus: data.lastSmsStatus || null,
      });
      setPhoneInput(formatPhoneForDisplay(data.phoneNumber));
      setHasChanges(false);
      toast.success('Notification settings saved');
    } catch (error: any) {
      toast.error(error.message || 'Failed to save settings');
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
            <div className="h-16 bg-slate-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Your Notification Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure your personal SMS notifications for CRM events
        </p>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            New Lead Notifications
          </h3>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">SMS for New Leads</p>
                <p className="text-xs text-gray-500 mt-1">
                  Get an SMS when a new lead is submitted via your website form
                </p>
              </div>
              <Switch
                checked={settings.smsNewLead}
                onCheckedChange={handleToggle}
              />
            </div>
          </div>

          {settings.smsNewLead && (
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Phone Number for SMS
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={handlePhoneChange}
                  placeholder="(555) 123-4567"
                  className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <SmsStatusDot status={settings.lastSmsStatus} />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                US phone number required for SMS notifications
              </p>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving || !hasChanges}
        className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
      >
        {isSaving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes to Save'}
      </button>

      {hasChanges && (
        <p className="text-sm text-orange-600 text-center mt-2">
          You have unsaved changes
        </p>
      )}
    </div>
  );
}

function TeamNotificationSettings() {
  const [teamSettings, setTeamSettings] = useState<TeamMemberSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const { user } = useUser();

  const fetchTeam = useCallback(async () => {
    try {
      const response = await fetch('/api/crm/notification-settings/team');
      if (response.ok) {
        const data = await response.json();
        setTeamSettings(
          data.map((m: TeamMemberSettings) => ({
            ...m,
            phoneInput: formatPhoneForDisplay(m.phoneNumber),
            hasChanges: false,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching team settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const handleToggle = (userId: string, enabled: boolean) => {
    setTeamSettings((prev) =>
      prev.map((m) =>
        m.userId === userId
          ? { ...m, smsNewLead: enabled, hasChanges: true }
          : m
      )
    );
  };

  const handlePhoneChange = (userId: string, value: string) => {
    setTeamSettings((prev) =>
      prev.map((m) => {
        if (m.userId !== userId) return m;
        const newPhone = formatPhoneNumber(value, m.phoneInput || '');
        return { ...m, phoneInput: newPhone, hasChanges: true };
      })
    );
  };

  const handleSaveMember = async (userId: string) => {
    const member = teamSettings.find((m) => m.userId === userId);
    if (!member) return;

    setSavingUserId(userId);
    try {
      const res = await fetch('/api/crm/notification-settings/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          smsNewLead: member.smsNewLead,
          phoneNumber: member.phoneInput?.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }

      const data = await res.json();
      setTeamSettings((prev) =>
        prev.map((m) =>
          m.userId === userId
            ? {
                ...m,
                smsNewLead: data.smsNewLead,
                phoneNumber: data.phoneNumber,
                phoneInput: formatPhoneForDisplay(data.phoneNumber),
                lastUpdatedBy: data.lastUpdatedBy,
                hasChanges: false,
              }
            : m
        )
      );
      toast.success(`Settings saved for ${member.firstName || 'member'}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSavingUserId(null);
    }
  };

  const formatRole = (role: string) => {
    if (role === 'org:admin') return 'Admin';
    return 'Member';
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2 mb-6"></div>
          <div className="space-y-3">
            <div className="h-20 bg-slate-200 rounded"></div>
            <div className="h-20 bg-slate-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <UserCog size={20} className="text-slate-600" />
          <h2 className="text-xl font-semibold text-gray-900">
            Team Notification Settings
          </h2>
        </div>
        <p className="text-sm text-gray-500">
          Manage SMS notification settings for all team members
        </p>
      </div>

      <div className="space-y-3">
        {teamSettings.length === 0 ? (
          <div className="py-8 text-center text-gray-400">
            <Users size={32} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">No team members found</p>
          </div>
        ) : (
          teamSettings.map((member) => {
            const isSelf = member.userId === user?.id;
            const isSaving = savingUserId === member.userId;

            return (
              <div
                key={member.userId}
                className={cn(
                  'p-4 rounded-lg border transition-colors',
                  member.hasChanges
                    ? 'border-blue-300 bg-blue-50/30'
                    : 'border-slate-200 bg-slate-50'
                )}
              >
                {/* Top row: avatar, name, role, status */}
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={member.imageUrl} alt={member.firstName} />
                    <AvatarFallback className="text-xs">
                      {(member.firstName?.[0] || '') +
                        (member.lastName?.[0] || '')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {member.firstName} {member.lastName}
                        {isSelf && (
                          <span className="text-xs text-gray-400 ml-1">(you)</span>
                        )}
                      </p>
                      <Badge
                        variant={
                          member.role === 'org:admin' ? 'default' : 'secondary'
                        }
                        className="text-[10px] px-1.5 py-0"
                      >
                        {formatRole(member.role)}
                      </Badge>
                      <SmsStatusDot status={member.lastSmsStatus} />
                    </div>
                    {member.identifier && (
                      <p className="text-xs text-gray-500 truncate">
                        {member.identifier}
                      </p>
                    )}
                  </div>
                </div>

                {/* Controls row: toggle, phone, save */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      checked={member.smsNewLead}
                      onCheckedChange={(checked) =>
                        handleToggle(member.userId, checked)
                      }
                    />
                    <span className="text-xs text-gray-600">SMS</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="relative">
                      <Phone
                        size={14}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                      <input
                        type="tel"
                        value={member.phoneInput || ''}
                        onChange={(e) =>
                          handlePhoneChange(member.userId, e.target.value)
                        }
                        placeholder="(555) 123-4567"
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => handleSaveMember(member.userId)}
                    disabled={!member.hasChanges || isSaving}
                    className={cn(
                      'flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      member.hasChanges
                        ? 'bg-slate-900 hover:bg-slate-800 text-white'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    )}
                  >
                    {isSaving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
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

interface IWebsiteFormField {
  fieldId: string;
  label: string;
  enabled: boolean;
  required: boolean;
}

interface IWebsiteFormConfig {
  formTitle: string;
  formSubtitle: string;
  buttonText: string;
  buttonColor: string;
  successMessage: string;
  fields: IWebsiteFormField[];
  isActive: boolean;
}

const DEFAULT_FORM_FIELDS: IWebsiteFormField[] = [
  { fieldId: 'firstName', label: 'First Name', enabled: true, required: true },
  { fieldId: 'lastName', label: 'Last Name', enabled: true, required: true },
  { fieldId: 'phone', label: 'Phone Number', enabled: true, required: false },
  { fieldId: 'email', label: 'Email Address', enabled: true, required: false },
  { fieldId: 'moveDate', label: 'Preferred Move Date', enabled: true, required: false },
];

const DEFAULT_FORM_CONFIG: IWebsiteFormConfig = {
  formTitle: 'Get Your Free Estimate',
  formSubtitle: 'Fill out the form below',
  buttonText: 'Get Free Estimate',
  buttonColor: '#16a34a',
  successMessage: 'Thank you! We will be in touch shortly.',
  fields: DEFAULT_FORM_FIELDS,
  isActive: true,
};

function WebsiteFormsContent() {
  const { organization } = useOrganization();
  const orgId = organization?.id || '';

  const [formConfig, setFormConfig] = useState<IWebsiteFormConfig>(DEFAULT_FORM_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showEmbedDialog, setShowEmbedDialog] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings/crm');
      if (response.ok) {
        const data = await response.json();
        if (data.websiteFormConfig) {
          setFormConfig(data.websiteFormConfig);
        }
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteFormConfig: formConfig }),
      });
      if (!response.ok) {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (fieldId: string, key: 'enabled' | 'required', value: boolean) => {
    setFormConfig((prev) => ({
      ...prev,
      fields: prev.fields.map((f) =>
        f.fieldId === fieldId ? { ...f, [key]: value } : f
      ),
    }));
  };

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(type);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const jsSnippet = `<script src="${baseUrl}/embed-form.js" data-org-id="${orgId}"></script>`;
  const iframeSnippet = `<iframe src="${baseUrl}/form/${orgId}" width="100%" height="600" frameborder="0" style="border:none;"></iframe>`;

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

  // Preview: group firstName/lastName
  const previewFirstName = formConfig.fields.find((f) => f.fieldId === 'firstName');
  const previewLastName = formConfig.fields.find((f) => f.fieldId === 'lastName');
  const previewOtherFields = formConfig.fields.filter(
    (f) => f.fieldId !== 'firstName' && f.fieldId !== 'lastName' && f.enabled
  );

  return (
    <>
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Website Forms</h2>
              <p className="text-sm text-gray-500 mt-1">
                Create an embeddable lead capture form for your website
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEmbedDialog(true)}
                disabled={!orgId}
                className="flex items-center gap-1.5 text-sm bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium py-2 px-3 rounded-lg transition-colors disabled:opacity-50"
              >
                <Code size={16} />
                Get Embed Code
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Column - Settings */}
          <div className="flex-1 space-y-5">
            {/* Active toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <p className="text-sm font-medium text-gray-900">Form Active</p>
                <p className="text-xs text-gray-500">When disabled, the form will not be accessible</p>
              </div>
              <Switch
                checked={formConfig.isActive}
                onCheckedChange={(checked) =>
                  setFormConfig((prev) => ({ ...prev, isActive: checked }))
                }
              />
            </div>

            {/* Form Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Form Title</label>
              <input
                type="text"
                value={formConfig.formTitle}
                onChange={(e) =>
                  setFormConfig((prev) => ({ ...prev, formTitle: e.target.value }))
                }
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Get Your Free Estimate"
              />
            </div>

            {/* Form Subtitle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Form Subtitle</label>
              <input
                type="text"
                value={formConfig.formSubtitle}
                onChange={(e) =>
                  setFormConfig((prev) => ({ ...prev, formSubtitle: e.target.value }))
                }
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Fill out the form below"
              />
            </div>

            {/* Button Text */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Button Text</label>
              <input
                type="text"
                value={formConfig.buttonText}
                onChange={(e) =>
                  setFormConfig((prev) => ({ ...prev, buttonText: e.target.value }))
                }
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Get Free Estimate"
              />
            </div>

            {/* Button Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Button Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={formConfig.buttonColor}
                  onChange={(e) =>
                    setFormConfig((prev) => ({ ...prev, buttonColor: e.target.value }))
                  }
                  className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={formConfig.buttonColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                      setFormConfig((prev) => ({ ...prev, buttonColor: val }));
                    }
                  }}
                  className="w-28 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="#16a34a"
                />
              </div>
            </div>

            {/* Success Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Success Message</label>
              <input
                type="text"
                value={formConfig.successMessage}
                onChange={(e) =>
                  setFormConfig((prev) => ({ ...prev, successMessage: e.target.value }))
                }
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Thank you! We will be in touch shortly."
              />
            </div>

            {/* Fields Configuration */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Form Fields</label>
              <div className="space-y-2">
                {formConfig.fields.map((field) => {
                  const isNameField = field.fieldId === 'firstName' || field.fieldId === 'lastName';
                  return (
                    <div
                      key={field.fieldId}
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <span className="text-sm font-medium text-gray-900">{field.label}</span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                          <span>Required</span>
                          <Switch
                            checked={field.required}
                            onCheckedChange={(checked) =>
                              updateField(field.fieldId, 'required', checked)
                            }
                            disabled={isNameField}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                          <span>Enabled</span>
                          <Switch
                            checked={field.enabled}
                            onCheckedChange={(checked) =>
                              updateField(field.fieldId, 'enabled', checked)
                            }
                            disabled={isNameField}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-4">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>

          {/* Right Column - Live Preview */}
          <div className="flex-1">
            <div className="sticky top-24">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Live Preview</span>
              </div>
              <div className="border border-slate-200 rounded-xl bg-slate-100 p-6">
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 max-w-sm mx-auto">
                  <div className="text-center mb-5">
                    <h3 className="text-lg font-bold text-gray-900">
                      {formConfig.formTitle || 'Form Title'}
                    </h3>
                    {formConfig.formSubtitle && (
                      <p className="text-gray-500 text-sm mt-1">{formConfig.formSubtitle}</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Name fields row */}
                    {(previewFirstName?.enabled || previewLastName?.enabled) && (
                      <div className="grid grid-cols-2 gap-2">
                        {previewFirstName?.enabled && (
                          <div className="px-3 py-2.5 border border-gray-300 rounded-lg text-xs text-gray-400">
                            {previewFirstName.label}{previewFirstName.required ? ' *' : ''}
                          </div>
                        )}
                        {previewLastName?.enabled && (
                          <div className="px-3 py-2.5 border border-gray-300 rounded-lg text-xs text-gray-400">
                            {previewLastName.label}{previewLastName.required ? ' *' : ''}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Other fields */}
                    {previewOtherFields.map((field) => (
                      <div key={field.fieldId}>
                        {field.fieldId === 'moveDate' && (
                          <p className="text-xs font-medium text-gray-700 mb-1 text-center">
                            {field.label}{field.required ? ' *' : ''}
                          </p>
                        )}
                        <div className="px-3 py-2.5 border border-gray-300 rounded-lg text-xs text-gray-400">
                          {field.fieldId === 'moveDate'
                            ? 'mm/dd/yyyy'
                            : field.fieldId === 'phone'
                            ? `${field.label}${field.required ? ' *' : ''} (425) 555-1234`
                            : field.fieldId === 'email'
                            ? `${field.label}${field.required ? ' *' : ''} john@example.com`
                            : `${field.label}${field.required ? ' *' : ''}`}
                        </div>
                        {field.fieldId === 'moveDate' && (
                          <p className="text-[10px] text-gray-400 mt-1 text-center">
                            Select your preferred date. We&apos;ll work with you to find the best time.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Preview button */}
                  <button
                    style={{ backgroundColor: formConfig.buttonColor }}
                    className="w-full mt-4 text-white font-semibold py-2.5 px-4 rounded-lg text-sm cursor-default"
                  >
                    {formConfig.buttonText || 'Submit'}
                  </button>

                  <p className="text-[10px] text-gray-400 text-center mt-3">
                    * Required fields &bull; No obligation &bull; Response within 24 hours
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Embed Code Dialog */}
      <Dialog open={showEmbedDialog} onOpenChange={setShowEmbedDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Embed Your Form</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-gray-500 mb-4">
            Copy one of the snippets below and paste it into your website&apos;s HTML.
          </p>

          <Tabs defaultValue="javascript">
            <TabsList className="w-full">
              <TabsTrigger value="javascript" className="flex-1">JavaScript</TabsTrigger>
              <TabsTrigger value="iframe" className="flex-1">iframe</TabsTrigger>
            </TabsList>

            <TabsContent value="javascript" className="mt-4">
              <div className="relative">
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs overflow-x-auto font-mono whitespace-pre-wrap break-all">
                  {jsSnippet}
                </pre>
                <button
                  onClick={() => copyToClipboard(jsSnippet, 'js')}
                  className="absolute top-2 right-2 p-2 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                >
                  {copiedSnippet === 'js' ? (
                    <Check size={14} className="text-green-500" />
                  ) : (
                    <Copy size={14} className="text-gray-500" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Paste this where you want the form to appear. The form will auto-resize to fit.
              </p>
            </TabsContent>

            <TabsContent value="iframe" className="mt-4">
              <div className="relative">
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs overflow-x-auto font-mono whitespace-pre-wrap break-all">
                  {iframeSnippet}
                </pre>
                <button
                  onClick={() => copyToClipboard(iframeSnippet, 'iframe')}
                  className="absolute top-2 right-2 p-2 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                >
                  {copiedSnippet === 'iframe' ? (
                    <Check size={14} className="text-green-500" />
                  ) : (
                    <Copy size={14} className="text-gray-500" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Paste this directly into your page HTML. Adjust the height as needed.
              </p>
            </TabsContent>
          </Tabs>
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
