// pages/video-upload/[linkId].js - Customer video upload page (separate from photo upload)
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { 
  Video, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  FileVideo,
  Zap,
  Camera,
  PlayCircle,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import Logo from '../../components/Logo';
import VideoUpload from '../../components/video/VideoUpload';

export default function CustomerVideoUpload() {
  const router = useRouter();
  const { linkId } = router.query;
  
  const [linkData, setLinkData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [analysisResults, setAnalysisResults] = useState(null);

  // Validate upload link on page load
  useEffect(() => {
    if (!linkId) return;
    
    validateUploadLink();
  }, [linkId]);

  const validateUploadLink = async () => {
    try {
      setLoading(true);
      
      const response = await fetch(`/api/video/validate-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId })
      });
      
      const result = await response.json();
      
      if (result.valid) {
        setLinkData(result);
      } else {
        setError(result.error || 'Invalid upload link');
      }
    } catch (err) {
      setError('Failed to validate upload link');
      console.error('Link validation error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalysisComplete = (results) => {
    setAnalysisResults(results);
    setUploadComplete(true);
    toast.success('Video analysis completed successfully!');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Validating upload link...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Upload Link Invalid</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <p className="text-sm text-gray-500">Please contact your moving specialist for a new upload link.</p>
        </div>
      </div>
    );
  }

  if (uploadComplete) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <Logo />
            <div className="text-right">
              <h1 className="text-lg font-semibold text-gray-900">Video Upload Complete</h1>
              <p className="text-sm text-gray-500">{linkData.projectTitle}</p>
            </div>
          </div>
        </div>

        {/* Success Content */}
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-2xl p-8 text-center shadow-lg">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Upload Successful!</h2>
            <p className="text-gray-600 mb-6">
              Your video has been processed and analyzed. The inventory items have been automatically detected and added to your project.
            </p>
            
            {analysisResults && (
              <div className="bg-gray-50 rounded-xl p-6 mb-6">
                <h3 className="font-semibold text-gray-900 mb-4">Analysis Results</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{analysisResults.length}</div>
                    <div className="text-gray-600">Frames Analyzed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {analysisResults.filter(r => r.analysisResult?.itemsCount > 0).length}
                    </div>
                    <div className="text-gray-600">Frames with Items</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {analysisResults.reduce((total, r) => total + (r.analysisResult?.itemsCount || 0), 0)}
                    </div>
                    <div className="text-gray-600">Total Items Found</div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
                <p><strong>Next Steps:</strong></p>
                <p>Your moving specialist will review the analyzed inventory and contact you with any questions.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Logo />
          <div className="text-right">
            <h1 className="text-lg font-semibold text-gray-900">Video Upload</h1>
            <p className="text-sm text-gray-500">{linkData.projectTitle}</p>
          </div>
        </div>
      </div>

      {/* Upload Instructions */}
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl p-6 mb-6 shadow-lg">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Video className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Upload Your Inventory Video</h2>
              <p className="text-gray-600 mb-4">
                Upload a video of your home and our AI will automatically identify and catalog your inventory items.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <PlayCircle className="w-4 h-4 text-green-500" />
                  <span>Walk through each room slowly</span>
                </div>
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-green-500" />
                  <span>Keep items clearly in view</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-green-500" />
                  <span>Good lighting helps accuracy</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileVideo className="w-4 h-4 text-green-500" />
                  <span>MP4, MOV, AVI formats (max 100MB)</span>
                </div>
              </div>

              {linkData.remainingUploads && (
                <div className="mt-4 text-sm text-gray-500">
                  <Clock className="w-4 h-4 inline mr-1" />
                  {linkData.remainingUploads} uploads remaining • 
                  Expires {new Date(linkData.expiresAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Video Upload Component */}
        <VideoUpload 
          projectId={linkData.projectId}
          onAnalysisComplete={handleAnalysisComplete}
          uploadLinkId={linkId}
        />
      </div>
    </div>
  );
}