'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useOrganization } from '@clerk/nextjs';
import { ChevronDown, Settings, Bell, FileText, Palette, Plug, Key, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  crmOnly?: boolean;
}

const settingsItems: SettingsItem[] = [
  {
    title: 'CRM Settings',
    icon: Building2,
    href: '/settings/crm',
    crmOnly: true,
  },
  {
    title: 'Notifications',
    icon: Bell,
    href: '/settings/notifications',
  },
  {
    title: 'Templates',
    icon: FileText,
    href: '/settings/templates',
  },
  {
    title: 'Branding',
    icon: Palette,
    href: '/settings/branding',
  },
  {
    title: 'Integrations',
    icon: Plug,
    href: '/settings/integrations',
  },
  {
    title: 'API Keys',
    icon: Key,
    href: '/settings/api-keys',
  },
];

export function SettingsSection() {
  const { organization } = useOrganization();
  const hasCrmAddOn = (organization?.publicMetadata as any)?.subscription?.addOns?.includes('crm');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const settingsRef = useRef<HTMLDivElement>(null);

  // Detect mobile viewport
  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  // Close menu when clicking outside
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

  return (
    <div className="relative" ref={settingsRef}>
      {/* Settings Menu Items - Responsive positioning */}
      {isSettingsOpen && (
        <div className={cn(
          "absolute left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 space-y-1 z-50",
          isMobile 
            ? "bottom-full mb-2 max-h-[40vh] overflow-y-auto" // Mobile: above with scrolling
            : "bottom-full mb-1" // Desktop: just above
        )}>
          {settingsItems
            .filter(item => !item.crmOnly || hasCrmAddOn)
            .map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setIsSettingsOpen(false)} // Close menu on navigation
                className={cn(
                  'flex items-center gap-3 px-3 text-sm rounded-md transition-colors cursor-pointer',
                  'touch-manipulation', // Better touch response
                  isMobile ? 'py-3 min-h-[44px]' : 'py-2', // Larger touch targets on mobile
                  isActive
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{item.title}</span>
              </a>
            );
          })}
        </div>
      )}
      
      {/* Settings Header */}
      <button
        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        className={cn(
          "flex items-center justify-between w-full p-3 text-gray-700 transition-colors cursor-pointer",
          "hover:bg-gray-100 active:bg-gray-200", // Better touch feedback
          "touch-manipulation", // Improve touch responsiveness
          isMobile ? "min-h-[44px]" : "" // Minimum touch target size on mobile
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