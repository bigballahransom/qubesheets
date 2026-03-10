'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Package,
  FileText,
  CheckCircle,
  Zap,
  Video,
  Camera,
  MessageSquare,
  Bell,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureAnnouncement } from '@/lib/featureAnnouncements';

// Map of icon names to Lucide components
const iconMap: Record<string, LucideIcon> = {
  Sparkles,
  Package,
  FileText,
  CheckCircle,
  Zap,
  Video,
  Camera,
  MessageSquare,
  Bell,
  Settings,
  Users,
};

interface NewFeaturesModalProps {
  open: boolean;
  onDismiss: () => void;
  announcement: FeatureAnnouncement;
}

export function NewFeaturesModal({ open, onDismiss, announcement }: NewFeaturesModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="sm:max-w-md md:max-w-lg overflow-hidden p-0">
        {/* Gradient Header - Brand Colors */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-8 text-white">
          <DialogHeader className="text-center sm:text-center">
            <DialogTitle className="text-2xl font-bold text-white">
              {announcement.title}
            </DialogTitle>
            {announcement.subtitle && (
              <DialogDescription className="text-white/80 mt-2">
                {announcement.subtitle}
              </DialogDescription>
            )}
          </DialogHeader>
        </div>

        {/* Feature Sections */}
        <div className="px-6 py-6 space-y-6 max-h-[50vh] overflow-y-auto">
          {announcement.sections.map((section, sectionIndex) => {
            const SectionIcon = iconMap[section.sectionIcon] || Sparkles;
            return (
              <div key={sectionIndex} className="space-y-3">
                {/* Section Header */}
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                  <SectionIcon className="w-5 h-5 text-blue-500" />
                  <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                    {section.sectionTitle}
                  </h2>
                </div>

                {/* Section Features */}
                <div className="space-y-3">
                  {section.features.map((feature, featureIndex) => {
                    const IconComponent = iconMap[feature.icon] || Sparkles;
                    return (
                      <div
                        key={featureIndex}
                        className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
                      >
                        <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
                          <IconComponent className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                            {feature.title}
                          </h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-700">
          <Button
            onClick={onDismiss}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 transition-colors"
          >
            Got it!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewFeaturesModal;
