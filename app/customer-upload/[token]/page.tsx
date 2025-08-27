// app/customer-upload/[token]/page.tsx - Modern mobile-responsive design
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle, AlertCircle, Loader2, ImageIcon, Clock, Building2, User, Upload as UploadIcon, ArrowRight } from 'lucide-react';
import CustomerPhotoUploader from '@/components/CustomerPhotoUploader';
import { toast } from 'sonner';
import Logo from '../../../public/logo';

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

interface UploadValidation {
  customerName: string;
  projectName: string;
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
  const token = params.token as string;
  
  const [validation, setValidation] = useState<UploadValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);

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

  // Skip token validation completely - always allow upload
  useEffect(() => {
    // Always allow upload regardless of token
    setValidation({
      customerName: 'Customer',
      projectName: 'Photo Upload',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      isValid: true,
      branding: null,
      instructions: null
    });
    setLoading(false);
  }, []);

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
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`/api/customer-upload/${token}/upload`, {
        method: 'POST',
        body: formData,
        // Add timeout for mobile networks
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload image');
      }

      const result = await response.json();
      
      // Replace temp image with real data
      setUploadedImages(prev => prev.map(img => 
        img.id === tempImage.id 
          ? {
              id: result.imageId,
              name: file.name,
              uploadedAt: new Date().toISOString()
            }
          : img
      ));
      
      toast.success('Photo uploaded successfully! AI analysis in progress...', {
        duration: 4000,
        style: {
          background: '#10b981',
          color: 'white',
        }
      });
      
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
            <p className="text-slate-600 mb-4">Setting up your photo upload...</p>
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
              <h2 className="text-xl font-semibold text-slate-800">Upload Photos</h2>
            </div>
            
            <CustomerPhotoUploader
              onUpload={handleFileUpload}
              uploading={uploading}
            />
          </div>
        </div>

        {/* Upload Success Section */}
        {uploadedImages.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-green-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-800">
                    {uploadedImages.length} Photo{uploadedImages.length !== 1 ? 's' : ''} Uploaded
                  </h3>
                  <p className="text-sm text-green-700">Successfully processed and ready for analysis</p>
                </div>
              </div>
            </div>
            
            <div className="p-6">
              <div className="grid gap-3 mb-6">
                {uploadedImages.map((image) => (
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
              </div>
              
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
        {uploadedImages.length === 0 && (
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
    </div>
  );
}