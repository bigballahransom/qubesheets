'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useOrganization } from '@clerk/nextjs';
import {
  ChevronDown,
  Settings,
  Bell,
  FileText,
  Palette,
  Plug,
  Key,
  Building2,
  Scale,
  CalendarDays,
  Link2,
  Package,
  Boxes,
  Camera,
  Tags,
  ClipboardCheck,
  Inbox,
  Archive,
  Bot,
  Webhook,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import LeadFormsUpgradeModal from '@/components/LeadFormsUpgradeModal';
import SafeIcon from '@/components/icons/SafeIcon';

interface SettingsItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  crmOnly?: boolean;
}

interface SettingsGroup {
  label: string;
  items: SettingsItem[];
}

const settingsGroups: SettingsGroup[] = [
  {
    label: 'Configuration',
    items: [
      { title: 'Notifications', icon: Bell, href: '/settings/notifications' },
      { title: 'CRM Settings', icon: Building2, href: '/settings/crm', crmOnly: true },
      { title: 'Templates', icon: FileText, href: '/settings/templates' },
      { title: 'Branding', icon: Palette, href: '/settings/branding' },
      { title: 'Global Self-Survey Link', icon: Link2, href: '/settings/global-upload-link' },
      { title: 'Media Vault Crew Link', icon: SafeIcon, href: '/settings/vault-link' },
      { title: 'PDFs and Links', icon: ClipboardCheck, href: '/settings/customer-review-link' },
      { title: 'Lead Funnel', icon: Inbox, href: '/settings/lead-forms' },
      { title: 'Photo Capture', icon: Camera, href: '/settings/photos' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { title: 'Weight Configuration', icon: Scale, href: '/settings/weight-configuration' },
      { title: 'Box Recommendations', icon: Package, href: '/settings/box-recommendations' },
      { title: 'Box Types', icon: Boxes, href: '/settings/box-types' },
      { title: 'Smart Tags', icon: Tags, href: '/settings/smart-tags' },
      { title: 'Inventory Stock', icon: Archive, href: '/settings/inventory-stock' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { title: 'Link Calendar', icon: CalendarDays, href: '/settings/calendar' },
      { title: 'Integrations', icon: Plug, href: '/settings/integrations' },
      { title: 'API Keys', icon: Key, href: '/settings/api-keys' },
      { title: 'Webhooks', icon: Webhook, href: '/settings/webhooks' },
      { title: 'AI Connectors', icon: Bot, href: '/settings/ai-connectors' },
    ],
  },
];

export function SettingsSection() {
  const { organization } = useOrganization();
  const addOns: string[] =
    (organization?.publicMetadata as { subscription?: { addOns?: string[] } } | undefined)
      ?.subscription?.addOns ?? [];
  const hasCrmAddOn = addOns.includes('crm');
  const hasLeadFormAddOn = addOns.includes('leadForm');
  const pathname = usePathname();
  // While the user is on a settings page the menu starts (and stays) open so
  // they can hop between settings tabs; elsewhere it behaves as a dropdown.
  const isOnSettingsPage = !!pathname?.startsWith('/settings');
  const [isSettingsOpen, setIsSettingsOpen] = useState(isOnSettingsPage);
  const [isMobile, setIsMobile] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  // Sections are collapsed by default; only the section holding the current
  // page starts expanded.
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const activeGroup = settingsGroups.find((group) =>
      group.items.some((item) => item.href === pathname)
    );
    return activeGroup ? { [activeGroup.label]: true } : {};
  });
  const settingsRef = useRef<HTMLDivElement>(null);

  // Covers client-side navigation (the lazy initializers above only run on
  // mount): landing on a settings page opens the menu and expands its section.
  useEffect(() => {
    if (!isOnSettingsPage) return;
    setIsSettingsOpen(true);
    const activeGroup = settingsGroups.find((group) =>
      group.items.some((item) => item.href === pathname)
    );
    if (activeGroup) {
      setExpandedSections((prev) => ({ ...prev, [activeGroup.label]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const openSettingsMenu = () => {
    const activeGroup = settingsGroups.find((group) =>
      group.items.some((item) => item.href === pathname)
    );
    setExpandedSections(activeGroup ? { [activeGroup.label]: true } : {});
    setIsSettingsOpen(true);
  };

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false);
      }
    };

    // On settings pages the menu is persistent navigation — interacting with
    // the page content shouldn't dismiss it (the Settings button still can).
    if (isSettingsOpen && !isOnSettingsPage) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSettingsOpen, isOnSettingsPage]);

  const filteredGroups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.crmOnly || hasCrmAddOn),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="relative" ref={settingsRef}>
      {isSettingsOpen && (
        <div
          className={cn(
            'absolute left-0 right-0 bottom-full bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50 overflow-y-auto overscroll-contain',
            isMobile ? 'mb-2 max-h-[40vh]' : 'mb-1 max-h-[70vh]'
          )}
        >
          {filteredGroups.map((group) => {
            const isExpanded = !!expandedSections[group.label];
            const hasActiveItem = group.items.some((item) => item.href === pathname);
            return (
              <div key={group.label}>
                <button
                  type="button"
                  onClick={() => toggleSection(group.label)}
                  aria-expanded={isExpanded}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-3 rounded-md transition-colors cursor-pointer',
                    'text-[10px] font-semibold uppercase tracking-wider touch-manipulation',
                    'text-gray-400 hover:text-gray-600 hover:bg-gray-50',
                    isMobile ? 'py-3 min-h-[44px]' : 'py-2'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {group.label}
                    {/* Dot marks the collapsed section holding the current page */}
                    {!isExpanded && hasActiveItem && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-3.5 h-3.5 transition-transform duration-200',
                      isExpanded ? 'rotate-0' : '-rotate-90'
                    )}
                  />
                </button>
                {isExpanded &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;
                    const isLeadFormsLocked =
                      item.href === '/settings/lead-forms' && !hasLeadFormAddOn;
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={(e) => {
                          // The menu stays open — on settings pages it acts as
                          // persistent navigation between tabs.
                          if (isLeadFormsLocked) {
                            e.preventDefault();
                            setUpgradeModalOpen(true);
                          }
                        }}
                        className={cn(
                          'flex items-center gap-3 px-3 text-sm rounded-md transition-colors cursor-pointer',
                          'touch-manipulation',
                          isMobile ? 'py-3 min-h-[44px]' : 'py-2',
                          isActive
                            ? 'bg-gray-100 text-gray-900 font-medium'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100'
                        )}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate flex-1">{item.title}</span>
                        {isLeadFormsLocked && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 flex-shrink-0">
                            Upgrade
                          </span>
                        )}
                      </a>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => (isSettingsOpen ? setIsSettingsOpen(false) : openSettingsMenu())}
        className={cn(
          'flex items-center justify-between w-full p-3 text-gray-700 transition-colors cursor-pointer',
          'hover:bg-gray-100 active:bg-gray-200',
          'touch-manipulation',
          isMobile ? 'min-h-[44px]' : ''
        )}
        aria-expanded={isSettingsOpen}
        aria-haspopup="true"
        aria-label="Toggle settings menu"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">Settings</span>
        </div>
        <ChevronDown
          className={cn(
            'w-4 h-4 transition-transform duration-200 flex-shrink-0',
            isSettingsOpen ? 'rotate-0' : 'rotate-180'
          )}
        />
      </button>

      <LeadFormsUpgradeModal
        open={upgradeModalOpen}
        onOpenChange={setUpgradeModalOpen}
      />
    </div>
  );
}

export default SettingsSection;
