'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  ExternalLink, 
  CheckCircle, 
  AlertCircle, 
  Settings, 
  Trash2,
  Info
} from 'lucide-react';
import { toast } from 'sonner';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';

interface IntegrationData {
  enabled: boolean;
  configured: boolean;
  webhookUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  syncHistory?: Array<{
    projectId: string;
    syncedAt: string;
    itemCount: number;
    success: boolean;
    error?: string;
  }>;
}

export default function SupermoveSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [integration, setIntegration] = useState<IntegrationData | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  // Get user's organization
  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        const response = await fetch('/api/user/organization');
        if (response.ok) {
          const data = await response.json();
          setOrganizationId(data.organizationId);
        } else {
          throw new Error('Failed to get organization');
        }
      } catch (error) {
        console.error('Error fetching organization:', error);
        toast.error('Failed to load organization information');
      }
    };

    fetchOrganization();
  }, []);

  // Fetch existing integration
  useEffect(() => {
    if (!organizationId) return;

    const fetchIntegration = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/organizations/${organizationId}/supermove`);
        if (response.ok) {
          const data = await response.json();
          setIntegration(data);
          if (data.configured) {
            // Don't set the full webhook URL for security - just show it's configured
            setWebhookUrl(''); 
          }
        }
      } catch (error) {
        console.error('Error fetching integration:', error);
        toast.error('Failed to load Supermove settings');
      }
      setLoading(false);
    };

    fetchIntegration();
  }, [organizationId]);

  const handleSave = async () => {
    if (!webhookUrl.trim()) {
      toast.error('Webhook URL is required');
      return;
    }

    if (!webhookUrl.includes('supermove')) {
      toast.error('Please enter a valid Supermove webhook URL');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/supermove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhookUrl: webhookUrl.trim(),
          enabled: true
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setIntegration(data.integration);
        setWebhookUrl(''); // Clear input for security
        toast.success('Supermove integration saved successfully!');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save integration');
      }
    } catch (error) {
      console.error('Error saving integration:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save Supermove integration');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!integration?.configured) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/supermove`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: !integration.enabled
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setIntegration(prev => prev ? {
          ...prev,
          enabled: data.enabled
        } : null);
        toast.success(`Supermove integration ${data.enabled ? 'enabled' : 'disabled'}`);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update integration');
      }
    } catch (error) {
      console.error('Error updating integration:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update integration');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete the Supermove integration? This cannot be undone.')) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/supermove`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setIntegration(null);
        setWebhookUrl('');
        toast.success('Supermove integration deleted successfully');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete integration');
      }
    } catch (error) {
      console.error('Error deleting integration:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete integration');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="pl-64 pt-16 min-h-screen bg-gray-50">
          <div className="container mx-auto p-6 max-w-4xl">
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="ml-2">Loading Supermove settings...</span>
            </div>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <DesktopHeaderBar />
      <div className="pl-64 pt-16 min-h-screen bg-gray-50">
        <div className="container mx-auto p-6 max-w-4xl">
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-4">
              <img src="/supermove.png" alt="Supermove" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Supermove Integration</h1>
                <p className="text-gray-600">
                  Connect QubeSheets with Supermove to automatically sync inventory surveys
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Status Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Integration Status
                </CardTitle>
                <CardDescription>
                  Current status of your Supermove integration
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  {integration?.configured ? (
                    <>
                      {integration.enabled ? (
                        <Badge variant="default" className="bg-green-100 text-green-700">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Disabled
                        </Badge>
                      )}
                      <span className="text-sm text-gray-600">
                        Configured on {integration.createdAt ? new Date(integration.createdAt).toLocaleDateString() : 'Unknown'}
                      </span>
                    </>
                  ) : (
                    <Badge variant="secondary">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Configuration Card */}
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>
                  Set up your Supermove webhook URL to enable automatic inventory sync
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {integration?.configured && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-blue-600" />
                      <div className="flex-1">
                        <p className="text-sm text-blue-700">
                          Webhook URL is configured. Enter a new URL below to update it.
                        </p>
                        {integration.webhookUrl && (
                          <p className="text-xs text-blue-600 mt-1 font-mono">
                            Current: {integration.webhookUrl}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="webhookUrl">Supermove Webhook URL</Label>
                  <Input
                    id="webhookUrl"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://api.supermove.com/webhooks/your-unique-url"
                    disabled={saving}
                  />
                  <p className="text-xs text-gray-600">
                    Get this URL from your Supermove Lead Provider settings under "Developer API - Add Survey"
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleSave} 
                    disabled={saving || !webhookUrl.trim()}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      integration?.configured ? 'Update Integration' : 'Save Integration'
                    )}
                  </Button>

                  {integration?.configured && (
                    <Button 
                      variant={integration.enabled ? "outline" : "default"}
                      onClick={handleToggleEnabled}
                      disabled={saving}
                    >
                      {integration.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* How it Works */}
            <Card>
              <CardHeader>
                <CardTitle>How It Works</CardTitle>
                <CardDescription>
                  Understanding the Supermove integration workflow
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">1</div>
                    <div>
                      <p className="font-medium">Create Project with Customer Email</p>
                      <p className="text-sm text-gray-600">When creating projects, the customer email field will be required for Supermove sync</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">2</div>
                    <div>
                      <p className="font-medium">Process Inventory Items</p>
                      <p className="text-sm text-gray-600">Upload photos/videos and process inventory items as usual</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">3</div>
                    <div>
                      <p className="font-medium">One-Time Sync to Supermove</p>
                      <p className="text-sm text-gray-600">Use the "Sync with Supermove" button in the Actions menu to send inventory data</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">4</div>
                    <div>
                      <p className="font-medium">Data Appears in Supermove</p>
                      <p className="text-sm text-gray-600">Inventory items are grouped by room and sent as a survey to the customer's project in Supermove</p>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                    <div className="text-sm text-amber-700">
                      <strong>Important:</strong> Supermove only allows one survey per project. Once synced, you cannot sync again. Future changes must be made directly in Supermove.
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sync History */}
            {integration?.syncHistory && integration.syncHistory.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Syncs</CardTitle>
                  <CardDescription>
                    Last 10 sync operations to Supermove
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {integration.syncHistory.map((sync: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          {sync.success ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-red-600" />
                          )}
                          <div>
                            <p className="font-medium">Project {sync.projectId}</p>
                            {sync.error && (
                              <p className="text-sm text-red-600">{sync.error}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{sync.itemCount} items</p>
                          <p className="text-xs text-gray-600">
                            {new Date(sync.syncedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Danger Zone */}
            {integration?.configured && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-red-700">Danger Zone</CardTitle>
                  <CardDescription>
                    Irreversible actions for this integration
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    variant="destructive" 
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Integration
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-gray-600 mt-2">
                    This will permanently delete the Supermove integration. You'll need to reconfigure it to sync projects again.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}