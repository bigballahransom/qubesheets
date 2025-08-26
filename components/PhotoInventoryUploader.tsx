// components/PhotoInventoryUploader.tsx
'use client';

import { useState, useRef } from 'react';
import { Upload, Camera, Loader2, X, Package, Box, BoxesIcon } from 'lucide-react';

export interface InventoryItem {
  name: string;
  description?: string;
  category?: string;
  quantity?: number;
  location?: string;
  cuft?: number;
  weight?: number;
  fragile?: boolean;
  special_handling?: string;
  box_recommendation?: {
    box_type: string;
    box_quantity: number;
    box_dimensions: string;
  };
}

export interface AnalysisResult {
  items: InventoryItem[];
  summary: string;
  total_boxes?: {
    small?: number;
    medium?: number;
    large?: number;
    extra_large?: number;
    book?: number;
    specialty?: number;
  };
  savedToDatabase?: boolean;
  dbError?: string;
}

interface PhotoInventoryUploaderProps {
  onItemsAnalyzed?: (result: AnalysisResult) => void;
  onImageSaved?: () => void; // New callback for when image is saved
  projectId?: string;
}

// Mobile device detection
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/i.test(userAgent);
  const isIOS = /iphone|ipad/i.test(userAgent);
  const isSafari = /safari/i.test(userAgent) && !/chrome/i.test(userAgent);
  
  console.log('📱 Device detection:', {
    userAgent: userAgent.substring(0, 50) + '...',
    isMobile,
    isIOS,
    isSafari,
    shouldSkipClientConversion: isMobile || (isIOS && isSafari)
  });
  
  return isMobile;
}

// Enhanced HEIC file detection for iPhone compatibility
function isHeicFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  // Log file details for debugging iPhone issues
  console.log('🔍 File analysis:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
  
  const isHeicByExtension = fileName.endsWith('.heic') || fileName.endsWith('.heif');
  const isHeicByMimeType = mimeType === 'image/heic' || mimeType === 'image/heif';
  
  // iPhone sometimes doesn't set proper MIME types, so check for empty MIME type with HEIC extension
  const isPotentialIPhoneHeic = (mimeType === '' || mimeType === 'application/octet-stream') && 
                                isHeicByExtension;
  
  const result = isHeicByExtension || isHeicByMimeType || isPotentialIPhoneHeic;
  
  console.log('📱 HEIC detection result:', {
    isHeicByExtension,
    isHeicByMimeType,
    isPotentialIPhoneHeic,
    finalResult: result
  });
  
  return result;
}

// Modern HEIC to JPEG conversion using heic-to library
async function convertHeicToJpeg(file: File): Promise<File> {
  // Ensure we're running on client-side
  if (typeof window === 'undefined') {
    throw new Error('HEIC conversion only available on client-side');
  }
  
  let retryCount = 0;
  const maxRetries = 2;
  
  while (retryCount <= maxRetries) {
    try {
      console.log(`🔄 Starting HEIC conversion attempt ${retryCount + 1} for:`, file.name, 'Size:', file.size);
      
      // Validate that we have a valid File object
      if (!file || !(file instanceof File)) {
        throw new Error('Invalid file object provided for conversion');
      }
      
      // Check if file is actually HEIC
      if (!isHeicFile(file)) {
        throw new Error('File is not a valid HEIC/HEIF file');
      }
      
      console.log('🔧 Loading heic-to library...');
      
      // Dynamic import with timeout - heic-to is more reliable than heic2any
      const importPromise = import('heic-to');
      const timeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Library import timeout')), 15000);
      });
      
      const { heicTo } = await Promise.race([importPromise, timeoutPromise]) as any;
      
      console.log('📦 heic-to loaded, starting conversion...');
      
      // Set up conversion with timeout - heic-to uses a simpler API
      const conversionPromise = heicTo({
        blob: file,
        type: 'image/jpeg',
        quality: 0.85 // Good balance of quality and compatibility
      });
      
      const conversionTimeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('HEIC conversion timeout after 45 seconds')), 45000);
      });
      
      const convertedBlob = await Promise.race([conversionPromise, conversionTimeoutPromise]);
      
      if (!convertedBlob || convertedBlob.size === 0) {
        throw new Error('Conversion resulted in empty blob');
      }
      
      // Create a new File object with converted data
      const convertedFile = new File(
        [convertedBlob],
        file.name.replace(/\.(heic|heif)$/i, '.jpg'),
        { 
          type: 'image/jpeg',
          lastModified: Date.now()
        }
      );
      
      console.log('✅ HEIC conversion successful:', convertedFile.name, 'Size:', convertedFile.size);
      return convertedFile;
      
    } catch (error) {
      console.error(`❌ HEIC conversion attempt ${retryCount + 1} failed:`, error);
      
      retryCount++;
      
      if (retryCount > maxRetries) {
        // Handle different error types and provide meaningful messages
        let errorMessage = 'Failed to convert HEIC image after multiple attempts.';
        
        if (error instanceof Error && error.message) {
          if (error.message.includes('timeout')) {
            errorMessage = 'HEIC conversion timed out. This file may be too large or complex. Try reducing file size or using a different image.';
          } else if (error.message.includes('Library import')) {
            errorMessage = 'Failed to load HEIC conversion library. Please check your internet connection and try again.';
          } else {
            errorMessage = `HEIC conversion failed: ${error.message}`;
          }
        } else if (error && typeof error === 'object' && Object.keys(error).length === 0) {
          errorMessage = 'HEIC conversion failed due to an internal library error. This may be due to browser compatibility, memory constraints, or a corrupted HEIC file.';
        } else if (typeof error === 'string') {
          errorMessage = `HEIC conversion failed: ${error}`;
        }
        
        throw new Error(errorMessage);
      }
      
      // Wait before retry with exponential backoff
      const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // This should never be reached, but TypeScript requires it
  throw new Error('HEIC conversion failed after all retry attempts');
}

// Helper functions to match those in the API route
function isFurniture(category?: string): boolean {
  const furnitureKeywords = [
    'sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'dresser', 
    'cabinet', 'desk', 'wardrobe', 'bookcase', 'shelf', 'shelving',
    'furniture', 'ottoman', 'recliner', 'bench', 'armchair'
  ];
  
  if (!category) return false;
  
  return furnitureKeywords.some(keyword => 
    category.toLowerCase().includes(keyword)
  );
}

function generateBoxRecommendation(
  category: string, 
  itemName: string, 
  cuft: number, 
  weight: number, 
  quantity: number
): { box_type: string; box_quantity: number; box_dimensions: string } {
  let boxType = "Medium";
  let boxDimensions = "18-1/8\" x 18\" x 16\"";
  let boxQuantity = 1;
  
  const itemNameLower = itemName.toLowerCase();
  const categoryLower = category ? category.toLowerCase() : '';
  
  if (categoryLower.includes('book') || itemNameLower.includes('book') || weight > 40) {
    if (cuft <= 1) {
      boxType = "Book Box";
      boxDimensions = "12\" x 12\" x 12\"";
      boxQuantity = Math.ceil(quantity * cuft / 1);
    } else {
      boxType = "Small";
      boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
      boxQuantity = Math.ceil(quantity * cuft / 1.5);
    }
  } else if (categoryLower.includes('kitchenware') || 
             itemNameLower.includes('dish') || 
             itemNameLower.includes('glass') || 
             itemNameLower.includes('cup') || 
             itemNameLower.includes('plate')) {
    boxType = "Dish Pack";
    boxDimensions = "18\" x 18\" x 28\"";
    boxQuantity = Math.ceil(quantity * cuft / 5);
  } else if (categoryLower.includes('electronic') || 
             itemNameLower.includes('tv') || 
             itemNameLower.includes('television') || 
             itemNameLower.includes('computer')) {
    boxType = "Medium";
    boxDimensions = "18-1/8\" x 18\" x 16\"";
    boxQuantity = Math.ceil(quantity * cuft / 3);
  } else if (itemNameLower.includes('mirror') || 
             itemNameLower.includes('picture') || 
             itemNameLower.includes('painting') || 
             itemNameLower.includes('art')) {
    boxType = "Mirror/Picture";
    boxDimensions = "37\" x 4\" x 27\"";
    boxQuantity = quantity;
  } else if (categoryLower.includes('cloth') || 
             itemNameLower.includes('dress') || 
             itemNameLower.includes('coat') || 
             itemNameLower.includes('suit')) {
    boxType = "Wardrobe";
    boxDimensions = "24\" x 21\" x 46\"";
    boxQuantity = Math.ceil(quantity * cuft / 10);
  } else if (cuft <= 1.5) {
    boxType = "Small";
    boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
    boxQuantity = Math.ceil(quantity * cuft / 1.5);
  } else if (cuft <= 3) {
    boxType = "Medium";
    boxDimensions = "18-1/8\" x 18\" x 16\"";
    boxQuantity = Math.ceil(quantity * cuft / 3);
  } else if (cuft <= 4.5) {
    boxType = "Large";
    boxDimensions = "18\" x 18\" x 24\"";
    boxQuantity = Math.ceil(quantity * cuft / 4.5);
  } else {
    boxType = "Extra-Large";
    boxDimensions = "24\" x 18\" x 24\"";
    boxQuantity = Math.ceil(quantity * cuft / 6);
  }
  
  boxQuantity = Math.max(1, boxQuantity);
  
  return {
    box_type: boxType,
    box_quantity: boxQuantity,
    box_dimensions: boxDimensions
  };
}

export default function PhotoInventoryUploader({ 
  onItemsAnalyzed, 
  onImageSaved,
  projectId 
}: PhotoInventoryUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset states
    setError(null);
    setAnalysisResult(null);
    setImageDescription('');
    setPreviewUrl(null);
    setSelectedFile(null);

    try {
      // Check if file is a supported image type or HEIC
      const isRegularImage = file.type.startsWith('image/');
      const isHeic = isHeicFile(file);
      
      // Special handling for iPhone photos that may have empty MIME types
      const isPotentialImage = file.type === '' || file.type === 'application/octet-stream';
      const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
      
      if (!isRegularImage && !isHeic && !(isPotentialImage && hasImageExtension)) {
        setError('Please select a valid image file (JPEG, PNG, GIF, HEIC, or HEIF). Note: Some iPhone photos may need to be converted to JPEG first.');
        return;
      }
      
      console.log('📷 File validation passed:', {
        isRegularImage,
        isHeic,
        isPotentialImage,
        hasImageExtension,
        proceeding: true
      });

      let finalFile = file;

      // Smart HEIC conversion: Mobile-first strategy
      if (isHeic || (isPotentialImage && hasImageExtension && file.name.toLowerCase().includes('.heic'))) {
        setIsConverting(true);
        const isMobile = isMobileDevice();
        
        if (isMobile) {
          // Mobile Strategy: Skip client conversion, use server-side
          console.log('📱 Mobile device detected - skipping client conversion, using server-side processing');
          finalFile = file; // Send HEIC directly to server
          setError('📱 Processing HEIC image on server...');
          setTimeout(() => setError(null), 2000);
        } else {
          // Desktop Strategy: Try client conversion first
          try {
            console.log('💻 Desktop device - attempting client-side HEIC conversion...');
            
            finalFile = await convertHeicToJpeg(file);
            console.log('✅ Client-side HEIC conversion successful');
          } catch (conversionError) {
            console.log('⚠️ Client-side HEIC conversion failed:', conversionError);
            console.log('📤 Server will attempt conversion as fallback');
            
            // Show a user-friendly message
            setError('🔄 Using server-side HEIC processing...');
            setTimeout(() => setError(null), 3000);
            
            finalFile = file; // Keep original HEIC file for server processing
          }
        }
        
        setIsConverting(false);
      }

      // Set the file and create preview
      setSelectedFile(finalFile);
      
      // Try to create preview URL (may fail for HEIC if conversion failed)
      try {
        setPreviewUrl(URL.createObjectURL(finalFile));
      } catch (previewError) {
        console.log('Could not create preview for HEIC file, will show placeholder');
        // For HEIC files where client conversion failed, show placeholder
        if (isHeic && finalFile === file) {
          setPreviewUrl(null); // We'll show a placeholder in the UI
        } else {
          setPreviewUrl(URL.createObjectURL(finalFile));
        }
      }
      
    } catch (error) {
      console.error('Error processing file:', error);
      setError('Failed to process the selected file. Please try again.');
      setIsConverting(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const saveImageToDatabase = async (file: File, analysisResult: AnalysisResult) => {
    if (!projectId) return;

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('description', imageDescription);
      formData.append('analysisResult', JSON.stringify(analysisResult));

      const response = await fetch(`/api/projects/${projectId}/images`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to save image');
      }

      // Call the callback to refresh the image gallery
      if (onImageSaved) {
        onImageSaved();
      }
    } catch (error) {
      console.error('Error saving image:', error);
      // Don't throw error here, as analysis was successful
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      console.log('🚀 Starting image analysis...', {
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
        projectId: projectId
      });

      const formData = new FormData();
      formData.append('image', selectedFile);
      
      if (projectId) {
        formData.append('projectId', projectId);
      }

      console.log('📤 Sending POST request to /api/analyze-image...');
      
      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        body: formData,
      });

      console.log('📥 Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response not ok:', errorText);
        throw new Error(`Failed to analyze image: ${response.statusText} - ${errorText}`);
      }

      console.log('📊 Parsing response JSON...');
      const responseText = await response.text();
      console.log('📄 Raw response text (first 200 chars):', responseText.substring(0, 200));
      
      let result;
      try {
        result = JSON.parse(responseText);
        console.log('✅ Analysis result received:', result);
      } catch (parseError) {
        console.error('❌ Failed to parse JSON response:', parseError);
        console.log('🔍 Full response text:', responseText);
        throw new Error(`Server returned invalid JSON: ${parseError.message}`);
      }
      
      // Only enhance items if fields are missing from the API response
      const enhancedItems = result.items.map((item: InventoryItem) => {
        const enhancedItem = { ...item };
        
        if (!enhancedItem.location) {
          enhancedItem.location = item.category === 'furniture' ? 'Living Room' : 
                             item.category === 'kitchenware' ? 'Kitchen' : 
                             item.category === 'electronics' ? 'Living Room' : 
                             item.category === 'bedroom' ? 'Bedroom' : 
                             item.category === 'bathroom' ? 'Bathroom' : 
                             item.category === 'office' ? 'Office' : 'Other';
        }
        
        if (!enhancedItem.cuft) {
          enhancedItem.cuft = item.category === 'furniture' ? 15 : 
                         item.category === 'electronics' ? 3 : 
                         item.category === 'kitchenware' ? 2 :
                         item.category === 'appliances' ? 20 :
                         item.category === 'decor' ? 1 : 3;
        }
        
        if (!enhancedItem.weight) {
          const cuft = enhancedItem.cuft || 3;
          if (item.category === 'furniture') {
            enhancedItem.weight = cuft * 8;
          } else if (item.category === 'electronics') {
            enhancedItem.weight = cuft * 10;
          } else if (item.category === 'books' || item.category === 'media') {
            enhancedItem.weight = cuft * 20;
          } else if (item.category === 'clothing' || item.category === 'bedding') {
            enhancedItem.weight = cuft * 4;
          } else if (item.category === 'kitchenware') {
            enhancedItem.weight = cuft * 9;
          } else if (item.category === 'appliances') {
            enhancedItem.weight = cuft * 12;
          } else {
            enhancedItem.weight = cuft * 7;
          }
        }
        
        if (!enhancedItem.box_recommendation && !isFurniture(item.category)) {
          enhancedItem.box_recommendation = generateBoxRecommendation(
            enhancedItem.category || '',
            enhancedItem.name,
            enhancedItem.cuft || 3,
            enhancedItem.weight || 21,
            enhancedItem.quantity || 1
          );
        }
        
        enhancedItem.fragile = enhancedItem.fragile || false;
        enhancedItem.special_handling = enhancedItem.special_handling || "";
        
        return enhancedItem;
      });

      if (!result.total_boxes && enhancedItems.length > 0) {
        const totalBoxes: {
          small: number;
          medium: number;
          large: number;
          extra_large: number;
          book: number;
          specialty: number;
        } = {
          small: 0,
          medium: 0,
          large: 0,
          extra_large: 0,
          book: 0,
          specialty: 0
        };
        
        enhancedItems.forEach((item: InventoryItem) => {
          if (item.box_recommendation) {
            const boxType = item.box_recommendation.box_type.toLowerCase();
            const quantity = item.box_recommendation.box_quantity || 0;
            
            if (boxType.includes('small')) {
              totalBoxes.small += quantity;
            } else if (boxType.includes('medium')) {
              totalBoxes.medium += quantity;
            } else if (boxType.includes('large') && !boxType.includes('extra')) {
              totalBoxes.large += quantity;
            } else if (boxType.includes('extra') || boxType.includes('xl')) {
              totalBoxes.extra_large += quantity;
            } else if (boxType.includes('book')) {
              totalBoxes.book += quantity;
            } else {
              totalBoxes.specialty += quantity;
            }
          }
        });
        
        result.total_boxes = totalBoxes;
      }

      const enhancedResult: AnalysisResult = {
        ...result,
        items: enhancedItems
      };

      setAnalysisResult(enhancedResult);
      
      // Save image to database
      await saveImageToDatabase(selectedFile, enhancedResult);
      
      // Call the items analyzed callback
      if (onItemsAnalyzed) {
        onItemsAnalyzed(enhancedResult);
      }
    } catch (err) {
      console.error('❌ Error analyzing image:', err);
      
      // Enhanced error logging for debugging
      if (err instanceof Error) {
        console.error('Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });
        setError(`Analysis failed: ${err.message}`);
      } else if (err && typeof err === 'object') {
        console.error('Non-Error object:', JSON.stringify(err));
        setError(`Analysis failed: ${JSON.stringify(err)}`);
      } else {
        console.error('Unknown error type:', typeof err, err);
        setError(`Analysis failed: ${String(err)}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setAnalysisResult(null);
    setError(null);
    setImageDescription('');
    setIsConverting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const calculateTotalBoxes = (totalBoxes: AnalysisResult['total_boxes']): number => {
    if (!totalBoxes) return 0;
    
    let sum = 0;
    if (totalBoxes.small) sum += totalBoxes.small;
    if (totalBoxes.medium) sum += totalBoxes.medium;
    if (totalBoxes.large) sum += totalBoxes.large;
    if (totalBoxes.extra_large) sum += totalBoxes.extra_large;
    if (totalBoxes.book) sum += totalBoxes.book;
    if (totalBoxes.specialty) sum += totalBoxes.specialty;
    
    return sum;
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-6">
        <p className="text-gray-600">
          Upload a photo to automatically identify and inventory items in the image
        </p>
      </div>

      {/* Upload Section */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          onChange={handleFileSelect}
          className="hidden"
        />

        {!selectedFile && !isConverting ? (
          <div
            onClick={handleUploadClick}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <Camera className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-lg font-medium text-gray-700 mb-2">
              Click to upload a photo
            </p>
            <p className="text-sm text-gray-500">
              Support for JPG, PNG, GIF, HEIC, HEIF up to 10MB
            </p>
          </div>
        ) : isConverting ? (
          <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50">
            <Loader2 className="mx-auto h-12 w-12 text-blue-500 animate-spin mb-4" />
            <p className="text-lg font-medium text-blue-700 mb-2">
              Converting HEIC image...
            </p>
            <p className="text-sm text-blue-600">
              Please wait while we convert your image to a compatible format
            </p>
          </div>
        ) : selectedFile ? (
          <div className="space-y-4">
            <div className="relative">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-1/2 max-w-md mx-auto rounded-lg shadow-md"
                />
              ) : (
                <div className="w-1/2 max-w-md mx-auto rounded-lg shadow-md bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center p-8">
                  <Camera className="h-12 w-12 text-gray-400 mb-2" />
                  <p className="text-sm font-medium text-gray-600">HEIC Image Selected</p>
                  <p className="text-xs text-gray-500 text-center mt-1">
                    {selectedFile.name}
                    <br />
                    Preview will be available after analysis
                  </p>
                </div>
              )}
              <button
                onClick={handleReset}
                className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600 transition-colors cursor-pointer focus:ring-2 focus:ring-red-500 focus:outline-none"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {/* Image Description Input */}
            <div className="max-w-md mx-auto">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Add a description (optional)
              </label>
              <input
                id="description"
                type="text"
                value={imageDescription}
                onChange={(e) => setImageDescription(e.target.value)}
                placeholder="e.g., Living room items, Kitchen inventory..."
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Action Buttons */}
      {selectedFile && !analysisResult && (
        <div className="text-center mb-6">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || isConverting}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Analyzing & Saving...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Analyze Items
              </>
            )}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Your image will be saved to the project gallery
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className={`border rounded-lg p-4 mb-6 ${
          error.includes('HEIC conversion is having issues') 
            ? 'bg-yellow-50 border-yellow-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          <p className={`font-medium ${
            error.includes('HEIC conversion is having issues')
              ? 'text-yellow-800'
              : 'text-red-800'
          }`}>
            {error.includes('HEIC conversion is having issues') ? 'Notice' : 'Error'}
          </p>
          <p className={
            error.includes('HEIC conversion is having issues')
              ? 'text-yellow-600'
              : 'text-red-600'
          }>
            {error}
          </p>
          {error.includes('HEIC') && (
            <div className="mt-3 text-sm text-gray-700">
              <p className="font-medium">Tips for HEIC files:</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Try using Safari browser (better HEIC support)</li>
                <li>Convert to JPEG using your iPhone's Photos app</li>
                <li>Take new photos in JPEG format (iPhone Settings → Camera → Formats → Most Compatible)</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Results Display */}
      {analysisResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <h2 className="text-xl font-bold text-green-900 mb-4">
            Analysis Results
          </h2>

          {/* Summary */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary</h3>
            <p className="text-gray-700 bg-white p-3 rounded border">
              {analysisResult.summary}
            </p>
          </div>

          {/* Database Status */}
          {analysisResult.savedToDatabase !== undefined && (
            <div className={`mb-6 p-3 rounded ${analysisResult.savedToDatabase ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {analysisResult.savedToDatabase 
                ? '✅ Items and image have been saved to your project.' 
                : '⚠️ Items could not be saved to the database. They are still available in this session.'}
              {analysisResult.dbError && <p className="mt-1 text-sm">{analysisResult.dbError}</p>}
            </div>
          )}

          {/* Box Summary */}
          {analysisResult.total_boxes && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Box Requirements
              </h3>
              <div className="bg-white p-4 rounded-lg border shadow-sm">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {analysisResult.total_boxes.small && analysisResult.total_boxes.small > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.small} Small</span>
                      <span className="text-xs text-gray-500">(16⅜" x 12⅝" x 12⅝")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.medium && analysisResult.total_boxes.medium > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.medium} Medium</span>
                      <span className="text-xs text-gray-500">(18⅛" x 18" x 16")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.large && analysisResult.total_boxes.large > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.large} Large</span>
                      <span className="text-xs text-gray-500">(18" x 18" x 24")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.extra_large && analysisResult.total_boxes.extra_large > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.extra_large} Extra-Large</span>
                      <span className="text-xs text-gray-500">(24" x 18" x 24")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.book && analysisResult.total_boxes.book > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.book} Book</span>
                      <span className="text-xs text-gray-500">(12" x 12" x 12")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.specialty && analysisResult.total_boxes.specialty > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.specialty} Specialty</span>
                      <span className="text-xs text-gray-500">(Various sizes)</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                  <div className="flex items-center gap-2">
                    <BoxesIcon className="h-5 w-5 text-blue-500" />
                    <span className="font-medium text-blue-800">
                      Total Boxes: {calculateTotalBoxes(analysisResult.total_boxes)}
                    </span>
                  </div>
                  <p className="text-sm text-blue-600 mt-1">
                    These are U-Haul standard box recommendations based on item dimensions and weight.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Items List */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Identified Items ({analysisResult.items.length})
            </h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {analysisResult.items.map((item, index) => (
                <div
                  key={index}
                  className="bg-white p-4 rounded-lg border shadow-sm"
                >
                  <h4 className="font-semibold text-gray-900 mb-1">
                    {item.name}
                  </h4>
                  {item.description && (
                    <p className="text-sm text-gray-600 mb-2">
                      {item.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    {item.location && (
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                        {item.location}
                      </span>
                    )}
                    {item.category && (
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {item.category}
                      </span>
                    )}
                    {item.quantity && (
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded">
                        Qty: {item.quantity}
                      </span>
                    )}
                    {item.cuft && (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                        {item.cuft} cuft
                      </span>
                    )}
                    {item.weight && (
                      <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                        {item.weight} lbs
                      </span>
                    )}
                    {item.fragile && (
                      <span className="bg-red-100 text-red-800 px-2 py-1 rounded">
                        Fragile
                      </span>
                    )}
                    {item.special_handling && (
                      <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        {item.special_handling}
                      </span>
                    )}
                    {item.box_recommendation && (
                      <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {item.box_recommendation.box_quantity} {item.box_recommendation.box_type} Box{item.box_recommendation.box_quantity > 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reset Button */}
          <div className="mt-6 text-center">
            <button
              onClick={handleReset}
              className="bg-gray-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors cursor-pointer focus:ring-2 focus:ring-gray-500 focus:outline-none"
            >
              Analyze Another Photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}