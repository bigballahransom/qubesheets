'use client';

import { GitBranch } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';

export default function SequencesPage() {
  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden"></div>
        <div className="min-h-screen bg-slate-50 lg:pl-64 pt-4 lg:pt-20">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {/* Breadcrumb Header */}
            <div className="flex items-center gap-2 text-sm mb-6">
              <span className="text-gray-500">Automations</span>
              <span className="text-gray-400">/</span>
              <span className="font-medium text-gray-900">Sequences</span>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-12 text-center">
              <GitBranch className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Coming Soon</h3>
              <p className="text-gray-500">Automated sequences for customer follow-ups and communications are under development.</p>
            </div>
          </div>
        </div>
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}
