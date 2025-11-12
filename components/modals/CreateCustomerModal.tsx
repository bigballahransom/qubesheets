'use client';

import { useState, ReactNode } from 'react';

// Phone formatting utilities
const formatPhoneNumber = (value: string, previousValue: string = ''): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '');
  
  // If user is deleting and we have fewer digits than before, don't add formatting yet
  const prevDigits = previousValue.replace(/\D/g, '');
  const isDeleting = digits.length < prevDigits.length;
  
  // Limit to 10 digits
  const limitedDigits = digits.slice(0, 10);
  
  // If empty or deleting and less than 4 digits, return just the digits
  if (limitedDigits.length === 0) {
    return '';
  }
  
  if (isDeleting && limitedDigits.length <= 3) {
    return limitedDigits;
  }
  
  // Format as (xxx) xxx-xxxx
  if (limitedDigits.length >= 7) {
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
  } else if (limitedDigits.length >= 4) {
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
  } else if (limitedDigits.length >= 1) {
    return isDeleting ? limitedDigits : `(${limitedDigits}`;
  }
  
  return limitedDigits;
};

const formatPhoneForAPI = (formattedPhone: string): string => {
  // Extract digits only
  const digits = formattedPhone.replace(/\D/g, '');
  // Return in standard format if we have 10 digits
  return digits.length === 10 ? `+1${digits}` : '';
};

// Email validation
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface CreateCustomerModalProps {
  children: ReactNode;
  onCustomerCreated?: (customer: any) => void;
}

interface CustomerFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveDate: string;
  referralSource: string;
}

const referralSources = [
  'Google Search',
  'Social Media', 
  'Referral',
  'Website',
  'Advertisement',
  'Cold Call',
  'Other'
];

export default function CreateCustomerModal({ children, onCustomerCreated }: CreateCustomerModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<CustomerFormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    moveDate: '',
    referralSource: ''
  });
  const [errors, setErrors] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    referralSource: ''
  });

  const handleInputChange = (field: keyof CustomerFormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    let value = e.target.value;
    
    // Handle phone formatting
    if (field === 'phone') {
      value = formatPhoneNumber(value, formData.phone);
      
      // Validate phone
      const digits = value.replace(/\D/g, '');
      if (value && digits.length > 0 && digits.length !== 10) {
        setErrors(prev => ({ ...prev, phone: 'Phone number must be 10 digits' }));
      } else {
        setErrors(prev => ({ ...prev, phone: '' }));
      }
    }
    
    // Handle email validation
    if (field === 'email' && value) {
      if (!isValidEmail(value)) {
        setErrors(prev => ({ ...prev, email: 'Please enter a valid email address' }));
      } else {
        setErrors(prev => ({ ...prev, email: '' }));
      }
    }
    
    // Handle required field validation
    if (['firstName', 'lastName'].includes(field)) {
      if (!value.trim()) {
        setErrors(prev => ({ ...prev, [field]: `${field === 'firstName' ? 'First' : 'Last'} name is required` }));
      } else {
        setErrors(prev => ({ ...prev, [field]: '' }));
      }
    }
    
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSelectChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      referralSource: value
    }));
    
    // Clear referral source error
    setErrors(prev => ({ ...prev, referralSource: '' }));
  };

  const resetForm = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      moveDate: '',
      referralSource: ''
    });
    setErrors({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      referralSource: ''
    });
  };

  const validateForm = (): boolean => {
    const newErrors = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      referralSource: ''
    };

    // Validate required fields
    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }
    
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else {
      const digits = formData.phone.replace(/\D/g, '');
      if (digits.length !== 10) {
        newErrors.phone = 'Phone number must be 10 digits';
      }
    }
    
    if (!formData.referralSource) {
      newErrors.referralSource = 'Referral source is required';
    }

    setErrors(newErrors);
    
    // Return true if no errors
    return Object.values(newErrors).every(error => error === '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate form before submission
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);

    try {
      // Format phone number for API
      const submitData = {
        ...formData,
        phone: formatPhoneForAPI(formData.phone)
      };

      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create customer');
      }

      toast.success('Customer created successfully');

      resetForm();
      setOpen(false);
      
      if (onCustomerCreated) {
        onCustomerCreated(result);
      }

    } catch (error: any) {
      console.error('Error creating customer:', error);
      toast.error(error.message || 'Failed to create customer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>
              Create a new customer record for your CRM system.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange('firstName')}
                  placeholder="Enter first name"
                  className={errors.firstName ? 'border-red-500' : ''}
                  disabled={loading}
                  required
                />
                {errors.firstName && (
                  <p className="text-sm text-red-500">{errors.firstName}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange('lastName')}
                  placeholder="Enter last name"
                  className={errors.lastName ? 'border-red-500' : ''}
                  disabled={loading}
                  required
                />
                {errors.lastName && (
                  <p className="text-sm text-red-500">{errors.lastName}</p>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange('email')}
                placeholder="Enter email address"
                className={errors.email ? 'border-red-500' : ''}
                disabled={loading}
                required
              />
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={handleInputChange('phone')}
                placeholder="(555) 123-4567"
                className={errors.phone ? 'border-red-500' : ''}
                disabled={loading}
                required
              />
              {errors.phone && (
                <p className="text-sm text-red-500">{errors.phone}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="moveDate">Move Date</Label>
              <Input
                id="moveDate"
                type="date"
                value={formData.moveDate}
                onChange={handleInputChange('moveDate')}
                disabled={loading}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="referralSource">Referral Source</Label>
              <Select value={formData.referralSource} onValueChange={handleSelectChange}>
                <SelectTrigger className={errors.referralSource ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select referral source" />
                </SelectTrigger>
                <SelectContent>
                  {referralSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.referralSource && (
                <p className="text-sm text-red-500">{errors.referralSource}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Customer'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}