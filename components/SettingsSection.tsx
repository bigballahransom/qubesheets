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
  Code
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  crmOnly?: boolean;
  /** Set on the first item of a section. Rendered as a small uppercase
   *  label above this item, which also visually breaks the list. */
  sectionLabel?: string;
}

const settingsItems: SettingsItem[] = [
  // Configuration
  { title: 'Notifications', icon: Bell, href: '/settings/notifications', sectionLabel: 'Configuration' },
  { title: 'CRM Settings', icon: Building2, href: '/settings/crm', crmOnly: true },
  { title: 'Templates', icon: FileText, href: '/settings/templates' },
  { title: 'Branding', icon: Palette, href: '/settings/branding' },
  { title: 'Global Self-Survey Link', icon: Link2, href: '/settings/global-upload-link' },
  { title: 'Customer Review Link', icon: ClipboardCheck, href: '/settings/customer-review-link' },
  { title: 'Embeddable Form', icon: Code, href: '/settings/embeddable-lead-forms' },
  { title: 'Photo Capture', icon: Camera, href: '/settings/photos' },

  // Inventory
  { title: 'Weight Configuration', icon: Scale, href: '/settings/weight-configuration', sectionLabel: 'Inventory' },
  { title: 'Box Recommendations', icon: Package, href: '/settings/box-recommendations' },
  { title: 'Box Types', icon: Boxes, href: '/settings/box-types' },
  { title: 'Smart Tags', icon: Tags, href: '/settings/smart-tags' },

  // Integrations
  { title: 'Link Calendar', icon: CalendarDays, href: '/settings/calendar', sectionLabel: 'Integrations' },
  { title: 'Integrations', icon: Plug, href: '/settings/integrations' },
  { title: 'API Keys', icon: Key, href: '/settings/api-keys' }
];

export function SettingsSection() {
  const { organization } = useOrganization();
  const hasCrmAddOn = (organization?.publicMetadata as any)?.subscription?.addOns?.includes('crm');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const settingsRef = useRef<HTMLDivElement>(null);

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

    if (isSettingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSettingsOpen]);

  const filteredItems = settingsItems.filter((item) => !item.crmOnly || hasCrmAddOn);

  return (
    <div className="relative" ref={settingsRef}>
      {isSettingsOpen && (
        <div
          className={cn(
            'absolute left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50',
            isMobile ? 'bottom-full mb-2 max-h-[40vh] overflow-y-auto' : 'bottom-full mb-1'
          )}
        >
          {filteredItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <div key={item.href}>
                {item.sectionLabel && (
                  <div
                    className={cn(
                      'px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider',
                      index === 0 ? 'pt-1 pb-1.5' : 'mt-2 pt-2 pb-1.5'
                    )}
                  >
                    {item.sectionLabel}
                  </div>
                )}
                <a
                  href={item.href}
                  onClick={() => setIsSettingsOpen(false)}
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
                  <span className="truncate">{item.title}</span>
                </a>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
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
    </div>
  );
}

export default SettingsSection;
