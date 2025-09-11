// components/video/VideoUpload.jsx - Simple video upload for Google Cloud Video Intelligence processing
'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  RotateCcw, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Bot,
  Clock,
  Video
} from 'lucide-react';
import { toast } from 'sonner';

export default function VideoUpload({ 
  projectId, 
  onAnalysisComplete, 
  uploadLinkId, 
  onReset,
  initialVideoFile = null,
  autoStart = false
}) {
  const [uploadState, setUploadState] = useState('idle'); // idle, uploading, processing, complete, failed
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [error, setError] = useState(null);
  const [videoResult, setVideoResult] = useState(null);
  
  const fileInputRef = useRef();
  const videoRef = useRef();
  const isUploading = useRef(false); // Prevent double submissions

  // Handle file selection and upload to server with Google Cloud Video Intelligence processing
  const handleFileSelect = useCallback(async (event) => {
    const file = event.target.files[0];
    console.log('🎬 File selected:', file?.name, file?.type, file?.size);
    
    if (!file) {
      console.log('🎬 No file selected');
      return;
    }
    
    // Prevent double submissions
    if (isUploading.current) {
      console.log('🎬 Upload already in progress, ignoring duplicate request');
      return;
    }
    
    if (!file.type.startsWith('video/')) {
      console.error('🎬 Invalid file type:', file.type);
      toast.error('Please select a valid video file');
      return;
    }
    
    // Check file size (limit to 500MB for Google Cloud Video Intelligence)
    const maxSize = parseInt(process.env.NEXT_PUBLIC_MAX_VIDEO_SIZE || '524288000'); // 500MB default
    if (file.size > maxSize) {
      console.error('🎬 File too large:', file.size);
      const sizeMB = Math.round(maxSize / (1024 * 1024));
      const errorMsg = `Video file too large. Please select a file under ${sizeMB}MB.`;
      toast.error(errorMsg);
      setError(errorMsg);
      return;
    }
    
    console.log('🎬 Starting video upload to S3 with Google Cloud Video Intelligence processing');
    isUploading.current = true; // Set upload guard
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setUploadState('uploading');
    setCurrentStage('Uploading video to cloud storage...');
    setError(null);
    
    try {
      // Upload video to server
      const formData = new FormData();
      formData.append('video', file);
      formData.append('projectId', projectId);
      
      if (uploadLinkId) {
        formData.append('uploadLinkId', uploadLinkId);
      }
      
      console.log('🎬 Uploading video to server...');
      setUploadProgress(20);
      
      const uploadUrl = uploadLinkId 
        ? `/api/customer-upload/${uploadLinkId}/upload`
        : `/api/projects/${projectId}/videos`;
      
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });
      
      setUploadProgress(60);
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Upload failed: ${errorText}`);
      }
      
      const uploadResult = await uploadResponse.json();
      console.log('🎬 Video uploaded successfully:', uploadResult);
      
      setUploadProgress(100);
      setCurrentStage('Video uploaded successfully! Google Cloud Video Intelligence is analyzing...');
      setVideoResult(uploadResult);
      setUploadState('processing');
      
      toast.success('Video uploaded successfully!', {
        description: 'Google Cloud Video Intelligence is analyzing your video. Detected items will appear in your inventory shortly.',
        duration: 6000,
      });
      
      // Call completion callback if provided
      if (onAnalysisComplete) {
        onAnalysisComplete({
          videoId: uploadResult.videoId,
          status: 'processing',
          message: 'Video is being analyzed by Google Cloud Video Intelligence'
        });
      }
      
    } catch (error) {
      console.error('🎬 Video upload error:', error);
      
      let errorMessage = error.message || 'Unknown error occurred';
      
      // Provide more user-friendly error messages
      if (errorMessage.includes('404')) {
        errorMessage = 'Video upload endpoint not found. Please check the project configuration.';
      } else if (errorMessage.includes('413') || errorMessage.includes('too large')) {
        errorMessage = 'Video file is too large. Please compress the video or use a smaller file.';
      } else if (errorMessage.includes('timeout')) {
        errorMessage = 'Upload timed out. Please check your internet connection and try again.';
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (errorMessage.includes('server') || errorMessage.includes('500')) {
        errorMessage = 'Server error. Please try again later or contact support.';
      }
      
      toast.error(`Video upload failed: ${errorMessage}`, {
        description: 'Please try again with a smaller video file or check your connection.',
        duration: 8000,
      });
      
      setUploadState('failed');
      setError(errorMessage);
      setUploadProgress(0);
      setCurrentStage('');
    } finally {
      isUploading.current = false; // Reset upload guard
    }
  }, [projectId, uploadLinkId, onAnalysisComplete]);

  // Handle auto-start with initial video file
  useEffect(() => {
    if (initialVideoFile && autoStart && uploadState === 'idle') {
      console.log('🎬 Auto-starting video upload with initial file:', initialVideoFile.name);
      
      // Create a synthetic event to trigger the upload
      const syntheticEvent = {
        target: {
          files: [initialVideoFile]
        }
      };
      
      handleFileSelect(syntheticEvent);
    }
  }, [initialVideoFile, autoStart, uploadState, handleFileSelect]);

  // Handle video metadata loaded
  const handleVideoLoaded = useCallback(() => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration);
    }
  }, []);

  const resetUpload = useCallback(() => {
    isUploading.current = false; // Reset upload guard
    setUploadState('idle');
    setVideoFile(null);
    setVideoUrl('');
    setVideoResult(null);
    setUploadProgress(0);
    setCurrentStage('');
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Call parent reset if provided
    if (onReset) {
      onReset();
    }
  }, [onReset]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Bot className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Video Analysis</h2>
        <p className="text-gray-600">Upload a video to automatically analyze inventory items with Google Cloud Video Intelligence</p>
      </div>

      {/* Upload Area */}
      {uploadState === 'idle' && !autoStart && (
        <div
          className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-xl font-medium text-gray-900 mb-2">Drop your video here</p>
          <p className="text-gray-500 mb-4">or click to browse</p>
          <p className="text-sm text-gray-400">Supports MP4, MOV, MPEG, MPG, AVI, WMV, FLV, WebM, 3GPP, M4V (max 500MB)</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.mpeg,.mpg,.avi,.wmv,.flv,.webm,.3gpp,.m4v,video/mp4,video/quicktime,video/mpeg,video/x-ms-wmv,video/x-flv,video/webm,video/3gpp"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Upload Progress */}
      {uploadState === 'uploading' && (
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            <div>
              <h3 className="font-medium text-gray-900">Uploading video...</h3>
              <p className="text-sm text-gray-500">{videoFile?.name}</p>
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-blue-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">{uploadProgress}% complete</p>
          {currentStage && <p className="text-sm text-gray-600 mt-1">{currentStage}</p>}
        </div>
      )}

      {/* Video Preview & Processing Status */}
      {(uploadState === 'processing' || uploadState === 'complete') && videoUrl && (
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Video Uploaded</h3>
            <button
              onClick={resetUpload}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Video Preview */}
          <div className="relative mb-6">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onLoadedMetadata={handleVideoLoaded}
              className="w-full max-h-96 rounded-lg"
            />
          </div>

          {/* Video Info */}
          {videoDuration > 0 && (
            <div className="flex items-center gap-6 mb-6 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>Duration: {Math.round(videoDuration)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4" />
                <span>Size: {(videoFile?.size / (1024 * 1024)).toFixed(1)}MB</span>
              </div>
            </div>
          )}

          {/* Processing Status */}
          {uploadState === 'processing' && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                <span className="text-gray-700">Google Cloud Video Intelligence is analyzing your video...</span>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-purple-800 text-sm mb-2">
                  🧠 The AI is analyzing your video to detect inventory items, furniture, and objects.
                </p>
                <p className="text-purple-600 text-xs">
                  Detected items will automatically appear in your inventory list. You can close this dialog safely.
                </p>
              </div>
            </div>
          )}

          {uploadState === 'complete' && (
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-gray-700">Video processing complete! Detected items have been added to your inventory.</span>
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {uploadState === 'failed' && error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-800 font-medium">Upload Failed</span>
          </div>
          <p className="text-red-700 text-sm mb-4">{error}</p>
          <button
            onClick={resetUpload}
            className="px-4 py-2 bg-red-100 text-red-800 rounded-lg hover:bg-red-200 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}