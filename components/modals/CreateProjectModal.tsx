'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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

const formatPhoneForTwilio = (formattedPhone: string): string => {
  // Extract digits only
  const digits = formattedPhone.replace(/\D/g, '');
  // Return in Twilio format +1xxxxxxxxxx if we have 10 digits
  return digits.length === 10 ? `+1${digits}` : '';
};

interface CreateProjectModalProps {
  children?: React.ReactNode;
  onProjectCreated?: (project: any) => void;
}

export default function CreateProjectModal({ children, onProjectCreated }: CreateProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();

  const createProject = async () => {
    if (!customerName.trim()) return;
    
    setIsCreating(true);
    
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: customerName.trim(),
          customerName: customerName.trim(),
          phone: phone.trim() ? formatPhoneForTwilio(phone.trim()) : undefined,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create project');
      }
      
      const project = await response.json();
      
      toast.success('Project created successfully!', {
        description: `${project.name} is ready to use.`
      });
      
      // Clear the form
      setCustomerName('');
      setPhone('');
      setPhoneError('');
      setOpen(false);
      
      // Call the callback if provided
      if (onProjectCreated) {
        onProjectCreated(project);
      }
      
      // Navigate to the new project
      router.push(`/projects/${project._id}`);
    } catch (err) {
      console.error('Error creating project:', err);
      toast.error('Failed to create project', {
        description: 'Please try again or contact support.'
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setCustomerName('');
      setPhone('');
      setPhoneError('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createProject();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Enter customer information for your new project.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customerName">Customer Name</Label>
            <Input
              id="customerName"
              type="text"
              placeholder="Customer Name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={isCreating}
              autoFocus
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number (Optional)</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => {
                const formatted = formatPhoneNumber(e.target.value, phone);
                setPhone(formatted);
                
                // Validate phone number
                const digits = formatted.replace(/\D/g, '');
                if (formatted && digits.length > 0 && digits.length !== 10) {
                  setPhoneError('Phone number must be 10 digits');
                } else {
                  setPhoneError('');
                }
              }}
              disabled={isCreating}
              className={phoneError ? 'border-red-500' : ''}
            />
            {phoneError && (
              <p className="text-sm text-red-500">{phoneError}</p>
            )}
          </div>
          
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!customerName.trim() || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}