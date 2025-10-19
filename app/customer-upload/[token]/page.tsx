// app/customer-upload/[token]/page.tsx - Modern mobile-responsive design
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle, Loader2, ImageIcon, Clock, Building2, User, Upload as UploadIcon, ArrowRight } from 'lucide-react';
import CustomerPhotoUploader from '@/components/CustomerPhotoUploader';
// RailwayTransferOverlay removed - using simple S3 upload with SQS
import { toast } from 'sonner';
import Logo from '../../../public/logo';

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

interface UploadValidation {
  customerName: string;
  projectName: string;
  projectId?: string;
  expiresAt: string;
  isValid: boolean;
  branding?: BrandingData | null;
  instructions?: string | null;
}

interface UploadedImage {
  id: string;
  name: string;
  uploadedAt: string;
}

export default function CustomerUploadPage() {
  const params = useParams();
  const token = params?.token as string;
  
  const [validation, setValidation] = useState<UploadValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [totalUploadedFiles, setTotalUploadedFiles] = useState(0);
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([]);
  const [showProcessingStatus, setShowProcessingStatus] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Transfer overlay state removed - using simple S3 upload with SQS

  // Parse instructions for display (simple markdown-like parsing)
  const parseInstructionsForDisplay = (text: string, companyName: string) => {
    const processedText = text.replace('{companyName}', companyName);
    const lines = processedText.split('\n');
    
    return lines.map((line, index) => {
      if (line.trim() === '') {
        return <div key={index} className="h-2" />;
      }
      
      // Handle headers (lines without bullet points that aren't empty)
      if (line.trim() && !line.trim().startsWith('•') && !line.trim().startsWith('-')) {
        return (
          <h3 key={index} className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            {line.trim()}
          </h3>
        );
      }
      
      // Handle bullet points
      if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
        return (
          <div key={index} className="flex items-start gap-3 mb-3">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-slate-700 leading-relaxed">
              {line.trim().substring(1).trim()}
            </p>
          </div>
        );
      }
      
      // Regular text
      return (
        <p key={index} className="text-slate-700 leading-relaxed mb-3">
          {line.trim()}
        </p>
      );
    });
  };

  // Skip validation but fetch branding data for display
  useEffect(() => {
    const fetchBrandingData = async () => {
      try {
        // Try to fetch branding data from validation endpoint
        const response = await fetch(`/api/customer-upload/${token}/validate`);
        
        if (response.ok) {
          const data = await response.json();
          // Use real data if available, otherwise fallback to defaults
          setValidation({
            customerName: data.customerName || 'Customer',
            projectName: data.projectName || 'Photo Upload',
            projectId: data.projectId,
            expiresAt: data.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            isValid: true,
            branding: data.branding,
            instructions: data.instructions
          });
          
          // Set project ID for SSE connection
          if (data.projectId) {
            setProjectId(data.projectId);
          }
        } else {
          // Fallback to defaults if validation fails
          setValidation({
            customerName: 'Customer',
            projectName: 'Photo Upload',
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            isValid: true,
            branding: null,
            instructions: null
          });
        }
      } catch (error) {
        console.log('Could not fetch branding data, using defaults:', error);
        // Always allow upload with defaults
        setValidation({
          customerName: 'Customer',
          projectName: 'Photo Upload',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          isValid: true,
          branding: null,
          instructions: null
        });
      } finally {
        setLoading(false);
      }
    };

    fetchBrandingData();
  }, [token]);

  // Listen for processing completion
  useEffect(() => {
    if (pendingJobIds.length === 0) {
      setShowProcessingStatus(false);
      return;
    }

    // Only set up SSE if we have a project ID
    if (!projectId) {
      console.log('⏳ Waiting for project ID before setting up SSE connection...');
      return;
    }

    // Set up Server-Sent Events to listen for processing completion
    const eventSource = new EventSource(`/api/processing-complete?projectId=${projectId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle connection established message
        if (data.type === 'connection-established') {
          console.log('✅ SSE connection established:', data.connectionId);
          return;
        }
        
        // Check if this completion event is for one of our pending jobs
        if (data.type === 'processing-complete' && data.success) {
          console.log('🎉 AI analysis completed for image:', data.imageId);
          
          // Remove completed job from pending list (note: Railway webhook doesn't include sqsMessageId)
          setPendingJobIds(prev => {
            // Since we can't match by sqsMessageId, remove one job when any job completes
            const updated = prev.slice(1);
            if (updated.length === 0) {
              setShowProcessingStatus(false);
            }
            return updated;
          });
          
          // Show completion message
          toast.success(`AI analysis complete! Found ${data.itemsProcessed || 0} items in your photos.`, {
            duration: 5000,
          });
        }
      } catch (error) {
        console.error('Error processing SSE message:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      eventSource.close();
    };
    
    // Clean up on unmount or when dependencies change
    return () => {
      eventSource.close();
    };
  }, [pendingJobIds, projectId]);

  /*
  // COMMENTED OUT - Process video client-side (extract frames and upload)
  const processVideoClientSide = async (videoFile: File, videoInfo: any) => {
    setProcessingVideo(true);
    
    // Show transfer overlay immediately for video processing
    setTotalFilesToProcess(1);
    setProcessedFiles(0);
    setShowTransferOverlay(true);
    
    try {
      console.log('🎬 Starting client-side video processing:', videoFile.name);
      
      toast.info('Processing video frames...', {
        description: 'Extracting and analyzing frames from your video.',
        duration: 3000,
      });
      
      // Create video element for frame extraction
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous'; // Allow cross-origin video processing
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not create canvas context');
      }
      
      // Load video
      const videoUrl = URL.createObjectURL(videoFile);
      video.src = videoUrl;
      
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve(void 0);
        video.onerror = () => reject(new Error('Failed to load video'));
      });
      
      const duration = video.duration;
      const frameRate = 1; // 1 frame per second
      const frames: any[] = [];
      
      // Extract frames
      for (let time = 0; time < duration; time += 1 / frameRate) {
        video.currentTime = time;
        await new Promise(resolve => {
          video.onseeked = resolve;
        });
        
        // Set canvas size to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        try {
          // Draw frame to canvas
          ctx.drawImage(video, 0, 0);
          
          // Convert to base64
          const frameData = canvas.toDataURL('image/jpeg', 0.8);
          frames.push({
            timestamp: time,
            base64: frameData.split(',')[1]
          });
        } catch (error) {
          console.error('Failed to extract frame at', time, 's:', error);
          if (error instanceof Error && error.name === 'SecurityError') {
            toast.error('Cannot extract frames from this video. Please try uploading a different video file.');
            // Clean up and abort
            URL.revokeObjectURL(videoUrl);
            throw new Error('Cross-origin video cannot be processed');
          }
        }
      }
      
      // Clean up
      URL.revokeObjectURL(videoUrl);
      
      console.log(`🎬 Extracted ${frames.length} frames from video`);
      
      // Process frames using the video processing API
      const processResponse = await fetch('/api/video/process-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: frames.map(f => ({
            timestamp: f.timestamp,
            base64: f.base64,
            relevanceScore: 1 // All frames considered relevant for customer uploads
          })),
          projectId: videoInfo.projectId,
          uploadLinkId: videoInfo.uploadToken,
          source: 'customer_video_upload',
          videoId: videoInfo.videoId // Link frames to the original video
        })
      });
      
      if (!processResponse.ok) {
        const errorText = await processResponse.text();
        throw new Error(`Frame processing failed: ${errorText}`);
      }
      
      const processResult = await processResponse.json();
      
      if (processResult.success) {
        // Add processed frames to uploaded images list
        const frameImages = processResult.processedFrameDetails?.map((frame: any, index: number) => ({
          id: frame.imageId || `frame-${index}`,
          name: `${videoFile.name} - Frame ${index + 1}`,
          uploadedAt: new Date().toISOString()
        })) || [];
        
        setUploadedImages(prev => [...prev, ...frameImages]);
        
        // Track job IDs for Railway transfer monitoring
        if (processResult.queuedJobs && processResult.queuedJobs.length > 0) {
          console.log('📋 Tracking video frame job IDs for transfer monitoring:', processResult.queuedJobs);
          setPendingJobIds(prev => [...prev, ...processResult.queuedJobs]);
        }
        
        // Mark video as processed
        setProcessedFiles(1);
        
        toast.success(`Video processed successfully! Extracted ${frames.length} frames for analysis.`, {
          duration: 5000,
          style: {
            background: '#10b981',
            color: 'white',
          }
        });
      } else {
        throw new Error(processResult.error || 'Frame processing failed');
      }
      
    } catch (error) {
      console.error('Video processing error:', error);
      
      // Hide overlay on error
      setShowTransferOverlay(false);
      setTotalFilesToProcess(0);
      setProcessedFiles(0);
      
      toast.error(`Video processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        duration: 6000,
        style: {
          background: '#ef4444',
          color: 'white',
        }
      });
    } finally {
      setProcessingVideo(false);
    }
  };
  */


  const handleFileUpload = async (file: File) => {
    setUploading(true);
    
    // Immediately show optimistic UI update
    const tempImage: UploadedImage = {
      id: `temp-${Date.now()}`,
      name: file.name,
      uploadedAt: new Date().toISOString()
    };
    setUploadedImages(prev => [...prev, tempImage]);
    
    try {
      console.log('🚀 Starting file upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        token: token,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
      });
      
      // Video uploads now supported with S3 backend
      
      // All uploads now go through our S3 API route (no size limit with S3)
      
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`/api/customer-upload/${token}/upload`, {
        method: 'POST',
        body: formData,
        // Add timeout for mobile networks
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });
      
      console.log('📡 Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload API error:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          headers: Object.fromEntries(response.headers.entries())
        });
        
        // S3 can handle large files, so no fallback needed
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        
        const errorMessage = errorData.error || `Upload failed: ${response.status} ${response.statusText}`;
        const details = errorData.details ? ` (${errorData.details})` : '';
        const errorType = errorData.errorType ? ` [${errorData.errorType}]` : '';
        
        throw new Error(`${errorMessage}${details}${errorType}`);
      }

      const result = await response.json();
      
      /*
      // COMMENTED OUT - Handle client-side video processing requirement
      if (result.requiresClientProcessing) {
        console.log('🎬 Video requires client-side processing:', result.videoInfo);
        
        // Remove temp image since we'll handle video processing differently
        setUploadedImages(prev => prev.filter(img => img.id !== tempImage.id));
        
        // Store video info for processing
        const videoInfo = result.videoInfo;
        
        // Process video using our VideoUpload component logic
        await processVideoClientSide(file, videoInfo);
        
        return;
      }
      */
      
      // Handle regular images and processed videos
      const uploadId = result.imageId || result.videoId;
      
      // Track job ID for Railway SQS processing  
      if (result.sqsMessageId && result.sqsMessageId !== 'no-analysis-data') {
        console.log('📋 SQS Job ID tracked:', result.sqsMessageId);
        setPendingJobIds(prev => [...prev, result.sqsMessageId]);
        setShowProcessingStatus(true);
        console.log('⏳ Upload complete, AI analysis processing in background...');
        
        // IMMEDIATE: Add to simple real-time system for instant updates
        const isVideo = result.videoId;
        
        if (result.projectId) {
          // Dynamically import to avoid SSR issues
          import('@/lib/simple-realtime').then(({ default: simpleRealTime }) => {
            simpleRealTime.addProcessing(result.projectId, {
              id: uploadId,
              name: file.name,
              type: isVideo ? 'video' : 'image',
              status: isVideo ? 'AI video analysis in progress...' : 'AI analysis in progress...',
              source: 'customer_upload'
            });
          }).catch(console.error);
        }
        
        // Legacy event for backward compatibility
        const processingEvent = new CustomEvent('customerUploadProcessing', {
          detail: {
            projectId: result.projectId || projectId,
            uploadId,
            fileName: file.name,
            type: isVideo ? 'video' : 'image',
            status: isVideo ? 'AI video analysis in progress...' : 'AI analysis in progress...',
            source: 'customer_upload',
            sqsMessageId: result.sqsMessageId
          }
        });
        
        window.dispatchEvent(processingEvent);
        console.log('📡 Customer upload added to simple real-time system');
        
      } else {
        console.log('✅ Upload complete');
      }
      
      // Replace temp image with real data (but keep overlay until Railway transfer)
      setUploadedImages(prev => prev.map(img => 
        img.id === tempImage.id 
          ? {
              id: uploadId,
              name: file.name,
              uploadedAt: new Date().toISOString()
            }
          : img
      ));
      
      // Update total uploaded files counter for photos
      setTotalUploadedFiles(prev => prev + 1);
      
      // Don't show success toast yet - let Railway transfer overlay handle it
      console.log('📄 Photo uploaded to database, waiting for Railway transfer...');
      
    } catch (err) {
      console.error('Upload error:', err);
      
      // Remove temp image on error
      setUploadedImages(prev => prev.filter(img => img.id !== tempImage.id));
      
      // Enhanced error messages for mobile
      let errorMessage = 'Upload failed';
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          errorMessage = 'Upload timed out. Please check your connection and try again.';
        } else {
          errorMessage = err.message;
        }
      }
      
      toast.error(errorMessage, {
        duration: 6000,
        style: {
          background: '#ef4444',
          color: 'white',
        }
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Validating Upload Link</h2>
            <p className="text-slate-600 mb-4">Please wait while we verify your access...</p>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse w-2/3"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Remove error display - always allow access
  
  // Ensure validation is never null due to the useEffect
  if (!validation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading Upload Page</h2>
            <p className="text-slate-600 mb-4">Setting up your media upload...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      {/* Header Section */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {validation.branding?.companyLogo ? (
                <img 
                  src={validation.branding.companyLogo} 
                  alt={validation.branding.companyName}
                  className="w-10 h-10 object-contain rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
              )}
              <div>
                <p className="font-medium text-slate-800">
                  {validation.branding?.companyName || 'Moving Company'}
                </p>
                <p className="text-sm text-slate-500">Inventory Upload</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
              <Clock className="w-4 h-4" />
              <span>Expires {new Date(validation.expiresAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        
        {/* Welcome Section */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm font-medium">
            <User className="w-4 h-4" />
            Welcome, {validation.customerName}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 leading-tight">
            Upload Your Moving Photos
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Help us ensure a wonderful moving experience by uploading photos of the belongings moving with you.
            {/* <span className="font-semibold text-blue-600 ml-1">{validation.projectName}</span> */}
          </p>
        </div>

        {/* Upload Area */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <UploadIcon className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800">Upload Photos or Videos</h2>
            </div>
            
            <CustomerPhotoUploader
              onUpload={handleFileUpload}
              uploading={uploading}
              customerToken={token}
              onFileUploaded={(fileName) => {
                setTotalUploadedFiles(prev => prev + 1);
                console.log('📊 File uploaded counter updated:', fileName);
              }}
            />
          </div>
        </div>

        {/* Processing Status Section */}
        {/* {showProcessingStatus && pendingJobIds.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-blue-800">
                    AI Analysis in Progress
                  </h3>
                  <p className="text-sm text-blue-700">Processing {pendingJobIds.length} image{pendingJobIds.length !== 1 ? 's' : ''} to identify items automatically</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3 text-blue-700">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                <span>AI is analyzing your photos to identify items and create your moving inventory</span>
              </div>
              <div className="flex items-center gap-3 text-blue-700 mt-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{animationDelay: '0.5s'}}></div>
                <span>Items will appear in your inventory shortly...</span>
              </div>
            </div>
          </div>
        )} */}

        {/* Upload Success Section */}
        {totalUploadedFiles > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-green-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-800">
                    {totalUploadedFiles} File{totalUploadedFiles !== 1 ? 's' : ''} Uploaded
                  </h3>
                  <p className="text-sm text-green-700">Successfully uploaded to cloud storage{showProcessingStatus ? ' - AI analysis in progress' : ' and ready for analysis'}</p>
                </div>
              </div>
            </div>
            
            <div className="p-6">
              {/* <div className="grid gap-3 mb-6"> */}
                {/* {uploadedImages.map((image) => (
                  <div key={image.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{image.name}</p>
                      <p className="text-sm text-slate-500">
                        Uploaded at {new Date(image.uploadedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  </div>
                ))}
              </div> */}
              
              {/* What's Next Section */}
              <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <ArrowRight className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-semibold text-blue-800 text-lg">What happens next?</h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-blue-700">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span>AI analyzes your photos to identify items automatically</span>
                      </div>
                      <div className="flex items-center gap-3 text-blue-700">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span>Items are cataloged with descriptions and estimated values</span>
                      </div>
                      <div className="flex items-center gap-3 text-blue-700">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span>{validation.branding?.companyName || 'Your moving company'} reviews your complete inventory</span>
                      </div>
                      <div className="flex items-center gap-3 text-blue-700">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span>You receive a detailed inventory report for your move</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Instructions Section - Only show if no uploads yet */}
        {totalUploadedFiles === 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
              <h3 className="text-lg font-semibold text-blue-800">Best Practices</h3>
            </div>
            
            <div className="p-6">
              <div className="prose prose-slate max-w-none">
                {validation.instructions ? (
                  <div className="space-y-4">
                    {parseInstructionsForDisplay(
                      validation.instructions, 
                      validation.branding?.companyName || 'Your Moving Company'
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                      📸 Upload Tips from {validation.branding?.companyName || 'Your Moving Company'}
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                        <p className="text-slate-700 leading-relaxed">Take clear, well-lit photos of your items</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                        <p className="text-slate-700 leading-relaxed">Include multiple angles for large furniture</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                        <p className="text-slate-700 leading-relaxed">Group similar items together when possible</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                        <p className="text-slate-700 leading-relaxed">Add descriptions to help with identification</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                        <p className="text-slate-700 leading-relaxed">Upload as many photos as needed</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <div className="inline-flex items-center text-slate-400 text-sm">
            <span>Powered by</span>
            <div className="scale-[0.8] origin-center -ml-2">
              <Logo />
            </div>
          </div>
        </div>
      </div>
      
      {/* Railway Transfer Overlay removed - using simple S3 upload with SQS */}
    </div>
  );
}