'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle, Loader2 } from 'lucide-react';

interface FormField {
  fieldId: string;
  label: string;
  required: boolean;
}

interface FormConfig {
  formTitle: string;
  formSubtitle: string;
  buttonText: string;
  buttonColor: string;
  successMessage: string;
  fields: FormField[];
}

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

export default function EmbeddableFormPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [config, setConfig] = useState<FormConfig | null>(null);
  const [branding, setBranding] = useState<BrandingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Make body transparent for embedding
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  // Post height to parent for iframe auto-resize
  const sendHeight = useCallback(() => {
    const height = document.body.scrollHeight;
    window.parent.postMessage({ type: 'qubesheets-form-resize', height }, '*');
  }, []);

  useEffect(() => {
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [submitted, loading, sendHeight]);

  useEffect(() => {
    if (!orgId) return;
    const fetchConfig = async () => {
      try {
        const response = await fetch(`/api/external/form-config/${orgId}`);
        if (!response.ok) {
          setError('This form is not available.');
          setLoading(false);
          return;
        }
        const data = await response.json();
        setConfig(data.formConfig);
        setBranding(data.branding);
      } catch {
        setError('Failed to load form.');
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [orgId]);

  const handleChange = (fieldId: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
    setFormError(null);
  };

  const formatPhoneInput = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const getInputType = (fieldId: string): string => {
    switch (fieldId) {
      case 'email': return 'email';
      case 'phone': return 'tel';
      case 'moveDate': return 'date';
      default: return 'text';
    }
  };

  const getPlaceholder = (fieldId: string, label: string): string => {
    switch (fieldId) {
      case 'phone': return '(425) 555-1234';
      case 'email': return 'john@example.com';
      default: return label;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;

    // Validate required fields
    for (const field of config.fields) {
      if (field.required && !formData[field.fieldId]?.trim()) {
        setFormError(`${field.label} is required.`);
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/external/form-submit/${orgId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok) {
        setFormError(result.error || 'Failed to submit form.');
        setSubmitting(false);
        return;
      }

      setSuccessMessage(result.message || config.successMessage);
      setSubmitted(true);
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="flex items-center justify-center min-h-[300px] p-6">
        <p className="text-gray-500 text-sm">{error || 'Form not available.'}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Submitted!</h2>
        <p className="text-gray-600">{successMessage}</p>
      </div>
    );
  }

  // Group firstName and lastName side by side
  const firstNameField = config.fields.find((f) => f.fieldId === 'firstName');
  const lastNameField = config.fields.find((f) => f.fieldId === 'lastName');
  const otherFields = config.fields.filter(
    (f) => f.fieldId !== 'firstName' && f.fieldId !== 'lastName'
  );

  return (
    <div className="w-full max-w-lg mx-auto">
      <form onSubmit={handleSubmit} className="rounded-xl shadow-lg border border-gray-200 p-8">
        {/* Branding logo */}
        {branding?.companyLogo && (
          <div className="flex justify-center mb-4">
            <img
              src={branding.companyLogo}
              alt={branding.companyName || 'Company logo'}
              className="h-12 object-contain"
            />
          </div>
        )}

        {/* Title and subtitle */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">{config.formTitle}</h2>
          {config.formSubtitle && (
            <p className="text-gray-500 mt-1">{config.formSubtitle}</p>
          )}
        </div>

        <div className="space-y-4">
          {/* First Name + Last Name row */}
          {(firstNameField || lastNameField) && (
            <div className="grid grid-cols-2 gap-3">
              {firstNameField && (
                <input
                  type="text"
                  placeholder={`${firstNameField.label}${firstNameField.required ? ' *' : ''}`}
                  value={formData.firstName || ''}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required={firstNameField.required}
                />
              )}
              {lastNameField && (
                <input
                  type="text"
                  placeholder={`${lastNameField.label}${lastNameField.required ? ' *' : ''}`}
                  value={formData.lastName || ''}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required={lastNameField.required}
                />
              )}
            </div>
          )}

          {/* Other fields */}
          {otherFields.map((field) => (
            <div key={field.fieldId}>
              {field.fieldId === 'moveDate' && (
                <label className="block text-sm font-medium text-gray-700 mb-1 text-center">
                  {field.label}{field.required ? ' *' : ''}
                </label>
              )}
              <input
                type={getInputType(field.fieldId)}
                placeholder={
                  field.fieldId === 'moveDate'
                    ? undefined
                    : `${getPlaceholder(field.fieldId, field.label)}${field.required ? ' *' : ''}`
                }
                value={
                  field.fieldId === 'phone'
                    ? formatPhoneInput(formData.phone || '')
                    : formData[field.fieldId] || ''
                }
                onChange={(e) => {
                  if (field.fieldId === 'phone') {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    handleChange('phone', digits);
                  } else {
                    handleChange(field.fieldId, e.target.value);
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required={field.required}
              />
              {field.fieldId === 'moveDate' && (
                <p className="text-xs text-gray-400 mt-1 text-center">
                  Select your preferred date. We&apos;ll work with you to find the best time.
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Honeypot field - hidden from users */}
        <input
          type="text"
          name="_hp_company"
          value={formData._hp_company || ''}
          onChange={(e) => handleChange('_hp_company', e.target.value)}
          style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }}
          tabIndex={-1}
          autoComplete="off"
        />

        {/* Error message */}
        {formError && (
          <p className="text-red-500 text-sm text-center mt-3">{formError}</p>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={submitting}
          style={{ backgroundColor: config.buttonColor }}
          className="w-full mt-6 text-white font-semibold py-3 px-4 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting...
            </span>
          ) : (
            config.buttonText
          )}
        </button>

        {/* Footer */}
        <p className="text-xs text-gray-400 text-center mt-4">
          * Required fields &bull; No obligation &bull; Response within 24 hours
        </p>
      </form>
    </div>
  );
}
