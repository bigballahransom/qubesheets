// app/updates/page.tsx — in-app "What's New" changelog.
// Update entries live in lib/updatesLog.ts (see the how-to comment there).
'use client';

import { Sparkles, Wrench } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';
import IntercomChat from '@/components/IntercomChat';
import { updates, type UpdateTag } from '@/lib/updatesLog';

const tagStyles: Record<UpdateTag, string> = {
  New: 'bg-green-100 text-green-800 border-green-200',
  Improved: 'bg-blue-100 text-blue-800 border-blue-200',
  Fixed: 'bg-amber-100 text-amber-800 border-amber-200',
};

export default function UpdatesPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <DesktopHeaderBar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
        {/* Hero */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <Sparkles className="w-5 h-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">
              Product Updates
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            What’s new in Qube Sheets
          </h1>
          <p className="text-gray-600 leading-relaxed">
            We ship improvements constantly so your surveys get faster, your
            inventories get more accurate, and your crews stay in the loop.
            Here’s what’s changed recently.
          </p>
        </div>

        {/* Timeline */}
        {updates.map((group) => (
          <section key={group.month} className="mb-10">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-xl font-bold text-gray-900">{group.month}</h2>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <div className="space-y-4">
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <div
                    key={entry.title}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 sm:p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900">
                            {entry.title}
                          </h3>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${tagStyles[entry.tag]}`}
                          >
                            {entry.tag}
                          </span>
                        </div>
                        <p className="text-gray-600 text-sm leading-relaxed">
                          {entry.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Footer note */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Wrench className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-blue-900">
              Have an idea or running into something?
            </h3>
          </div>
          <p className="text-sm text-blue-800">
            A lot of what you see above came straight from movers telling us
            what they needed. Reach out through the chat bubble — we read
            everything.
          </p>
        </div>
      </div>
      <IntercomChat />
    </SidebarProvider>
  );
}
