// app/call-complete/page.tsx
'use client';

import { CheckCircle, Home } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function CallCompletePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-md w-full">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-12 h-12 text-green-600" />
        </div>
        
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          Inventory Session Complete!
        </h1>
        
        <p className="text-gray-600 mb-6 leading-relaxed">
          Thank you for completing your moving inventory session. Your moving company now has a detailed list of your items and will be in touch with next steps.
        </p>
        
        <div className="space-y-3">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">
              <strong>What happens next?</strong><br />
              Your moving company will review the inventory and provide you with an accurate quote and moving plan.
            </p>
          </div>
          
          <button
            onClick={() => window.close()}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 px-6 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Home size={18} />
            Close Window
          </button>
        </div>
      </div>
    </div>
  );
}