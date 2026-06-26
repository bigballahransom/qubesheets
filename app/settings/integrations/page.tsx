'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Plug, Save, Key, TestTube, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

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
  const [sendUploadLinkOnCreate, setSendUploadLinkOnCreate] = useState(false);
  const [syncCrewLinkOnSync, setSyncCrewLinkOnSync] = useState(true);

  // Chariot integration state
  const [chariotEnabled, setChariotEnabled] = useState(false);
  const [chariotSubdomain, setChariotSubdomain] = useState('');
  const [chariotAuthToken, setChariotAuthToken] = useState('');
  const [chariotAccountId, setChariotAccountId] = useState('');
  const [hasChariotIntegration, setHasChariotIntegration] = useState(false);

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
          setSendUploadLinkOnCreate(data.integration.sendUploadLinkOnCreate || false);
          setSyncCrewLinkOnSync(data.integration.syncCrewLinkOnSync !== false);
          // API key is not returned for security, just show that it exists
          if (data.integration.hasApiKey) {
            setSmartMovingApiKey('••••••••••••••••');
          }
        }
      }

      // Load existing Chariot integration
      const chariotRes = await fetch('/api/integrations/chariot');
      if (chariotRes.ok) {
        const cdata = await chariotRes.json();
        if (cdata.exists) {
          setHasChariotIntegration(true);
          setChariotEnabled(cdata.integration.enabled !== false);
          setChariotSubdomain(cdata.integration.clientSubdomain || '');
          setChariotAccountId(cdata.integration.accountId || '');
          if (cdata.integration.hasAuthToken) {
            setChariotAuthToken('••••••••••••••••');
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
      // Save new credentials or update existing with new credentials
      if (smartMovingEnabled && smartMovingClientId && smartMovingApiKey && !smartMovingApiKey.includes('•')) {
        const response = await fetch('/api/integrations/smartmoving', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            smartMovingClientId,
            smartMovingApiKey,
            sendUploadLinkOnCreate,
            syncCrewLinkOnSync,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save integration');
        }

        toast.success('SmartMoving integration saved successfully!');
        setHasExistingIntegration(true);
      } else if (smartMovingEnabled && hasExistingIntegration && smartMovingApiKey.includes('•')) {
        // Update settings only (without changing credentials)
        const response = await fetch('/api/integrations/smartmoving', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sendUploadLinkOnCreate,
            syncCrewLinkOnSync,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update settings');
        }

        toast.success('SmartMoving settings updated successfully!');
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
        setSendUploadLinkOnCreate(false);
      } else if (smartMovingEnabled && (!smartMovingClientId || !smartMovingApiKey)) {
        toast.error('Please provide both Client ID and API Key');
        return;
      }

      // Chariot save logic (parallel to SmartMoving above)
      if (
        chariotEnabled &&
        chariotSubdomain &&
        chariotAuthToken &&
        !chariotAuthToken.includes('•')
      ) {
        const response = await fetch('/api/integrations/chariot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientSubdomain: chariotSubdomain,
            authToken: chariotAuthToken,
            accountId: chariotAccountId || undefined,
            enabled: true,
          }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save Chariot integration');
        }
        toast.success('Chariot integration saved successfully!');
        setHasChariotIntegration(true);
        setChariotAuthToken('••••••••••••••••');
      } else if (
        chariotEnabled &&
        hasChariotIntegration &&
        chariotAuthToken.includes('•')
      ) {
        // Settings-only update (subdomain or account ID may have changed)
        const response = await fetch('/api/integrations/chariot', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientSubdomain: chariotSubdomain,
            accountId: chariotAccountId || undefined,
            enabled: true,
          }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update Chariot settings');
        }
        toast.success('Chariot settings updated successfully!');
      } else if (!chariotEnabled && hasChariotIntegration) {
        const response = await fetch('/api/integrations/chariot', {
          method: 'DELETE',
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete Chariot integration');
        }
        toast.success('Chariot integration removed');
        setHasChariotIntegration(false);
        setChariotSubdomain('');
        setChariotAuthToken('');
        setChariotAccountId('');
      } else if (chariotEnabled && (!chariotSubdomain || !chariotAuthToken)) {
        toast.error('Please provide both Chariot subdomain and auth token');
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
    <SettingsPageShell
      title="Integrations"
      subtitle="Sync inventory surveys directly into your CRM."
      icon={Plug}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
    >
            <div className="space-y-6">
              {/* Supermove Integration */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <img src="/supermove.png" alt="Supermove" className="h-16 w-auto mb-4" />
                <h2 className="text-lg font-medium mb-2">Supermove Integration</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Sync inventory surveys directly to Supermove projects
                </p>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Send inventory as surveys</p>
                      <p className="text-xs text-gray-600">Transform QubeSheets inventory into Supermove survey format</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.location.href = '/settings/integrations/supermove'}
                    >
                      Configure
                    </Button>
                  </div>
                  
                  <div className="text-xs text-gray-500 pt-2 border-t">
                    <strong>Features:</strong> One-time sync per project, Room-based grouping, Customer email linking
                  </div>
                </div>
              </div>

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
                      {/* <Button 
                        onClick={testConnection}
                        disabled={testing || !smartMovingClientId || (!smartMovingApiKey || smartMovingApiKey.includes('•'))}
                        variant="outline"
                        className="w-full"
                      >
                        <TestTube className="mr-2 h-4 w-4" />
                        {testing ? 'Testing...' : 'Test Connection'}
                      </Button> */}

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

                      {/* Webhook Configuration */}
                      {hasExistingIntegration && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                          <h3 className="font-medium text-blue-900 mb-3">Webhook Configuration</h3>
                          <p className="text-sm text-blue-700 mb-3">
                            Configure this webhook URL in SmartMoving to automatically create projects when opportunities are created.
                          </p>
                          
                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-blue-900 mb-1">
                                Webhook URL
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value="https://app.qubesheets.com/api/external/smartmoving"
                                  readOnly
                                  className="flex-1 px-3 py-2 text-sm bg-white border border-blue-300 rounded-lg text-gray-800"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    navigator.clipboard.writeText('https://app.qubesheets.com/api/external/smartmoving');
                                    toast.success('Webhook URL copied to clipboard!');
                                  }}
                                  className="px-3 py-2 text-xs"
                                >
                                  Copy
                                </Button>
                              </div>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-blue-900 mb-1">
                                Supported Events
                              </label>
                              <div className="text-sm text-blue-700">
                                • Opportunity Created
                              </div>
                            </div>
                            
                            <div className="text-xs text-blue-600 space-y-1">
                              <p><strong>Setup Instructions:</strong></p>
                              <p>1. In SmartMoving, go to Settings → Integrations → Webhooks</p>
                              <p>2. Add the webhook URL above</p>
                              <p>3. Select "Opportunity Created" event</p>
                              <p>4. Add your Qube Sheets API key as a custom header (Authorization: Bearer your_api_key)</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Auto-Configuration Info */}
                      {/* {hasExistingIntegration && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                          <h3 className="font-medium text-green-900 mb-2">Auto-Configuration</h3>
                          <p className="text-sm text-green-700">
                            Default values (tariff, referral source, etc.) are automatically configured when you first sync a project to SmartMoving. No manual setup required.
                          </p>
                        </div>
                      )} */}

                      {/* Auto-send Upload Link Option */}
                      {hasExistingIntegration && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              id="send-upload-link-on-create"
                              checked={sendUploadLinkOnCreate}
                              onChange={(e) => setSendUploadLinkOnCreate(e.target.checked)}
                              className="h-4 w-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div>
                              <label htmlFor="send-upload-link-on-create" className="text-sm font-medium text-gray-900 cursor-pointer">
                                Send customer upload link when opportunity is created
                              </label>
                              <p className="text-xs text-gray-600 mt-1">
                                Automatically send an SMS with an upload link to the customer when a new opportunity is created in SmartMoving.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sync Crew Review Link Option */}
                      {hasExistingIntegration && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              id="sync-crew-link-on-sync"
                              checked={syncCrewLinkOnSync}
                              onChange={(e) => setSyncCrewLinkOnSync(e.target.checked)}
                              className="h-4 w-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div>
                              <label htmlFor="sync-crew-link-on-sync" className="text-sm font-medium text-gray-900 cursor-pointer">
                                Sync crew review link to job notes
                              </label>
                              <p className="text-xs text-gray-600 mt-1">
                                Automatically add the crew review link to the Crew Notes field in SmartMoving when syncing inventory.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Chariot Integration */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <img src="/chariot.png" alt="Chariot" className="h-16 w-auto mb-4" />
                <h2 className="text-lg font-medium mb-2">Chariot Integration</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Connect Chariot to push AI-generated inventories into Chariot jobs.
                </p>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="chariot-enabled"
                      checked={chariotEnabled}
                      onChange={(e) => setChariotEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="chariot-enabled" className="text-sm">
                      Enable Chariot integration
                    </label>
                  </div>

                  {chariotEnabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Client Subdomain
                        </label>
                        <input
                          type="text"
                          value={chariotSubdomain}
                          onChange={(e) => setChariotSubdomain(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                          placeholder="e.g. iansmoving (or groovinmovin.demo)"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          The subdomain part of your Chariot URL. We resolve to{' '}
                          <code className="bg-gray-100 px-1 rounded">
                            https://{chariotSubdomain || '<subdomain>'}.chariotmove.com
                          </code>
                          .
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">
                          <Key className="inline h-4 w-4 mr-1" />
                          Auth Token
                        </label>
                        <input
                          type="password"
                          value={chariotAuthToken}
                          onChange={(e) => setChariotAuthToken(e.target.value)}
                          onFocus={() => {
                            if (chariotAuthToken.includes('•')) setChariotAuthToken('');
                          }}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder={hasChariotIntegration ? 'Enter new auth token to update' : 'Your Chariot auth token'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Sent to Chariot as <code className="bg-gray-100 px-1 rounded">X-Auth-Token</code>.
                          Keep this value secret.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Account ID (optional)
                        </label>
                        <input
                          type="text"
                          value={chariotAccountId}
                          onChange={(e) => setChariotAccountId(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                          placeholder="If your Chariot endpoints require X-Account-Id"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Required by some Chariot endpoints (e.g. validate_job). Leave blank if Chariot didn't issue you one.
                        </p>
                      </div>
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
    </SettingsPageShell>
  );
}