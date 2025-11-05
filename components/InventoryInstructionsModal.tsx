'use client';

import { useState } from 'react';
import { X, Camera, Video, CheckCircle, Lightbulb, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogOverlay,
  DialogPortal,
} from '@/components/ui/dialog';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

interface InventoryInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Custom DialogContent with larger X button
function CustomDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-1rem)] translate-x-[-50%] translate-y-[-50%] gap-3 rounded-lg border p-4 shadow-lg duration-200 sm:max-w-lg sm:p-6 sm:gap-4",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-slate-100 transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none">
          <X className="w-5 h-5 text-slate-500 hover:text-slate-700" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export default function InventoryInstructionsModal({ isOpen, onClose }: InventoryInstructionsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <CustomDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader className="space-y-3 pb-3">
          <DialogTitle className="text-xl sm:text-2xl font-bold text-center text-slate-800">
            How to Take Your Inventory
          </DialogTitle>
          <DialogDescription className="text-center text-slate-600 text-base sm:text-lg">
            Help us ensure a wonderful moving experience by uploading the belongings moving with you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6">
          {/* Main Instructions */}
          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-start gap-3 p-3 sm:p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 mb-1 sm:mb-2 text-sm sm:text-base">Take and upload photos or videos of the items you're moving</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Capture clear images of everything that will be part of your move. The more we see, the better we can help you!
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 sm:p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <Video className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-900 mb-1 sm:mb-2 text-sm sm:text-base">For videos: Upload 1 short video per room</h3>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-md">
                    ⏱️ Max 1 minute
                  </span>
                  <span className="text-xs text-amber-700 font-medium">Extremely important!</span>
                </div>
                <p className="text-slate-600 leading-relaxed text-sm">
                  We can't accept videos longer than 1 minute in duration for quality processing.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 sm:p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 mb-1 sm:mb-2 text-sm sm:text-base">Try not to capture the same items twice</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  This helps us create an accurate inventory without duplicates. One good photo per room is perfect!
                </p>
              </div>
            </div>
          </div>

          {/* Pro Tips Section */}
          <div className="bg-white rounded-lg p-4 sm:p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-slate-800">Pro Tips for Great Photos</h3>
            </div>
            
            <div className="space-y-2 sm:space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-slate-700 leading-relaxed text-sm">
                  <span className="font-medium">Take clear, well-lit photos</span> - Natural light works best!
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-slate-700 leading-relaxed text-sm">
                  <span className="font-medium">Don't forget those closets, outdoor and hidden spaces</span> - We want to see everything!
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-slate-700 leading-relaxed text-sm">
                  <span className="font-medium">Open drawers and doors</span> to capture what's inside
                </p>
              </div>
            </div>
          </div>


          {/* Action Button */}
          <div className="flex justify-center pt-2 sm:pt-4">
            <Button
              onClick={onClose}
              className="px-6 sm:px-8 py-2.5 sm:py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg text-sm sm:text-base shadow-lg hover:shadow-xl transition-all duration-200"
            >
              Got it! Let's start uploading
            </Button>
          </div>
        </div>
      </CustomDialogContent>
    </Dialog>
  );
}