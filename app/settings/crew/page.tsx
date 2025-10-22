'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Users, Plus, Trash2, Edit2, Phone, User } from 'lucide-react';

// Phone formatting utilities (matching CreateProjectModal)
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

const formatPhoneForStorage = (formattedPhone: string): string => {
  // Extract digits only for storage
  const digits = formattedPhone.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : '';
};
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

interface CrewMember {
  _id: string;
  name: string;
  phone: string;
  createdAt: string;
  isActive: boolean;
  createdBy: string;
}

export default function CrewPage() {
  const { user } = useUser();
  const { organization } = useOrganization();
  
  const [loading, setLoading] = useState(true);
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingMember, setEditingMember] = useState<CrewMember | null>(null);
  const [formData, setFormData] = useState({ name: '', phone: '' });
  const [phoneError, setPhoneError] = useState('');
  const [deletingMembers, setDeletingMembers] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadCrewMembers();
  }, [user, organization]);

  const loadCrewMembers = async () => {
    try {
      const response = await fetch('/api/crew');
      if (response.ok) {
        const data = await response.json();
        setCrewMembers(data.crewMembers || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading crew members:', error);
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '' });
    setShowCreateForm(false);
    setEditingMember(null);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    // Validate phone number has exactly 10 digits
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      toast.error('Phone number must be exactly 10 digits');
      return;
    }

    setIsCreating(true);
    try {
      const url = editingMember ? `/api/crew/${editingMember._id}` : '/api/crew';
      const method = editingMember ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          phone: formatPhoneForStorage(formData.phone.trim()),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${editingMember ? 'update' : 'create'} crew member`);
      }

      resetForm();
      loadCrewMembers();
      toast.success(`Crew member ${editingMember ? 'updated' : 'created'} successfully!`);
    } catch (error) {
      console.error(`Error ${editingMember ? 'updating' : 'creating'} crew member:`, error);
      toast.error(error instanceof Error ? error.message : `Failed to ${editingMember ? 'update' : 'create'} crew member`);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this crew member? This action cannot be undone.')) {
      return;
    }

    setDeletingMembers(prev => new Set(prev).add(memberId));
    try {
      const response = await fetch(`/api/crew/${memberId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove crew member');
      }

      loadCrewMembers();
      toast.success('Crew member removed successfully');
    } catch (error) {
      console.error('Error removing crew member:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to remove crew member');
    } finally {
      setDeletingMembers(prev => {
        const newSet = new Set(prev);
        newSet.delete(memberId);
        return newSet;
      });
    }
  };

  const startEdit = (member: CrewMember) => {
    setEditingMember(member);
    // Format the stored phone number for display
    const displayPhone = member.phone.startsWith('+1') 
      ? formatPhoneNumber(member.phone.slice(2)) 
      : formatPhoneNumber(member.phone.replace(/\D/g, ''));
    setFormData({ name: member.name, phone: displayPhone });
    setShowCreateForm(true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPhoneForDisplay = (phone: string) => {
    // Handle stored format (+1xxxxxxxxxx)
    if (phone.startsWith('+1')) {
      const digits = phone.slice(2);
      if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      }
    }
    // Handle other formats
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const formattedValue = formatPhoneNumber(newValue, formData.phone);
    setFormData(prev => ({ ...prev, phone: formattedValue }));
    
    // Clear phone error when user starts typing
    if (phoneError) {
      setPhoneError('');
    }
  };

  return (
    <>
      <SidebarProvider>
      <AppSidebar />
      <DesktopHeaderBar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Crew Members</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Crew Member
            </Button>
          </div>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="text-gray-500">Loading crew members...</div>
          </div>
        ) : !organization ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <h3 className="font-medium text-yellow-900 mb-2">Organization Required</h3>
            <p className="text-sm text-yellow-700">
              Please select or create an organization to manage crew members.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl">
            <div className="space-y-6">
              {/* Organization Info */}
              {organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Organization Crew</h3>
                  <p className="text-sm text-blue-700">
                    Manage crew members for <strong>{organization.name}</strong>. These contacts can be used for project assignments and notifications.
                  </p>
                </div>
              )}

              {/* Create/Edit Form */}
              {showCreateForm && (
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h3 className="text-lg font-medium mb-4">
                    {editingMember ? 'Edit Crew Member' : 'Add New Crew Member'}
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Name
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., John Smith"
                        maxLength={100}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={handlePhoneChange}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                          phoneError ? 'border-red-500' : ''
                        }`}
                        placeholder="(555) 123-4567"
                      />
                      {phoneError && (
                        <p className="text-xs text-red-500 mt-1">{phoneError}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        Enter 10-digit phone number for SMS notifications and contact purposes
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSubmit}
                        disabled={isCreating || !formData.name.trim() || !formData.phone.trim()}
                      >
                        {isCreating ? (editingMember ? 'Updating...' : 'Adding...') : (editingMember ? 'Update Member' : 'Add Member')}
                      </Button>
                      <Button
                        onClick={resetForm}
                        variant="outline"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Crew Members List */}
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-6 border-b">
                  <h3 className="text-lg font-medium">Your Crew</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Manage your organization's crew members and their contact information.
                  </p>
                </div>
                
                {crewMembers.length === 0 ? (
                  <div className="p-8 text-center">
                    <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Crew Members</h3>
                    <p className="text-gray-600 mb-4">
                      You haven't added any crew members yet. Add your first one to get started.
                    </p>
                    <Button
                      onClick={() => setShowCreateForm(true)}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add Your First Crew Member
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y">
                    {crewMembers.map((member) => (
                      <div key={member._id} className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <User className="h-5 w-5 text-blue-500" />
                              <h4 className="font-medium text-gray-900">{member.name}</h4>
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4" />
                                <span className="font-mono">{formatPhoneForDisplay(member.phone)}</span>
                              </div>
                              <p>Added {formatDate(member.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              onClick={() => startEdit(member)}
                              variant="ghost"
                              size="sm"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => deleteMember(member._id)}
                              disabled={deletingMembers.has(member._id)}
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Usage Information */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="font-medium text-gray-900 mb-3">About Crew Management</h3>
                <div className="space-y-3 text-sm text-gray-600">
                  <p>
                    <strong>Contact Information:</strong> Store crew member contact details for easy project coordination and communication.
                  </p>
                  <p>
                    <strong>Project Assignment:</strong> Crew members can be assigned to projects and receive SMS notifications for updates.
                  </p>
                  <p>
                    <strong>Organization Scope:</strong> Crew members are specific to your organization and can only be managed by organization members.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}