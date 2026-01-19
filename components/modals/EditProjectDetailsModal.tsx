'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Check } from 'lucide-react';

const formatPhoneNumber = (value: string, previousValue: string = ''): string => {
  const digits = value.replace(/\D/g, '');
  const prevDigits = previousValue.replace(/\D/g, '');
  const isDeleting = digits.length < prevDigits.length;
  const limitedDigits = digits.slice(0, 10);

  if (limitedDigits.length === 0) {
    return '';
  }

  if (isDeleting && limitedDigits.length <= 3) {
    return limitedDigits;
  }

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
  const digits = formattedPhone.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : '';
};

const formatPhoneForDisplay = (apiPhone: string | undefined): string => {
  if (!apiPhone) return '';
  const digits = apiPhone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length === 10) {
    return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
  }
  return apiPhone;
};

interface Project {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  customerEmail?: string;
}

interface EditProjectDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onProjectUpdated: (project: Project) => void;
  showEmail?: boolean;
}

export default function EditProjectDetailsModal({
  open,
  onOpenChange,
  project,
  onProjectUpdated,
  showEmail = false,
}: EditProjectDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [phoneError, setPhoneError] = useState('');

  useEffect(() => {
    if (open && project) {
      setName(project.name || '');
      setPhone(formatPhoneForDisplay(project.phone));
      setEmail(project.customerEmail || project.email || '');
      setPhoneError('');
    }
  }, [open, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Project name is required');
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (phone.trim() && phoneDigits.length !== 10) {
      toast.error('Phone number must be 10 digits');
      return;
    }

    setLoading(true);

    try {
      const updateData: any = {
        name: name.trim(),
        phone: phone.trim() ? formatPhoneForAPI(phone.trim()) : '',
      };

      if (showEmail) {
        updateData.customerEmail = email.trim() || '';
      }

      const response = await fetch(`/api/projects/${project._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update project');
      }

      toast.success('Project updated successfully');

      onProjectUpdated(result);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating project:', error);
      toast.error(error.message || 'Failed to update project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Project Details</DialogTitle>
            <DialogDescription>
              Update project information.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">
                Project Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer Name"
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  const formatted = formatPhoneNumber(e.target.value, phone);
                  setPhone(formatted);

                  const digits = formatted.replace(/\D/g, '');
                  if (formatted && digits.length > 0 && digits.length !== 10) {
                    setPhoneError('Phone number must be 10 digits');
                  } else {
                    setPhoneError('');
                  }
                }}
                placeholder="(555) 123-4567"
                className={phoneError ? 'border-red-500' : ''}
                disabled={loading}
              />
              {phoneError && (
                <p className="text-sm text-red-500">{phoneError}</p>
              )}
            </div>

            {showEmail && (
              <div className="grid gap-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@example.com"
                  disabled={loading}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
