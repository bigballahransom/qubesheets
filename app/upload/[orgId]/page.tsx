// app/upload/[orgId]/page.tsx - Global Self-Survey Link
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle, Loader2, Building2, User, Upload as UploadIcon, ArrowRight, Phone } from 'lucide-react';
import CustomerPhotoUploader from '@/components/CustomerPhotoUploader';
import InventoryInstructionsModal from '@/components/InventoryInstructionsModal';
import { toast } from 'sonner';
import Logo from '../../../public/logo';

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

interface OrgConfig {
  branding?: BrandingData | null;
  instructions?: string | null;
}

interface UploadedImage {
  id: string;
  name: string;
  uploadedAt: string;
}

export default function GlobalUploadPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  // Step 1: Customer info
  const [step, setStep] = useState<'info' | 'upload'>('info');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 2: Upload state
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Shared state
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [totalUploadedFiles, setTotalUploadedFiles] = useState(0);
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([]);
  const [showProcessingStatus, setShowProcessingStatus] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);

  // Parse instructions for display
  const parseInstructionsForDisplay = (text: string, companyName: string) => {
    const processedText = text.replace('{companyName}', companyName);
    const lines = processedText.split('\n');

    return lines.map((line, index) => {
      if (line.trim() === '') {
        return <div key={index} className="h-2" />;
      }

      if (line.trim() && !line.trim().startsWith('•') && !line.trim().startsWith('-')) {
        return (
          <h3 key={index} className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            {line.trim()}
          </h3>
        );
      }

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

      return (
        <p key={index} className="text-slate-700 leading-relaxed mb-3">
          {line.trim()}
        </p>
      );
    });
  };

  // Fetch organization config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`/api/upload/${orgId}/config`);

        if (response.ok) {
          const data = await response.json();
          setConfig(data);
        } else {
          // Use defaults if config fetch fails
          setConfig({ branding: null, instructions: null });
        }
      } catch (error) {
        console.log('Could not fetch org config, using defaults:', error);
        setConfig({ branding: null, instructions: null });
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [orgId]);

  // Listen for processing completion
  useEffect(() => {
    if (pendingJobIds.length === 0 || !projectId) {
      setShowProcessingStatus(false);
      return;
    }

    const eventSource = new EventSource(`/api/processing-complete?projectId=${projectId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connection-established') {
          console.log('SSE connection established:', data.connectionId);
          return;
        }

        if (data.type === 'processing-complete' && data.success) {
          console.log('AI analysis completed for image:', data.imageId);

          setPendingJobIds(prev => {
            const updated = prev.slice(1);
            if (updated.length === 0) {
              setShowProcessingStatus(false);
            }
            return updated;
          });

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

    return () => {
      eventSource.close();
    };
  }, [pendingJobIds, projectId]);

  // Format phone number as user types
  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setCustomerPhone(formatted);
  };

  // Handle step 1 form submission
  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = customerName.trim();
    const phoneDigits = customerPhone.replace(/\D/g, '');

    if (!trimmedName) {
      setFormError('Please enter your name');
      return;
    }

    if (phoneDigits.length !== 10) {
      setFormError('Please enter a valid 10-digit phone number');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/upload/${orgId}/create-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: trimmedName,
          customerPhone: phoneDigits,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create project');
      }

      const result = await response.json();

      setUploadToken(result.uploadToken);
      setProjectId(result.projectId);
      setStep('upload');
      setShowInstructionsModal(true);

    } catch (error) {
      console.error('Error creating project:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to continue. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!uploadToken) return;

    setUploading(true);

    const tempImage: UploadedImage = {
      id: `temp-${Date.now()}`,
      name: file.name,
      uploadedAt: new Date().toISOString()
    };
    setUploadedImages(prev => [...prev, tempImage]);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`/api/customer-upload/${uploadToken}/upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        throw new Error(errorData.error || `Upload failed: ${response.status}`);
      }

      const result = await response.json();
      const uploadId = result.imageId || result.videoId;

      if (result.sqsMessageId && result.sqsMessageId !== 'no-analysis-data') {
        setPendingJobIds(prev => [...prev, result.sqsMessageId]);
        setShowProcessingStatus(true);

        if (result.projectId) {
          import('@/lib/simple-realtime').then(({ default: simpleRealTime }) => {
            simpleRealTime.addProcessing(result.projectId, {
              id: uploadId,
              name: file.name,
              type: result.videoId ? 'video' : 'image',
              status: result.videoId ? 'AI video analysis in progress...' : 'AI analysis in progress...',
              source: 'customer_upload'
            });
          }).catch(console.error);
        }
      }

      setUploadedImages(prev => prev.map(img =>
        img.id === tempImage.id
          ? { id: uploadId, name: file.name, uploadedAt: new Date().toISOString() }
          : img
      ));

      setTotalUploadedFiles(prev => prev + 1);

      return result;

    } catch (err) {
      console.error('Upload error:', err);
      setUploadedImages(prev => prev.filter(img => img.id !== tempImage.id));

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
        style: { background: '#ef4444', color: 'white' }
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
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading...</h2>
            <p className="text-slate-600">Please wait while we set up your upload page...</p>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: Customer Info Form
  if (step === 'info') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              {config?.branding?.companyLogo ? (
                <img
                  src={config.branding.companyLogo}
                  alt={config.branding.companyName}
                  className="w-10 h-10 object-contain rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
              )}
              <div>
                <p className="font-medium text-slate-800">
                  {config?.branding?.companyName || 'Moving Company'}
                </p>
                <p className="text-sm text-slate-500">Self-Survey</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-md mx-auto px-4 py-12">
          <div className="text-center space-y-4 mb-8">
            <h1 className="text-3xl font-bold text-slate-800">
              Upload Your Moving Photos
            </h1>
            <p className="text-slate-600">
              Enter your information to get started with your inventory upload.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 md:p-8">
            <form onSubmit={handleInfoSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                  Your Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    id="name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="John Smith"
                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    disabled={submitting}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    id="phone"
                    value={customerPhone}
                    onChange={handlePhoneChange}
                    placeholder="(555) 123-4567"
                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    disabled={submitting}
                  />
                </div>
              </div>

              {formError && (
                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    Continue to Upload
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="text-center py-8">
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

  // Step 2: Upload Interface
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {config?.branding?.companyLogo ? (
                <img
                  src={config.branding.companyLogo}
                  alt={config.branding.companyName}
                  className="w-10 h-10 object-contain rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
              )}
              <div>
                <p className="font-medium text-slate-800">
                  {config?.branding?.companyName || 'Moving Company'}
                </p>
                <p className="text-sm text-slate-500">Inventory Upload</p>
              </div>
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
            Welcome, {customerName}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 leading-tight">
            Upload Your Moving Photos
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Help us ensure a wonderful moving experience by uploading photos of the belongings moving with you.
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
              customerToken={uploadToken || ''}
              onFileUploaded={(fileName) => {
                setTotalUploadedFiles(prev => prev + 1);
              }}
            />
          </div>
        </div>

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
                        <span>{config?.branding?.companyName || 'Your moving company'} reviews your complete inventory</span>
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

        {/* Instructions Section */}
        {totalUploadedFiles === 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
              <h3 className="text-lg font-semibold text-blue-800">Best Practices</h3>
            </div>

            <div className="p-6">
              <div className="prose prose-slate max-w-none">
                {config?.instructions ? (
                  <div className="space-y-4">
                    {parseInstructionsForDisplay(
                      config.instructions,
                      config.branding?.companyName || 'Your Moving Company'
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                      Upload Tips from {config?.branding?.companyName || 'Your Moving Company'}
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

      {/* Instructions Modal */}
      <InventoryInstructionsModal
        isOpen={showInstructionsModal}
        onClose={() => setShowInstructionsModal(false)}
      />
    </div>
  );
}
