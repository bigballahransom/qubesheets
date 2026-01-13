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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Check } from 'lucide-react';

interface IArrivalOption {
  id: string;
  type: 'single' | 'window';
  startTime: string;
  endTime?: string;
  label: string;
}

interface Project {
  _id: string;
  name: string;
  customerName: string;
  updatedAt: string;
  jobDate?: string;
  arrivalWindowStart?: string;
  arrivalWindowEnd?: string;
  opportunityType?: string;
  jobType?: string;
}

interface EditJobDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onProjectUpdated: (project: Project) => void;
}

export default function EditJobDetailsModal({
  open,
  onOpenChange,
  project,
  onProjectUpdated,
}: EditJobDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [jobDate, setJobDate] = useState('');
  const [selectedArrivalOption, setSelectedArrivalOption] = useState('');
  const [arrivalOptions, setArrivalOptions] = useState<IArrivalOption[]>([]);
  const [opportunityType, setOpportunityType] = useState('');
  const [jobType, setJobType] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [opportunityTypes, setOpportunityTypes] = useState<string[]>([]);

  // Fetch CRM settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings/crm');
        if (response.ok) {
          const data = await response.json();
          setArrivalOptions(data.arrivalOptions || []);
          setJobTypes(data.jobTypes || []);
          setOpportunityTypes(data.opportunityTypes || []);
        }
      } catch (error) {
        console.error('Error fetching CRM settings:', error);
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    if (open && project) {
      setJobDate(project.jobDate ? new Date(project.jobDate).toISOString().split('T')[0] : '');
      // Find matching arrival option based on project's start/end times
      if (project.arrivalWindowStart) {
        const matchingOption = arrivalOptions.find(opt =>
          opt.startTime === project.arrivalWindowStart &&
          (opt.type === 'single' || opt.endTime === project.arrivalWindowEnd)
        );
        setSelectedArrivalOption(matchingOption?.id || '');
      } else {
        setSelectedArrivalOption('');
      }
      setOpportunityType(project.opportunityType || '');
      setJobType(project.jobType || '');
    }
  }, [open, project, arrivalOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!project) {
      toast.error('No project selected');
      return;
    }

    setLoading(true);

    // Get arrival times from selected option
    const selectedOption = arrivalOptions.find(opt => opt.id === selectedArrivalOption);
    const arrivalWindowStart = selectedOption?.startTime || null;
    const arrivalWindowEnd = selectedOption?.type === 'window' ? selectedOption?.endTime || null : null;

    try {
      const response = await fetch(`/api/projects/${project._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobDate: jobDate ? new Date(jobDate).toISOString() : null,
          arrivalWindowStart,
          arrivalWindowEnd,
          opportunityType: opportunityType || null,
          jobType: jobType || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update job details');
      }

      toast.success('Job details updated successfully');

      onProjectUpdated(result);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating job details:', error);
      toast.error(error.message || 'Failed to update job details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Job Details</DialogTitle>
            <DialogDescription>
              Update the date, time, and job type information.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="jobDate">Job Date</Label>
              <Input
                id="jobDate"
                type="date"
                value={jobDate}
                onChange={(e) => setJobDate(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="arrivalWindow">Arrival Window</Label>
              <Select
                value={selectedArrivalOption}
                onValueChange={setSelectedArrivalOption}
                disabled={loading}
              >
                <SelectTrigger id="arrivalWindow">
                  <SelectValue placeholder="Select arrival time" />
                </SelectTrigger>
                <SelectContent>
                  {arrivalOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="opportunityType">Opportunity Type</Label>
              <Select
                value={opportunityType}
                onValueChange={setOpportunityType}
                disabled={loading}
              >
                <SelectTrigger id="opportunityType">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {opportunityTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="jobType">Job Type</Label>
              <Select
                value={jobType}
                onValueChange={setJobType}
                disabled={loading}
              >
                <SelectTrigger id="jobType">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {jobTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <Button type="submit" disabled={loading}>
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
