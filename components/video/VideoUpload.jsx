// components/video/VideoUpload.jsx - Video upload with frame extraction for inventory analysis
'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  Video, 
  Play, 
  Pause, 
  RotateCcw, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Camera,
  Zap,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';

export default function VideoUpload({ 
  projectId, 
  onFramesExtracted, 
  onAnalysisComplete, 
  uploadLinkId, 
  onReset,
  initialVideoFile = null,
  autoStart = false
}) {
  const [uploadState, setUploadState] = useState('idle'); // idle, converting, uploading, processing, extracting, selecting, analyzing, complete
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResults, setAnalysisResults] = useState([]);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [conversionProgress, setConversionProgress] = useState(0);
  const [extractedFrames, setExtractedFrames] = useState([]);
  const [selectedFrames, setSelectedFrames] = useState([]);
  
  const fileInputRef = useRef();
  const videoRef = useRef();
  const canvasRef = useRef();

  // Extract frames from video at specified intervals
  const extractFrames = useCallback(async (videoElement, frameRate = 1) => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const frames = [];
      const duration = videoElement.duration;
      const totalFrames = Math.ceil(duration * frameRate);
      let currentTime = 0;
      let frameCount = 0;
      
      setCurrentStage(`Extracting frames (0/${totalFrames})`);
      setExtractionProgress(0);
      
      const extractFrame = () => {
        if (currentTime >= duration) {
          setExtractionProgress(100);
          setCurrentStage(`Extracted ${frames.length} frames`);
          resolve(frames);
          return;
        }
        
        videoElement.currentTime = currentTime;
        videoElement.onseeked = () => {
          // Set canvas size to match video
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          
          try {
            // Draw current frame to canvas
            ctx.drawImage(videoElement, 0, 0);
            
            // Convert to base64
            const frameData = canvas.toDataURL('image/jpeg', 0.8);
            
            frames.push({
              timestamp: currentTime,
              dataUrl: frameData,
              base64: frameData.split(',')[1],
              selected: false
            });
          } catch (error) {
            console.error('Failed to extract frame at', currentTime, 's:', error);
            // Skip this frame if it fails (likely due to CORS)
            if (error.name === 'SecurityError') {
              toast.error('Cannot extract frames from this video due to security restrictions. Please upload the video file directly.');
              resolve(frames); // Return what we have so far
              return;
            }
          }
          
          frameCount++;
          const progress = Math.round((frameCount / totalFrames) * 100);
          setExtractionProgress(progress);
          setCurrentStage(`Extracting frames (${frameCount}/${totalFrames})`);
          
          currentTime += 1 / frameRate; // Next frame
          extractFrame();
        };
      };
      
      extractFrame();
    });
  }, []);

  // Smart frame selection using OpenAI to identify relevant frames
  const selectRelevantFrames = useCallback(async (frames) => {
    setUploadState('selecting');
    setCurrentStage('Analyzing frames with AI...');
    setExtractionProgress(0);
    
    try {
      console.log('🤖 Starting AI frame selection:', frames.length, 'frames');
      
      // Send first few frames to AI for analysis and selection
      const sampleFrames = frames.slice(0, Math.min(10, frames.length)); // Limit to 10 frames for cost efficiency
      setCurrentStage(`Sending ${sampleFrames.length} frames to AI for analysis...`);
      
      const response = await fetch('/api/video/analyze-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: sampleFrames.map(f => ({
            timestamp: f.timestamp,
            base64: f.base64
          })),
          projectId,
          task: 'inventory_selection'
        })
      });
      
      console.log('🤖 Frame selection API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('🤖 Frame selection API error:', errorText);
        throw new Error(`Frame selection failed: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('🤖 Frame selection result:', result);
      
      if (result.success) {
        // Mark selected frames based on AI analysis
        const updatedFrames = frames.map(frame => ({
          ...frame,
          selected: result.selectedTimestamps?.includes(frame.timestamp) || false,
          relevanceScore: result.frameScores?.[frame.timestamp] || 0
        }));
        
        const selectedFrames = updatedFrames.filter(f => f.selected);
        console.log('🤖 AI selected', selectedFrames.length, 'frames out of', frames.length);
        
        setSelectedFrames(selectedFrames);
        return selectedFrames;
      } else {
        throw new Error(result.error || 'AI frame selection failed');
      }
    } catch (error) {
      console.error('🤖 Frame selection error:', error);
      toast.error(`Failed to select relevant frames: ${error.message}`);
      
      // Fallback: select every 3rd frame
      console.log('🤖 Using fallback frame selection');
      const fallbackSelected = frames.filter((_, index) => index % 3 === 0);
      console.log('🤖 Fallback selected', fallbackSelected.length, 'frames');
      
      setSelectedFrames(fallbackSelected);
      return fallbackSelected;
    }
  }, [projectId]);

  // Process selected frames through dedicated video processing API
  const analyzeSelectedFrames = useCallback(async (selectedFrames) => {
    setUploadState('analyzing');
    setAnalysisProgress(0);
    setCurrentStage(`Saving ${selectedFrames.length} selected frames to database...`);
    
    try {
      console.log('🎬 Starting video frame analysis:', {
        frameCount: selectedFrames.length,
        projectId,
        uploadLinkId
      });
      
      // Process all frames in batch through dedicated video API
      const frameData = selectedFrames.map(frame => ({
        timestamp: frame.timestamp,
        base64: frame.base64,
        relevanceScore: frame.relevanceScore || 0
      }));
      
      const requestPayload = {
        frames: frameData,
        projectId,
        uploadLinkId: uploadLinkId || undefined,
        source: 'video_upload'
      };
      
      setCurrentStage('Processing frames and queuing for analysis...');
      setAnalysisProgress(50);
      
      console.log('🎬 Sending request to /api/video/process-frames:', {
        frameCount: frameData.length,
        projectId,
        source: 'video_upload'
      });
      
      const response = await fetch('/api/video/process-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });
      
      console.log('🎬 API Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('🎬 API Error Response:', errorText);
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
      console.log('🎬 API Response data:', result);
      
      if (result.success) {
        // Update progress to 100%
        setAnalysisProgress(100);
        
        // Create results array with processed frame info
        const results = result.processedFrameDetails?.map(processedFrame => {
          const originalFrame = selectedFrames.find(f => 
            Math.abs(f.timestamp - processedFrame.frameTimestamp) < 0.1
          );
          
          return {
            ...originalFrame,
            ...processedFrame,
            analysisResult: { status: 'queued' } // Will be updated by SSE
          };
        }) || [];
        
        setAnalysisResults(results);
        setUploadState('complete');
        
        console.log('🎬 Video frames successfully saved to database, calling onAnalysisComplete');
        
        if (onAnalysisComplete) {
          onAnalysisComplete(results);
        }
        
        toast.success(`Successfully processed ${result.processedFrames || 0} video frames for analysis`);
      } else {
        throw new Error(result.error || 'Failed to process video frames');
      }
      
    } catch (error) {
      console.error('🎬 Video frame processing error:', error);
      toast.error(`Failed to process video frames: ${error.message}`);
      setUploadState('ready'); // Go back to ready state so user can try again
    }
  }, [projectId, onAnalysisComplete, uploadLinkId]);

  // Convert video to Gemini-compatible format using MediaRecorder API
  const convertVideoToMP4 = useCallback(async (file) => {
    // ALWAYS convert .MOV files - they are never compatible with Gemini
    const isMovFile = file.name.toLowerCase().endsWith('.mov');
    
    if (!isMovFile && file.type === 'video/mp4') {
      console.log('🎬 File is already compatible MP4, skipping conversion');
      return file;
    }

    console.log(`🔄 Converting ${file.name} (${file.type}) to Gemini-compatible MP4...`);
    setCurrentStage(`Converting video for compatibility...`);
    setConversionProgress(10);

    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      const timeout = setTimeout(() => {
        reject(new Error('Video conversion timeout after 2 minutes'));
      }, 120000);

      video.onloadedmetadata = () => {
        try {
          clearTimeout(timeout);
          setConversionProgress(30);

          // Check if MediaRecorder supports H.264 MP4
          const mimeTypes = [
            'video/mp4; codecs="avc1.42E01E"', // H.264 baseline profile
            'video/mp4; codecs="avc1.4D4028"', // H.264 main profile  
            'video/mp4',
            'video/webm; codecs="vp8"'
          ];

          let supportedMimeType = null;
          for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
              supportedMimeType = mimeType;
              break;
            }
          }

          if (!supportedMimeType) {
            throw new Error('Browser does not support video recording');
          }

          console.log(`🎬 Using codec: ${supportedMimeType}`);
          setConversionProgress(50);

          // Create canvas and stream
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Optimize dimensions for mobile and file size
          const maxDimension = 1280;
          const aspectRatio = video.videoWidth / video.videoHeight;
          
          if (video.videoWidth > video.videoHeight) {
            canvas.width = Math.min(video.videoWidth, maxDimension);
            canvas.height = Math.round(canvas.width / aspectRatio);
          } else {
            canvas.height = Math.min(video.videoHeight, maxDimension);
            canvas.width = Math.round(canvas.height * aspectRatio);
          }

          const stream = canvas.captureStream(15); // 15 FPS for good quality/size balance
          
          // Add audio track if available
          try {
            if (video.captureStream) {
              const videoStream = video.captureStream();
              const audioTracks = videoStream.getAudioTracks();
              audioTracks.forEach(track => stream.addTrack(track));
            }
          } catch (audioError) {
            console.warn('🎬 Audio capture not available:', audioError);
          }

          const recorder = new MediaRecorder(stream, {
            mimeType: supportedMimeType,
            videoBitsPerSecond: 1000000, // 1 Mbps for smaller files
            audioBitsPerSecond: 128000   // 128 kbps audio
          });

          const chunks = [];
          
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };

          recorder.onstop = () => {
            setConversionProgress(95);
            
            const outputMimeType = supportedMimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
            const blob = new Blob(chunks, { type: outputMimeType });
            
            // Create file with proper MP4 extension
            const fileName = file.name.replace(/\.[^/.]+$/, '.mp4');
            const convertedFile = new File([blob], fileName, {
              type: 'video/mp4',
              lastModified: Date.now()
            });

            setConversionProgress(100);
            setCurrentStage('Conversion complete!');
            
            const sizeMB = (convertedFile.size / 1024 / 1024).toFixed(2);
            const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);
            console.log(`✅ Video converted: ${originalSizeMB}MB → ${sizeMB}MB (${fileName})`);
            
            resolve(convertedFile);
          };

          recorder.onerror = (event) => {
            console.error('🎬 MediaRecorder error:', event.error);
            reject(new Error(`Video conversion failed: ${event.error?.message || 'Unknown error'}`));
          };

          setCurrentStage('Recording converted video...');
          recorder.start(1000);

          // Play video and draw frames to canvas
          const startTime = Date.now();
          const maxDuration = 60000; // 60 seconds max

          const drawFrame = () => {
            if (video.paused || video.ended || Date.now() - startTime > maxDuration) {
              recorder.stop();
              return;
            }

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const progress = Math.min(video.currentTime / video.duration, 1);
            setConversionProgress(50 + progress * 40);
            
            requestAnimationFrame(drawFrame);
          };

          video.onplay = drawFrame;
          video.onended = () => setTimeout(() => recorder.stop(), 500);
          
          // Start playback
          video.play().catch(error => {
            reject(new Error(`Failed to play video: ${error.message}`));
          });

        } catch (error) {
          clearTimeout(timeout);
          console.error('🎬 Conversion setup error:', error);
          reject(new Error(`Setup failed: ${error.message}`));
        }
      };

      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load video for conversion'));
      };

      video.src = URL.createObjectURL(file);
      video.load();
    });
  }, []);

  // Handle file selection and upload to server with Railway processing
  const handleFileSelect = useCallback(async (event) => {
    const file = event.target.files[0];
    console.log('🎬 File selected:', file?.name, file?.type, file?.size);
    
    if (!file) {
      console.log('🎬 No file selected');
      return;
    }
    
    if (!file.type.startsWith('video/')) {
      console.error('🎬 Invalid file type:', file.type);
      toast.error('Please select a valid video file');
      return;
    }
    
    // Check file size (limit to 100MB)
    if (file.size > 100 * 1024 * 1024) {
      console.error('🎬 File too large:', file.size);
      toast.error('Video file too large. Please select a file under 100MB.');
      return;
    }
    
    let processedFile = file;
    
    try {
      // ALWAYS convert .MOV files regardless of device/browser/MIME type
      const isMovFile = file.name.toLowerCase().endsWith('.mov');
      const needsConversion = isMovFile || file.type !== 'video/mp4';
      
      console.log(`🎬 Video file analysis:`, {
        fileName: file.name,
        mimeType: file.type,
        isMovFile,
        needsConversion,
        reason: isMovFile ? '.MOV file detected - MUST convert for Gemini compatibility' :
                file.type !== 'video/mp4' ? 'Non-MP4 MIME type' : 'None'
      });
      
      if (needsConversion) {
        if (isMovFile) {
          console.log('🚨 .MOV file detected - Converting to MP4 for Gemini compatibility...');
          toast.info('Converting .MOV to MP4 for compatibility...', { duration: 3000 });
        } else {
          console.log('🎬 Converting video to MP4 for Gemini compatibility...');
          toast.info('Converting video to MP4 for better compatibility...', { duration: 3000 });
        }
        
        processedFile = await convertVideoToMP4(file);
        console.log(`✅ Video conversion completed: ${file.name} → ${processedFile.name}`);
        toast.success('Video converted successfully!');
      } else {
        console.log('🎬 Video is already MP4, no conversion needed');
      }
      
      console.log('🎬 Starting video upload to server for Railway processing');
      setVideoFile(processedFile);
      setVideoUrl(URL.createObjectURL(processedFile));
      setUploadState('uploading');
      setCurrentStage('Uploading video to server...');
      
    } catch (conversionError) {
      console.error('🎬 Video conversion failed:', conversionError);
      toast.error(`Video conversion failed: ${conversionError.message}`, {
        description: 'The video will be uploaded as-is. Some processing issues may occur.',
        duration: 8000,
      });
      
      // Continue with original file if conversion fails
      processedFile = file;
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setUploadState('uploading');
      setCurrentStage('Uploading video to server...');
    }
    
    try {
      // Step 1: Get pre-signed upload URL
      console.log('🎬 Getting pre-signed upload URL...');
      setCurrentStage('Preparing upload...');
      setUploadProgress(10);
      
      const presignedResponse = await fetch('/api/generate-video-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: processedFile.name,
          fileSize: processedFile.size,
          mimeType: processedFile.type,
          projectId: projectId,
          isCustomerUpload: !!uploadLinkId,
          customerToken: uploadLinkId
        })
      });
      
      if (!presignedResponse.ok) {
        const errorText = await presignedResponse.text();
        throw new Error(`Failed to get upload URL: ${errorText}`);
      }
      
      const { uploadUrl, s3Key, metadata } = await presignedResponse.json();
      console.log('🎬 Pre-signed URL obtained, uploading to S3...');
      
      // Step 2: Upload directly to S3
      setCurrentStage('Uploading video...');
      setUploadProgress(20);
      
      const s3UploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: processedFile,
        headers: {
          'Content-Type': processedFile.type,
        }
      });
      
      if (!s3UploadResponse.ok) {
        throw new Error(`S3 upload failed: ${s3UploadResponse.status} ${s3UploadResponse.statusText}`);
      }
      
      setUploadProgress(70);
      console.log('🎬 Video uploaded to S3 successfully');
      
      // Step 3: Confirm upload with server
      setCurrentStage('Finalizing upload...');
      
      const confirmResponse = await fetch('/api/confirm-video-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3Key,
          metadata,
          actualFileSize: processedFile.size
        })
      });
      
      setUploadProgress(90);
      
      if (!confirmResponse.ok) {
        const errorText = await confirmResponse.text();
        throw new Error(`Upload confirmation failed: ${errorText}`);
      }
      
      const uploadResult = await confirmResponse.json();
      console.log('🎬 Video upload confirmed:', uploadResult.videoId);
      
      // Set video URL for preview 
      if (uploadResult.videoUrl) {
        setVideoUrl(uploadResult.videoUrl);
        console.log('🎬 Using S3 signed URL for video preview:', uploadResult.videoUrl);
      }
      
      setUploadProgress(100);
      setCurrentStage('Video uploaded successfully!');
      
      // Check processing type
      if (uploadResult.requiresClientProcessing) {
        console.log('🎬 Client-side processing required');
        setUploadState('ready');
        
        toast.success('Video uploaded successfully!', {
          description: 'Click "Start AI Analysis" below to extract and analyze frames from your video.',
          duration: 6000,
        });
      } else {
        // Fallback to ready state
        console.log('🎬 Video upload completed - no processing initiated');
        setUploadState('ready');
        
        toast.success('Video uploaded successfully!', {
          description: 'Processing will begin shortly.',
          duration: 4000,
        });
      }
      
    } catch (error) {
      console.error('🎬 Video upload/processing error:', error);
      
      let errorMessage = error.message || 'Unknown error occurred';
      
      // Provide more user-friendly error messages
      if (errorMessage.includes('404')) {
        errorMessage = 'Video upload endpoint not found. Please check the project configuration.';
      } else if (errorMessage.includes('413') || errorMessage.includes('too large')) {
        errorMessage = 'Video file is too large. Please compress the video or use a smaller file (max 100MB).';
      } else if (errorMessage.includes('Failed to get upload URL')) {
        errorMessage = 'Failed to prepare upload. Please check your permissions and try again.';
      } else if (errorMessage.includes('S3 upload failed')) {
        errorMessage = 'Video upload to cloud storage failed. Please check your connection and try again.';
      } else if (errorMessage.includes('Upload confirmation failed')) {
        errorMessage = 'Upload completed but confirmation failed. The video may still be processed. Please refresh and check.';
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
      
      setUploadState('idle');
      setUploadProgress(0);
      setCurrentStage('');
    }
  }, [projectId, uploadLinkId, onFramesExtracted]);

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
      setUploadState('ready');
    }
  }, []);

  // Start frame extraction and analysis process
  const startAnalysis = useCallback(async () => {
    if (!videoRef.current) return;
    
    setUploadState('extracting');
    toast.info('Extracting frames from video...');
    
    try {
      // Extract frames (1 frame per second)
      const frames = await extractFrames(videoRef.current, 1);
      setExtractedFrames(frames);
      
      if (onFramesExtracted) {
        onFramesExtracted(frames);
      }
      
      toast.success(`Extracted ${frames.length} frames`);
      
      // Smart frame selection
      const relevantFrames = await selectRelevantFrames(frames);
      
      if (relevantFrames.length === 0) {
        toast.error('No relevant frames found for inventory analysis');
        setUploadState('idle');
        return;
      }
      
      toast.info(`Selected ${relevantFrames.length} relevant frames for analysis`);
      
      // Analyze selected frames
      await analyzeSelectedFrames(relevantFrames);
      
    } catch (error) {
      console.error('Video analysis error:', error);
      toast.error('Failed to analyze video');
      setUploadState('idle');
    }
  }, [extractFrames, selectRelevantFrames, analyzeSelectedFrames, onFramesExtracted]);

  const resetUpload = useCallback(() => {
    setUploadState('idle');
    setVideoFile(null);
    setVideoUrl('');
    setExtractedFrames([]);
    setSelectedFrames([]);
    setAnalysisResults([]);
    setUploadProgress(0);
    setAnalysisProgress(0);
    setExtractionProgress(0);
    setConversionProgress(0);
    setCurrentStage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Call parent reset if provided
    if (onReset) {
      onReset();
    }
  }, [onReset]);

  // Handle initial video file and auto-start
  useEffect(() => {
    if (initialVideoFile && autoStart && uploadState === 'idle') {
      console.log('🎬 Auto-processing initial video file:', initialVideoFile.name);
      
      // Simulate file selection with the provided file
      setVideoFile(initialVideoFile);
      setVideoUrl(URL.createObjectURL(initialVideoFile));
      setUploadState('uploading');
      
      // Simulate upload progress
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 15;
        setUploadProgress(progress);
        if (progress >= 100) {
          clearInterval(progressInterval);
          console.log('🎬 Auto-upload simulation complete, setting to processing');
          setUploadState('processing');
        }
      }, 150);
    }
  }, [initialVideoFile, autoStart, uploadState]);

  // Auto-start analysis when video is loaded and autoStart is true
  useEffect(() => {
    if (autoStart && uploadState === 'ready' && videoRef.current && videoDuration > 0) {
      console.log('🎬 Auto-starting analysis for video duration:', videoDuration);
      // Small delay to ensure UI is ready
      setTimeout(() => {
        startAnalysis();
      }, 500);
    }
  }, [autoStart, uploadState, videoDuration, startAnalysis]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Video className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Video Inventory Analysis</h2>
        <p className="text-gray-600">Upload a video to automatically extract and analyze inventory items</p>
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
          <p className="text-sm text-gray-400">Supports MP4, MOV, AVI, WebM, FLV, MPG, WMV, 3GP (max 100MB)</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Conversion Progress */}
      {uploadState === 'converting' && (
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
            <div>
              <h3 className="font-medium text-gray-900">Converting video to MP4...</h3>
              <p className="text-sm text-gray-500">{currentStage}</p>
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-orange-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${conversionProgress}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">{conversionProgress}% complete</p>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4">
            <p className="text-orange-800 text-sm">
              🔄 Converting video for better compatibility with our analysis system. This ensures reliable processing on all devices.
            </p>
          </div>
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
        </div>
      )}

      {/* Video Preview & Analysis */}
      {(uploadState === 'processing' || uploadState === 'ready' || uploadState === 'extracting' || uploadState === 'selecting' || uploadState === 'analyzing' || uploadState === 'complete') && videoUrl && (
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Video Preview</h3>
            <button
              onClick={resetUpload}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Video Player */}
          <div className="relative mb-6">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onLoadedMetadata={handleVideoLoaded}
              className="w-full max-h-96 rounded-lg"
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Video Info */}
          {videoDuration > 0 && (
            <div className="flex items-center gap-6 mb-6 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>Duration: {Math.round(videoDuration)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4" />
                <span>Expected frames: ~{Math.round(videoDuration)}</span>
              </div>
            </div>
          )}

          {/* Server Processing Status */}
          {uploadState === 'processing' && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                <span className="text-gray-700">{currentStage || 'Server is extracting frames from video...'}</span>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-purple-800 text-sm mb-2">
                  🚂 Server is extracting 1 frame per second and queuing them for AI analysis.
                </p>
                <p className="text-purple-600 text-xs">
                  Frame analysis results will appear on the main project page. You can close this dialog safely.
                </p>
              </div>
            </div>
          )}
          
          {/* Analysis Status (legacy - kept for backward compatibility) */}
          {uploadState === 'extracting' && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <span className="text-gray-700">{currentStage || 'Extracting frames from video...'}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${extractionProgress}%` }}
                />
              </div>
              <p className="text-sm text-gray-500 mt-1">{Math.round(extractionProgress)}% complete</p>
            </div>
          )}

          {uploadState === 'selecting' && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                <span className="text-gray-700">{currentStage || 'AI selecting relevant frames...'}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-purple-500 h-2 rounded-full animate-pulse" style={{ width: '75%' }} />
              </div>
              <p className="text-sm text-gray-500 mt-1">AI analyzing frame content...</p>
            </div>
          )}

          {uploadState === 'analyzing' && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                <span className="text-gray-700">{currentStage || 'Analyzing selected frames...'}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <p className="text-sm text-gray-500 mt-1">{Math.round(analysisProgress)}% complete</p>
            </div>
          )}

          {uploadState === 'complete' && (
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-gray-700">Server processing complete! Video frames have been extracted and queued for AI analysis.</span>
            </div>
          )}

          {/* Start Analysis Button */}
          {uploadState === 'ready' && (
            <button
              onClick={startAnalysis}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-xl font-medium hover:from-purple-600 hover:to-blue-700 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" />
              Start AI Analysis
            </button>
          )}
        </div>
      )}

      {/* Frame Preview Grid (for debugging/preview) */}
      {selectedFrames.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Selected Frames ({selectedFrames.length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {selectedFrames.slice(0, 8).map((frame, index) => (
              <div key={index} className="relative">
                <img
                  src={frame.dataUrl}
                  alt={`Frame at ${frame.timestamp}s`}
                  className="w-full aspect-video object-cover rounded-lg"
                />
                <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                  {frame.timestamp.toFixed(1)}s
                </div>
              </div>
            ))}
          </div>
          {selectedFrames.length > 8 && (
            <p className="text-sm text-gray-500 mt-2">
              Showing 8 of {selectedFrames.length} selected frames
            </p>
          )}
        </div>
      )}
    </div>
  );
}