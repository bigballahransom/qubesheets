'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Key, Plus, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() })
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
    if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) return;

    setDeletingKeys((prev) => new Set(prev).add(keyId));
    try {
      const response = await fetch(`/api/api-keys/${keyId}`, { method: 'DELETE' });
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
      setDeletingKeys((prev) => {
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
      minute: '2-digit'
    });
  };

  return (
    <SettingsPageShell
      title="API Keys"
      subtitle="Programmatic access to your organization's data."
      icon={Key}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      headerAction={
        organization && (
          <Button onClick={() => setShowCreateForm(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Create API Key
          </Button>
        )
      }
    >
      <div className="space-y-6">
        {/* Newly created key reveal */}
        {newlyCreatedKey && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <h3 className="font-medium text-green-900 mb-2">API Key Created</h3>
            <p className="text-sm text-green-700 mb-4">
              Please copy your API key now. You won&apos;t be able to see it again.
            </p>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 mb-1">{newlyCreatedKey.name}</p>
                  <code className="block text-sm text-gray-600 font-mono break-all">{newlyCreatedKey.key}</code>
                </div>
                <Button onClick={() => copyToClipboard(newlyCreatedKey.key)} variant="outline" size="sm">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button onClick={() => setNewlyCreatedKey(null)} variant="outline" className="mt-4">
              I&apos;ve copied the key
            </Button>
          </div>
        )}

        {/* Create form */}
        {showCreateForm && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Create New API Key</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">API Key Name</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Production API, Mobile App, etc."
                  maxLength={50}
                />
                <p className="text-xs text-gray-500 mt-1">Choose a descriptive name to help you identify this key.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={createApiKey} disabled={isCreating || !newKeyName.trim()}>
                  {isCreating ? 'Creating…' : 'Create API Key'}
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

        {/* List */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-200">
            <h3 className="text-lg font-medium">Your API Keys</h3>
            <p className="text-sm text-gray-500 mt-1">Manage your organization&apos;s API keys for programmatic access.</p>
          </div>

          {apiKeys.length === 0 ? (
            <div className="p-10 text-center">
              <Key className="h-10 w-10 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-medium text-gray-900 mb-1">No API Keys</h3>
              <p className="text-sm text-gray-600 mb-4">You haven&apos;t created any API keys yet.</p>
              <Button onClick={() => setShowCreateForm(true)} size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Create your first API key
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {apiKeys.map((apiKey) => (
                <li key={apiKey._id} className="p-5 hover:bg-gray-50/60 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-gray-900 truncate">{apiKey.name}</h4>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            apiKey.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {apiKey.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 space-y-0.5">
                        <p className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs">{apiKey.prefix}•••••••••••••••••••••••••••••••••</span>
                          <Button onClick={() => copyToClipboard(apiKey.prefix)} variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <Copy className="h-3 w-3" />
                          </Button>
                        </p>
                        <p className="text-xs text-gray-500">Created {formatDate(apiKey.createdAt)}</p>
                        {apiKey.lastUsed && <p className="text-xs text-gray-500">Last used {formatDate(apiKey.lastUsed)}</p>}
                      </div>
                    </div>
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
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Usage docs */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-medium text-gray-900 mb-2">Using Your API Keys</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <p>Include your API key in the Authorization header to create projects:</p>
            <div className="bg-gray-900 text-gray-100 p-3 rounded-md font-mono text-xs overflow-x-auto">
              <pre>{`POST https://your-domain.com/api/external/projects \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"customerName": "John Smith", "phone": "5551234567"}'`}</pre>
            </div>
            <p>
              <strong>Auto SMS:</strong> When a phone number is provided, an upload link is automatically sent to the customer via SMS.
            </p>
            <p>
              <strong>Security:</strong> Keep your API keys secure and never share them publicly. If compromised, delete the key immediately and create a new one.
            </p>
          </div>
        </div>
      </div>
    </SettingsPageShell>
  );
}
