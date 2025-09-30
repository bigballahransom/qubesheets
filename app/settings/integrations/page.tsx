'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Plug, Save, Key, TestTube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

export default function IntegrationsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  
  // SmartMoving integration state
  const [smartMovingEnabled, setSmartMovingEnabled] = useState(false);
  const [smartMovingClientId, setSmartMovingClientId] = useState('');
  const [smartMovingApiKey, setSmartMovingApiKey] = useState('');
  const [hasExistingIntegration, setHasExistingIntegration] = useState(false);

  useEffect(() => {
    loadIntegrations();
  }, [user, organization]);

  const loadIntegrations = async () => {
    try {
      // Load existing SmartMoving integration
      const response = await fetch('/api/integrations/smartmoving');
      if (response.ok) {
        const data = await response.json();
        if (data.exists) {
          setHasExistingIntegration(true);
          setSmartMovingEnabled(true);
          setSmartMovingClientId(data.integration.smartMovingClientId);
          // API key is not returned for security, just show that it exists
          if (data.integration.hasApiKey) {
            setSmartMovingApiKey('••••••••••••••••');
          }
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading integrations:', error);
      setLoading(false);
    }
  };

  const saveIntegrations = async () => {
    setSaving(true);
    try {
      // Only save if enabled and credentials provided
      if (smartMovingEnabled && smartMovingClientId && smartMovingApiKey && !smartMovingApiKey.includes('•')) {
        const response = await fetch('/api/integrations/smartmoving', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            smartMovingClientId,
            smartMovingApiKey,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save integration');
        }

        toast.success('SmartMoving integration saved successfully!');
        setHasExistingIntegration(true);
      } else if (!smartMovingEnabled && hasExistingIntegration) {
        // Delete integration if disabled
        const response = await fetch('/api/integrations/smartmoving', {
          method: 'DELETE',
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete integration');
        }

        toast.success('SmartMoving integration removed');
        setHasExistingIntegration(false);
        setSmartMovingClientId('');
        setSmartMovingApiKey('');
      } else if (smartMovingEnabled && (!smartMovingClientId || !smartMovingApiKey)) {
        toast.error('Please provide both Client ID and API Key');
        return;
      }
    } catch (error) {
      console.error('Error saving integrations:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save integration settings');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!smartMovingClientId || !smartMovingApiKey) {
      toast.error('Please provide both Client ID and API Key');
      return;
    }

    setTesting(true);
    setTestResults(null);
    
    try {
      // Format today's date as YYYYMMDD
      const today = new Date();
      const fromServiceDate = today.toISOString().split('T')[0].replace(/-/g, '');
      
      // Use the actual API key if it's been changed, otherwise use the existing one
      const apiKeyToUse = smartMovingApiKey.includes('•') ? '' : smartMovingApiKey;
      
      if (!apiKeyToUse) {
        toast.error('Please enter your API key to test the connection');
        setTesting(false);
        return;
      }
      
      const response = await fetch('/api/integrations/smartmoving/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: apiKeyToUse,
          clientId: smartMovingClientId,
          fromServiceDate,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to connect');
      }
      
      setTestResults(data);
      toast.success('Successfully connected to SmartMoving!');
    } catch (error) {
      console.error('Error testing SmartMoving connection:', error);
      toast.error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTestResults({ error: error instanceof Error ? error.message : 'Failed to connect' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <SidebarProvider>
      <AppSidebar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Integrations</h1>
          </div>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="text-gray-500">Loading integration settings...</div>
          </div>
        ) : !organization ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <h3 className="font-medium text-yellow-900 mb-2">Organization Required</h3>
            <p className="text-sm text-yellow-700">
              Please select or create an organization to manage integrations.
            </p>
          </div>
        ) : (
          <div className="max-w-2xl">
            <div className="space-y-6">
              {/* Organization Info */}
              {organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Organization Settings</h3>
                  <p className="text-sm text-blue-700">
                    These integration settings will apply to all members of <strong>{organization.name}</strong>.
                  </p>
                </div>
              )}
              
              {/* SmartMoving Integration */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <img src="/smartmoving.png" alt="SmartMoving" className="h-16 w-auto mb-4" />
                <h2 className="text-lg font-medium mb-2">SmartMoving Integration</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Connect SmartMoving to sync projects and automate your moving business workflow.
                </p>
                
                <div className="space-y-4">
                  {/* Enable/Disable Toggle */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="smartmoving-enabled"
                      checked={smartMovingEnabled}
                      onChange={(e) => setSmartMovingEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="smartmoving-enabled" className="text-sm">
                      Enable SmartMoving integration
                    </label>
                  </div>
                  
                  {/* Configuration Fields */}
                  {smartMovingEnabled && (
                    <div className="space-y-4 pt-4 border-t">
                      {/* Client ID */}
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Client ID
                        </label>
                        <input
                          type="text"
                          value={smartMovingClientId}
                          onChange={(e) => setSmartMovingClientId(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder="Your SmartMoving Client ID"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Your unique SmartMoving client identifier
                        </p>
                      </div>

                      {/* API Key */}
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          <Key className="inline h-4 w-4 mr-1" />
                          API Key
                        </label>
                        <input
                          type="password"
                          value={smartMovingApiKey}
                          onChange={(e) => setSmartMovingApiKey(e.target.value)}
                          onFocus={(e) => {
                            // Clear the placeholder dots when user wants to enter new key
                            if (smartMovingApiKey.includes('•')) {
                              setSmartMovingApiKey('');
                            }
                          }}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder={hasExistingIntegration ? "Enter new API key to update" : "Your SmartMoving API key"}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Keep this key secret and secure
                        </p>
                      </div>

                      {/* Test Connection Button */}
                      <Button 
                        onClick={testConnection}
                        disabled={testing || !smartMovingClientId || (!smartMovingApiKey || smartMovingApiKey.includes('•'))}
                        variant="outline"
                        className="w-full"
                      >
                        <TestTube className="mr-2 h-4 w-4" />
                        {testing ? 'Testing...' : 'Test Connection'}
                      </Button>

                      {/* Test Results */}
                      {testResults && (
                        <div className={`rounded-lg border p-4 ${testResults.error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                          <h3 className="font-medium mb-2">Test Results</h3>
                          {testResults.error ? (
                            <p className="text-sm text-red-600">Error: {testResults.error}</p>
                          ) : (
                            <div className="space-y-4">
                              <p className="text-sm text-green-600">✓ Successfully connected to SmartMoving API</p>
                              {testResults.customerCount !== undefined && (
                                <div className="text-sm text-gray-600 space-y-1">
                                  <p>Found {testResults.customerCount} customers with future dates</p>
                                  <p>Found {testResults.leadsCount} leads</p>
                                  <p>Found {testResults.opportunitiesCount} opportunities</p>
                                  <p>Found {testResults.jobsCount} jobs</p>
                                  <p>Found {testResults.unifiedRecordsCount} unified records</p>
                                </div>
                              )}
                              
                              {/* Full API Response Data */}
                              <details className="mt-4">
                                <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                                  View Full API Response Data
                                </summary>
                                <div className="mt-2 p-3 bg-gray-100 rounded-md overflow-auto max-h-96">
                                  <pre className="text-xs text-gray-800 whitespace-pre-wrap">
                                    {JSON.stringify(testResults, null, 2)}
                                  </pre>
                                </div>
                              </details>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Save Button */}
              <Button 
                onClick={saveIntegrations}
                disabled={saving}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : 'Save Integration Settings'}
              </Button>
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