'use client';

// app/settings/webhooks/page.tsx
//
// Manage OUTBOUND webhook endpoints: org-configured URLs that Qube Sheets
// POSTs an `inventory.ready` event to whenever an AI analysis (virtual call,
// self-serve walkthrough, photo/video upload) finishes writing a project's
// inventory. The signing secret is shown exactly once at creation; members
// can view, only org admins can create/enable/disable/delete/test.

import { useEffect, useState } from 'react';
import { useOrganization, useAuth } from '@clerk/nextjs';
import { Check, Copy, Send, ShieldCheck, Trash2, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

interface PayloadConfig {
  inventorySummary: boolean;
  items: boolean;
  reviewLinks: boolean;
  aiSummary: boolean;
  packingNotes: boolean;
  customerStatements: boolean;
  media: boolean;
}

const DEFAULT_PAYLOAD: PayloadConfig = {
  inventorySummary: true,
  items: true,
  reviewLinks: false,
  aiSummary: false,
  packingNotes: false,
  customerStatements: false,
  media: false,
};

// Rendered as the "What's included" checkboxes, in this order.
const PAYLOAD_SECTIONS: Array<{ key: keyof PayloadConfig; label: string; hint: string }> = [
  { key: 'inventorySummary', label: 'Inventory summary', hint: 'Going-aware totals: items, boxes, cuft, lbs, rooms' },
  { key: 'items', label: 'Inventory items', hint: 'Every line item with per-unit and total cuft/weight' },
  { key: 'reviewLinks', label: 'Review links', hint: 'Customer review + crew review URLs (created if missing)' },
  { key: 'aiSummary', label: 'AI summary', hint: 'AI walkthrough summary per recording' },
  { key: 'packingNotes', label: 'Packing notes', hint: 'AI packing notes per recording' },
  { key: 'customerStatements', label: 'Customer statements', hint: 'Verbatim customer quotes with timestamps' },
  { key: 'media', label: 'Media (photos + videos)', hint: 'Signed download URLs, expire 24h after each delivery' },
];

interface WebhookEndpointRow {
  _id: string;
  name: string;
  url: string;
  events: string[];
  payload: PayloadConfig;
  isActive: boolean;
  disabledReason?: string;
  consecutiveFailures: number;
  lastDeliveryAt?: string;
  lastDeliveryOk?: boolean;
  createdBy: string;
  createdAt: string;
}

interface WebhookDeliveryRow {
  _id: string;
  endpointId: string;
  projectId: string;
  event: string;
  url: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  responseStatus?: number;
  error?: string;
  attemptCount: number;
  durationMs?: number;
  deliveredAt?: string;
  createdAt: string;
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-700">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs ring-1 ring-gray-200">
          {secret ? `${value.slice(0, 16)}...` : value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              toast.success(`${label} copied`);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error('Could not copy');
            }
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

const DELIVERY_STATUS_STYLES: Record<WebhookDeliveryRow['status'], string> = {
  sent: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  failed: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20',
  skipped: 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-500/20',
  queued: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  sending: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20',
};

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WebhooksPage() {
  const { organization } = useOrganization();
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin';

  const [loading, setLoading] = useState(true);
  const [endpoints, setEndpoints] = useState<WebhookEndpointRow[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRow[]>([]);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newPayload, setNewPayload] = useState<PayloadConfig>({ ...DEFAULT_PAYLOAD });
  const [savingPayloadId, setSavingPayloadId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; url: string; secret: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadEndpoints = async () => {
    try {
      const res = await fetch('/api/webhook-endpoints');
      if (res.ok) {
        const data = await res.json();
        setEndpoints(data.endpoints || []);
        setDeliveries(data.recentDeliveries || []);
      }
    } catch (e) {
      console.error('Failed to load webhook endpoints', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEndpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  const createEndpoint = async () => {
    if (!newName.trim()) {
      toast.error('Give the endpoint a name (e.g. "CRM integration")');
      return;
    }
    if (!newUrl.trim()) {
      toast.error('Enter the HTTPS URL we should deliver events to');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/webhook-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim(), payload: newPayload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create endpoint');
        return;
      }
      setCreated({ name: data.name, url: data.url, secret: data.secret });
      setNewName('');
      setNewUrl('');
      setNewPayload({ ...DEFAULT_PAYLOAD });
      loadEndpoints();
    } catch {
      toast.error('Failed to create endpoint');
    } finally {
      setCreating(false);
    }
  };

  const toggleEndpoint = async (endpoint: WebhookEndpointRow) => {
    setTogglingId(endpoint._id);
    try {
      const res = await fetch('/api/webhook-endpoints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId: endpoint._id, isActive: !endpoint.isActive }),
      });
      if (res.ok) {
        toast.success(endpoint.isActive ? 'Endpoint disabled' : 'Endpoint enabled');
        loadEndpoints();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to update endpoint');
      }
    } catch {
      toast.error('Failed to update endpoint');
    } finally {
      setTogglingId(null);
    }
  };

  const deleteEndpoint = async (endpointId: string, name: string) => {
    if (!confirm(`Delete "${name}"? Deliveries to this URL stop immediately. This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/webhook-endpoints', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId }),
      });
      if (res.ok) {
        toast.success('Endpoint deleted');
        loadEndpoints();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    }
  };

  const sendTest = async (endpointId: string) => {
    setTestingId(endpointId);
    try {
      const res = await fetch('/api/webhook-endpoints/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to send test event');
        return;
      }
      if (data.ok) {
        toast.success(`Test delivered (HTTP ${data.responseStatus}, ${data.durationMs}ms)`);
      } else {
        toast.error(
          `Test failed${data.responseStatus ? ` (HTTP ${data.responseStatus})` : ''}: ${data.error || 'no response'}`
        );
      }
      loadEndpoints();
    } catch {
      toast.error('Failed to send test event');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <SettingsPageShell
      title="Webhooks"
      subtitle="Get notified the moment an AI walkthrough finishes building a project's inventory - instead of polling the API."
      icon={Webhook}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
    >
      <div className="space-y-6">
        {/* Show-once secret panel */}
        {created && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-base font-semibold text-emerald-900">
              &quot;{created.name}&quot; is ready
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              Copy your signing secret now - for safety it is shown only this once and can&apos;t be
              retrieved later. Your server uses it to verify the{' '}
              <code className="rounded bg-white/70 px-1 font-mono text-xs">X-Qubesheets-Signature</code>{' '}
              header on every delivery. If you lose it, delete this endpoint and create a new one.
            </p>
            <div className="mt-4 space-y-3">
              <CopyField label="Signing secret" value={created.secret} secret />
              <CopyField label="Endpoint URL" value={created.url} />
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreated(null)}>
              Done - I saved it
            </Button>
          </div>
        )}

        {/* Create */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
          <h2 className="text-lg font-semibold">Add an endpoint</h2>
          {isAdmin ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Name, e.g. "CRM integration"'
                  maxLength={50}
                  className="rounded-lg px-3 py-2 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-56"
                />
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://your-server.com/webhooks/qubesheets"
                  className="flex-1 rounded-lg px-3 py-2 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button onClick={createEndpoint} disabled={creating}>
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
                <p className="text-sm font-medium text-gray-900">What's included in each delivery</p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {PAYLOAD_SECTIONS.map((s) => (
                    <label key={s.key} className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={newPayload[s.key]}
                        onChange={(e) => setNewPayload({ ...newPayload, [s.key]: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-xs">
                        <span className="font-medium text-gray-800">{s.label}</span>
                        <span className="block text-gray-500">{s.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Must be an HTTPS URL. Up to 5 active endpoints per organization. Each new endpoint
                gets its own signing secret. You can change the included sections anytime below.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Only organization admins can add, test, or remove webhook endpoints. Ask an admin to
              set one up.
            </p>
          )}
        </div>

        {/* Existing endpoints */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
          <h2 className="text-lg font-semibold">Endpoints</h2>
          {endpoints.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">None yet.</p>
          ) : (
            <div className="mt-3 divide-y">
              {endpoints.map((ep) => (
                <div key={ep._id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {ep.name}
                      <span
                        className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          ep.isActive
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
                            : 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
                        }`}
                      >
                        {ep.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      <code className="font-mono">{ep.url}</code>
                    </p>
                    <p className="text-xs text-gray-500">
                      {ep.lastDeliveryAt
                        ? `Last delivery ${formatTime(ep.lastDeliveryAt)} - ${ep.lastDeliveryOk ? 'ok' : 'failed'}`
                        : 'No deliveries yet'}
                      {' '}- created {new Date(ep.createdAt).toLocaleDateString()}
                    </p>
                    {!ep.isActive && ep.disabledReason && (
                      <p className="mt-0.5 text-xs text-red-600">{ep.disabledReason}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {PAYLOAD_SECTIONS.filter((s) => ep.payload?.[s.key]).map((s) => (
                        <span
                          key={s.key}
                          className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20"
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                    {isAdmin && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs font-medium text-gray-500">
                          Edit included sections
                        </summary>
                        <div className="mt-2 grid gap-1.5 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200 sm:grid-cols-2">
                          {PAYLOAD_SECTIONS.map((s) => (
                            <label key={s.key} className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                defaultChecked={!!ep.payload?.[s.key]}
                                onChange={(e) => {
                                  ep.payload = { ...(ep.payload || DEFAULT_PAYLOAD), [s.key]: e.target.checked };
                                }}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300"
                              />
                              <span className="text-xs">
                                <span className="font-medium text-gray-800">{s.label}</span>
                                <span className="block text-gray-500">{s.hint}</span>
                              </span>
                            </label>
                          ))}
                          <div className="sm:col-span-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={savingPayloadId === ep._id}
                              onClick={async () => {
                                setSavingPayloadId(ep._id);
                                try {
                                  const res = await fetch('/api/webhook-endpoints', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ endpointId: ep._id, payload: ep.payload }),
                                  });
                                  if (res.ok) {
                                    toast.success('Payload sections updated');
                                    loadEndpoints();
                                  } else {
                                    const data = await res.json();
                                    toast.error(data.error || 'Failed to update');
                                  }
                                } catch {
                                  toast.error('Failed to update');
                                } finally {
                                  setSavingPayloadId(null);
                                }
                              }}
                            >
                              {savingPayloadId === ep._id ? 'Saving...' : 'Save sections'}
                            </Button>
                          </div>
                        </div>
                      </details>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sendTest(ep._id)}
                        disabled={testingId === ep._id}
                      >
                        <Send className="mr-1.5 h-4 w-4" />
                        {testingId === ep._id ? 'Sending...' : 'Send test'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleEndpoint(ep)}
                        disabled={togglingId === ep._id}
                      >
                        {ep.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => deleteEndpoint(ep._id, ep.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent deliveries */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
          <h2 className="text-lg font-semibold">Recent deliveries</h2>
          {deliveries.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              No deliveries yet. They show up here once an analysis finishes or you send a test.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Event</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Response</th>
                    <th className="py-2 font-medium">Attempts</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {deliveries.map((d) => (
                    <tr key={d._id}>
                      <td className="whitespace-nowrap py-2 pr-3 text-gray-600">{formatTime(d.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <code className="font-mono text-gray-700">{d.event}</code>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${DELIVERY_STATUS_STYLES[d.status]}`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate py-2 pr-3 text-gray-600">
                        {d.responseStatus ? `HTTP ${d.responseStatus}` : ''}
                        {d.responseStatus && d.error ? ' - ' : ''}
                        {d.error || (!d.responseStatus ? '-' : '')}
                      </td>
                      <td className="py-2 text-gray-600">{d.attemptCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5 text-sm text-gray-600">
          <h2 className="text-lg font-semibold text-gray-900">How it works</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              We POST an <code className="rounded bg-gray-100 px-1 font-mono">inventory.ready</code>{' '}
              event to your URL whenever an AI analysis finishes writing a project&apos;s inventory -
              virtual calls, self-serve walkthroughs, and photo/video uploads.
            </li>
            <li>
              The payload is the same JSON as{' '}
              <code className="rounded bg-gray-100 px-1 font-mono">GET /api/external/projects/:id/inventory</code>,
              wrapped in an envelope:{' '}
              <code className="rounded bg-gray-100 px-1 font-mono">
                {'{ id, event, createdAt, initialInventory, project, data }'}
              </code>.
            </li>
            <li>
              Failed deliveries get up to 5 attempts over about 1.5 hours. After 10 consecutive
              failed deliveries an endpoint is auto-disabled; re-enable it here once your server is
              healthy again.
            </li>
          </ul>

          <h3 className="mt-4 flex items-center gap-1.5 font-semibold text-gray-900">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Verifying signatures
          </h3>
          <p className="mt-1">
            Every delivery includes{' '}
            <code className="rounded bg-gray-100 px-1 font-mono">X-Qubesheets-Event</code>,{' '}
            <code className="rounded bg-gray-100 px-1 font-mono">X-Qubesheets-Delivery</code>,{' '}
            <code className="rounded bg-gray-100 px-1 font-mono">X-Qubesheets-Timestamp</code>, and{' '}
            <code className="rounded bg-gray-100 px-1 font-mono">X-Qubesheets-Signature</code>{' '}
            headers. Verify the signature with your endpoint&apos;s secret before trusting the payload:
          </p>
          <div className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100">
            <pre>{`signature = "v1=" + hex(HMAC_SHA256(secret, timestamp + "." + rawBody))`}</pre>
          </div>
          <p className="mt-3">
            Full payload schema and a complete verification example are in the{' '}
            <a href="/api-docs" className="font-medium text-blue-600 hover:underline">
              API docs
            </a>.
          </p>
        </div>
      </div>
    </SettingsPageShell>
  );
}
