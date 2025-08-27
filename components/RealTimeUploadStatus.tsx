// components/RealTimeUploadStatus.tsx
'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';

interface UploadStatus {
  fileName: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  startTime?: Date;
}

interface RealTimeUploadStatusProps {
  uploads: Record<string, UploadStatus>;
  className?: string;
}

export default function RealTimeUploadStatus({ uploads, className = '' }: RealTimeUploadStatusProps) {
  const [animatedUploads, setAnimatedUploads] = useState<Record<string, UploadStatus>>({});

  useEffect(() => {
    // Animate new uploads with stagger effect
    Object.entries(uploads).forEach(([fileName, status], index) => {
      setTimeout(() => {
        setAnimatedUploads(prev => ({
          ...prev,
          [fileName]: status
        }));
      }, index * 100); // Stagger animations by 100ms
    });

    // Clean up completed uploads after 5 seconds
    const timeouts: NodeJS.Timeout[] = [];
    Object.entries(uploads).forEach(([fileName, status]) => {
      if (status.status === 'completed' || status.status === 'failed') {
        const timeout = setTimeout(() => {
          setAnimatedUploads(prev => {
            const newUploads = { ...prev };
            delete newUploads[fileName];
            return newUploads;
          });
        }, 5000);
        timeouts.push(timeout);
      }
    });

    return () => {
      timeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, [uploads]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'processing':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = (status: UploadStatus) => {
    const elapsed = status.startTime ? Date.now() - status.startTime.getTime() : 0;
    const seconds = Math.floor(elapsed / 1000);
    
    switch (status.status) {
      case 'uploading':
        return `Uploading... ${seconds}s`;
      case 'processing':
        return `Analyzing with AI... ${seconds}s`;
      case 'completed':
        return 'Complete!';
      case 'failed':
        return status.error || 'Failed';
      default:
        return 'Pending...';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'uploading':
        return 'border-blue-200 bg-blue-50';
      case 'processing':
        return 'border-yellow-200 bg-yellow-50';
      case 'completed':
        return 'border-green-200 bg-green-50';
      case 'failed':
        return 'border-red-200 bg-red-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const uploadList = Object.entries(animatedUploads);
  
  if (uploadList.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-sm font-medium text-gray-700">Upload Status</h4>
      <div className="space-y-1">
        {uploadList.map(([fileName, status], index) => (
          <div
            key={fileName}
            className={`
              flex items-center gap-3 p-3 rounded-lg border transition-all duration-300 ease-out
              ${getStatusColor(status.status)}
              ${index === uploadList.length - 1 ? 'transform scale-105' : ''}
            `}
            style={{
              animation: `slideIn 0.3s ease-out ${index * 0.1}s both`
            }}
          >
            {getStatusIcon(status.status)}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {fileName}
              </p>
              <p className="text-xs text-gray-600">
                {getStatusText(status)}
              </p>
            </div>
            {status.status === 'uploading' && status.progress && (
              <div className="w-16">
                <div className="bg-gray-200 rounded-full h-1.5">
                  <div 
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${status.progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      
      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}