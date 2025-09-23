'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Key, Plus, Trash2, Copy, Eye, EyeOff, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { toast } from 'sonner';
import ApiDocumentationModal from '@/components/modals/ApiDocumentationModal';

interface ApiKey {
  _id: string;
  name: string;
  keyId: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  isActive: boolean;
  createdBy: string;
}

export default function ApiKeysPage() {
  const { user } = useUser();
  const { organization } = useOrganization();
  
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ key: string; name: string } | null>(null);
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadApiKeys();
  }, [user, organization]);

  const loadApiKeys = async () => {
    try {
      const response = await fetch('/api/api-keys');
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.apiKeys || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading API keys:', error);
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create API key');
      }

      const data = await response.json();
      setNewlyCreatedKey({ key: data.apiKey, name: newKeyName });
      setNewKeyName('');
      setShowCreateForm(false);
      loadApiKeys();
      toast.success('API key created successfully!');
    } catch (error) {
      console.error('Error creating API key:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const deleteApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
      return;
    }

    setDeletingKeys(prev => new Set(prev).add(keyId));
    try {
      const response = await fetch(`/api/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete API key');
      }

      loadApiKeys();
      toast.success('API key deleted successfully');
    } catch (error) {
      console.error('Error deleting API key:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete API key');
    } finally {
      setDeletingKeys(prev => {
        const newSet = new Set(prev);
        newSet.delete(keyId);
        return newSet;
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
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

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Key className="h-6 w-6" />
            <h1 className="text-2xl font-bold">API Keys</h1>
          </div>
          <div className="flex items-center gap-2">
            <ApiDocumentationModal>
              <Button variant="outline" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                API Documentation
              </Button>
            </ApiDocumentationModal>
            <Button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Create API Key
            </Button>
          </div>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="text-gray-500">Loading API keys...</div>
          </div>
        ) : !organization ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <h3 className="font-medium text-yellow-900 mb-2">Organization Required</h3>
            <p className="text-sm text-yellow-700">
              Please select or create an organization to manage API keys.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl">
            <div className="space-y-6">
              {/* Organization Info */}
              {organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Organization API Keys</h3>
                  <p className="text-sm text-blue-700">
                    These API keys will allow programmatic access to <strong>{organization.name}</strong>'s data and resources.
                  </p>
                </div>
              )}

              {/* New Key Created Modal */}
              {newlyCreatedKey && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <h3 className="font-medium text-green-900 mb-2">API Key Created Successfully!</h3>
                  <p className="text-sm text-green-700 mb-4">
                    Please copy your API key now. You won't be able to see it again.
                  </p>
                  <div className="bg-white border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 mb-1">{newlyCreatedKey.name}</p>
                        <code className="text-sm text-gray-600 font-mono break-all">{newlyCreatedKey.key}</code>
                      </div>
                      <Button
                        onClick={() => copyToClipboard(newlyCreatedKey.key)}
                        variant="outline"
                        size="sm"
                        className="ml-4"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    onClick={() => setNewlyCreatedKey(null)}
                    variant="outline"
                    className="mt-4"
                  >
                    I've copied the key
                  </Button>
                </div>
              )}

              {/* Create Form */}
              {showCreateForm && (
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h3 className="text-lg font-medium mb-4">Create New API Key</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        API Key Name
                      </label>
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., Production API, Mobile App, etc."
                        maxLength={50}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Choose a descriptive name to help you identify this key
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={createApiKey}
                        disabled={isCreating || !newKeyName.trim()}
                      >
                        {isCreating ? 'Creating...' : 'Create API Key'}
                      </Button>
                      <Button
                        onClick={() => {
                          setShowCreateForm(false);
                          setNewKeyName('');
                        }}
                        variant="outline"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* API Keys List */}
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-6 border-b">
                  <h3 className="text-lg font-medium">Your API Keys</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Manage your organization's API keys for programmatic access.
                  </p>
                </div>
                
                {apiKeys.length === 0 ? (
                  <div className="p-8 text-center">
                    <Key className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No API Keys</h3>
                    <p className="text-gray-600 mb-4">
                      You haven't created any API keys yet. Create your first one to get started.
                    </p>
                    <Button
                      onClick={() => setShowCreateForm(true)}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Create Your First API Key
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y">
                    {apiKeys.map((apiKey) => (
                      <div key={apiKey._id} className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h4 className="font-medium text-gray-900">{apiKey.name}</h4>
                              <span className={`px-2 py-1 rounded-full text-xs ${
                                apiKey.isActive 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-gray-100 text-gray-800'
                              }`}>
                                {apiKey.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              <p>
                                <span className="font-mono">{apiKey.prefix}•••••••••••••••••••••••••••••••••</span>
                                <Button
                                  onClick={() => copyToClipboard(apiKey.prefix)}
                                  variant="ghost"
                                  size="sm"
                                  className="ml-2 h-6 w-6 p-0"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </p>
                              <p>Created {formatDate(apiKey.createdAt)}</p>
                              {apiKey.lastUsed && (
                                <p>Last used {formatDate(apiKey.lastUsed)}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              onClick={() => deleteApiKey(apiKey.keyId)}
                              disabled={deletingKeys.has(apiKey.keyId)}
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

              {/* API Usage Documentation */}
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900">Using Your API Keys</h3>
                  <ApiDocumentationModal>
                    <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700">
                      <BookOpen className="h-4 w-4 mr-1" />
                      View Full Documentation
                    </Button>
                  </ApiDocumentationModal>
                </div>
                <div className="space-y-3 text-sm text-gray-600">
                  <p>
                    Include your API key in the Authorization header to create projects:
                  </p>
                  <div className="bg-gray-800 text-gray-100 p-3 rounded font-mono text-xs overflow-x-auto">
                    <pre>{`curl -X POST https://your-domain.com/api/external/projects \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"customerName": "John Smith", "phone": "5551234567"}'`}</pre>
                  </div>
                  <p>
                    <strong>Auto SMS:</strong> When a phone number is provided, an upload link is automatically sent to the customer via SMS.
                  </p>
                  <p>
                    <strong>Security:</strong> Keep your API keys secure and never share them publicly. 
                    If compromised, delete the key immediately and create a new one.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <SidebarTrigger />
    </SidebarProvider>
  );
}