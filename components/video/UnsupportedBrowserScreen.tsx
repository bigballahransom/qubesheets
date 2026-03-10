'use client';

import React from 'react';
import { AlertTriangle, Smartphone, Globe, ArrowLeft } from 'lucide-react';
import type { DeviceInfo } from '@/lib/webrtc-compatibility';

interface UnsupportedBrowserScreenProps {
  reason?: string;
  deviceInfo?: DeviceInfo | null;
  showAlternatives?: boolean;
  onBack?: () => void;
}

export function UnsupportedBrowserScreen({
  reason,
  deviceInfo,
  showAlternatives = true,
  onBack,
}: UnsupportedBrowserScreenProps) {
  const isOldAndroid =
    deviceInfo?.isAndroid &&
    deviceInfo.androidVersion !== null &&
    deviceInfo.androidVersion < 7;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 max-w-md w-full text-center">
        {/* Icon */}
        <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-10 h-10 text-yellow-400" />
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white mb-3">Browser Not Supported</h2>

        {/* Main message */}
        <p className="text-white/80 mb-6 leading-relaxed">
          {reason || 'Your browser does not support video calls.'}
        </p>

        {/* Old Android warning */}
        {isOldAndroid && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-left">
            <p className="text-yellow-300/90 text-sm">
              <strong>Android {deviceInfo?.androidVersion} detected.</strong> This version has
              limited video call support. For the best experience, please use a device with
              Android 7 or newer, or try updating your browser.
            </p>
          </div>
        )}

        {/* Supported browsers list */}
        {showAlternatives && (
          <div className="space-y-4 text-left mb-6">
            <p className="text-white/60 text-sm text-center">
              Please try one of these browsers:
            </p>
            <ul className="text-white/80 text-sm space-y-3">
              <li className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center">
                  <Globe className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <span className="font-medium">Google Chrome</span>
                  <span className="text-white/50 ml-2">version 60+</span>
                </div>
              </li>
              <li className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                <div className="w-8 h-8 bg-orange-500/20 rounded-full flex items-center justify-center">
                  <Globe className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <span className="font-medium">Firefox</span>
                  <span className="text-white/50 ml-2">version 55+</span>
                </div>
              </li>
              <li className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center">
                  <Globe className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <span className="font-medium">Safari</span>
                  <span className="text-white/50 ml-2">version 11+</span>
                </div>
              </li>
              <li className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                <div className="w-8 h-8 bg-cyan-500/20 rounded-full flex items-center justify-center">
                  <Globe className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <span className="font-medium">Microsoft Edge</span>
                  <span className="text-white/50 ml-2">version 79+</span>
                </div>
              </li>
            </ul>
          </div>
        )}

        {/* Device info for debugging */}
        {deviceInfo && (
          <div className="text-xs text-white/30 mb-4">
            {deviceInfo.browserName}
            {deviceInfo.browserVersion ? ` ${deviceInfo.browserVersion}` : ''} |{' '}
            {deviceInfo.isAndroid
              ? `Android ${deviceInfo.androidVersion || 'Unknown'}`
              : deviceInfo.isIOS
                ? 'iOS'
                : 'Desktop'}
          </div>
        )}

        {/* Back button */}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center gap-2 w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        )}

        {/* Help text */}
        <div className="mt-6 pt-6 border-t border-white/10">
          <p className="text-white/50 text-xs">
            Need help? Contact your moving company for assistance.
          </p>
        </div>
      </div>
    </div>
  );
}

export default UnsupportedBrowserScreen;
