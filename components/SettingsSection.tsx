'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, Settings, Bell, FileText, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

const settingsItems: SettingsItem[] = [
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
];

export function SettingsSection() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="relative">
      {/* Settings Menu Items - Positioned above the header */}
      {isSettingsOpen && (
        <div className="absolute bottom-full left-0 right-0 bg-white border-t border-b p-2 space-y-1">
          {settingsItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors cursor-pointer',
                  isActive 
                    ? 'bg-gray-100 text-gray-900 font-medium' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon className="w-4 h-4" />
                {item.title}
              </a>
            );
          })}
        </div>
      )}
      
      {/* Settings Header */}
      <button
        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        className="flex items-center justify-between w-full p-3 hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4" />
          <span className="text-sm font-medium">Settings</span>
        </div>
        <ChevronDown
          className={cn(
            'w-4 h-4 transition-transform duration-200',
            isSettingsOpen ? 'rotate-0' : 'rotate-180'
          )}
        />
      </button>
    </div>
  );
}

export default SettingsSection;