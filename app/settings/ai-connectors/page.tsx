'use client';

// app/settings/ai-connectors/page.tsx
//
// Mint and manage MCP connector tokens so AI assistants (Claude, ChatGPT,
// Claude Code, Cursor) can read the org's Qube Sheets data. The connector
// URL embeds the token and is shown exactly once; everything here is
// read-only access and no tool can ever message a customer.

import { useEffect, useState } from 'react';
import { useOrganization, useAuth } from '@clerk/nextjs';
import { Bot, Check, Copy, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

interface ConnectorKey {
  keyId: string;
  name: string;
  prefix: string;
  scopes?: string[];
  createdAt: string;
  lastUsed?: string;
}

/**
 * The paste-into-your-AI message: instead of following click-paths, the
 * mover pastes this into Claude/ChatGPT/Grok and the assistant walks THEM
 * through adding the connector, then tests it.
 */
function magicPrompt(connectorUrl: string): string {
  return `Please connect me to my company's Qube Sheets MCP server so you can answer questions about our moving jobs.

Here is my connector link (treat it like a password):
${connectorUrl}

Walk me through adding it to this app as a custom MCP connector, one step at a time, using the steps for whichever app you are:
- Claude: Settings, Connectors, Add custom connector, paste the link, choose "No sign-in", save
- ChatGPT: Settings, Security and login, turn on Developer Mode, then Plugins, Add, Create MCP App, paste the link, choose "No authentication", save
- Grok: go to grok.com/connectors, New Connector, Custom, paste the link, save

When I tell you it is added, test it by listing my recent Qube Sheets projects and tell me what you see.`;
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-700">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs ring-1 ring-gray-200">
          {secret ? `${value.slice(0, 28)}...` : value}
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

export default function AiConnectorsPage() {
  const { organization } = useOrganization();
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin';

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ConnectorKey[]>([]);
  const [newName, setNewName] = useState('');
  const [newAccess, setNewAccess] = useState<'read' | 'read_write'>('read');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; connectorUrl: string; token: string; bearerUrl: string } | null>(null);

  const loadKeys = async () => {
    try {
      const res = await fetch('/api/mcp-connector-keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (e) {
      console.error('Failed to load connectors', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, [organization?.id]);

  const createKey = async () => {
    if (!newName.trim()) {
      toast.error('Give the connector a name (e.g. "Claude - office")');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/mcp-connector-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), access: newAccess }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create connector');
        return;
      }
      setCreated({ name: data.name, connectorUrl: data.connectorUrl, token: data.token, bearerUrl: data.bearerUrl });
      setNewName('');
      loadKeys();
    } catch {
      toast.error('Failed to create connector');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string, name: string) => {
    if (!confirm(`Revoke "${name}"? Every assistant using this connector URL loses access immediately.`)) return;
    try {
      const res = await fetch('/api/mcp-connector-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      if (res.ok) {
        toast.success('Connector revoked');
        loadKeys();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to revoke');
      }
    } catch {
      toast.error('Failed to revoke');
    }
  };

  return (
    <SettingsPageShell
      title="AI Connectors"
      subtitle="Let Claude, ChatGPT, and other AI assistants read your Qube Sheets data."
      icon={Bot}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
    >
      <div className="space-y-6">
        {/* What this is */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-900">Ask your AI about your moves</p>
              <p className="mt-1">
                Connect Claude, ChatGPT, or Grok to Qube Sheets in about a minute: create a connector
                here, copy one link, paste it into your AI app. Then ask things like "how big is the
                Johnson move?" and get real answers from your own data. Your AI only ever sees YOUR
                company's projects, and every question it asks is logged.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Treat the link like a password. If it ever leaks, hit Revoke here - actions stop
                instantly and reading stops within 5 minutes.
              </p>
            </div>
          </div>
        </div>

        {/* Show-once created panel */}
        {created && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-base font-semibold text-emerald-900">
              "{created.name}" is ready
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              Copy your connection link now - for safety it is shown only this once. If you lose it,
              just revoke this connector and make a new one.
            </p>

            <div className="mt-4">
              <CopyField label="Your connection link (this is all you need)" value={created.connectorUrl} secret />
            </div>

            <div className="mt-4 rounded-lg bg-white/80 p-4">
              <p className="text-sm font-semibold text-gray-900">
                Easiest way: copy this message and paste it into Claude, ChatGPT, or Grok
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Your AI will walk you through connecting, then test it for you.
              </p>
              <div className="mt-2 rounded-lg bg-slate-950 p-3">
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate-100">{magicPrompt(created.connectorUrl)}</pre>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(magicPrompt(created.connectorUrl));
                        toast.success('Message copied - now paste it into your AI app');
                      } catch {
                        toast.error('Could not copy');
                      }
                    }}
                  >
                    <Copy className="mr-1.5 h-4 w-4" /> Copy message
                  </Button>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-500">Prefer written steps instead?</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
                    <p className="text-sm font-semibold text-gray-900">Claude</p>
                    <ol className="mt-1 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
                      <li>claude.ai, then Settings, then Connectors</li>
                      <li>Add custom connector</li>
                      <li>Paste the link, pick "No sign-in", save</li>
                    </ol>
                    <p className="mt-1.5 text-[11px] text-gray-400">Works in Claude Desktop and the mobile app too.</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
                    <p className="text-sm font-semibold text-gray-900">ChatGPT</p>
                    <ol className="mt-1 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
                      <li>Settings, then Security and login, turn on Developer Mode</li>
                      <li>Plugins, then Add, then Create MCP App</li>
                      <li>Paste the link, pick "No authentication", save</li>
                    </ol>
                    <p className="mt-1.5 text-[11px] text-gray-400">Needs a paid ChatGPT plan.</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
                    <p className="text-sm font-semibold text-gray-900">Grok</p>
                    <ol className="mt-1 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
                      <li>Go to grok.com/connectors</li>
                      <li>New Connector, then Custom</li>
                      <li>Paste the link, save</li>
                    </ol>
                    <p className="mt-1.5 text-[11px] text-gray-400">Needs a paid Grok plan. Then works in the Grok apps.</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
                    <p className="text-sm font-semibold text-gray-900">Try it</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Once connected, ask your AI: <span className="italic">"How big is the Johnson move?"</span>{' '}
                      or <span className="italic">"What's in the garage on the Smith job?"</span>
                    </p>
                  </div>
                </div>
              </details>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-500">For developers (Claude Code, Cursor, VS Code)</summary>
                <div className="mt-2 space-y-3">
                  <CopyField label="Bearer token" value={created.token} secret />
                  <p className="text-xs text-gray-600">
                    Point at <code className="rounded bg-gray-100 px-1 font-mono">{created.bearerUrl}</code> with an{' '}
                    <code className="rounded bg-gray-100 px-1 font-mono">Authorization: Bearer ...</code> header from an
                    environment variable. Never commit the token.
                  </p>
                </div>
              </details>
            </div>

            <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreated(null)}>
              Done - I saved it
            </Button>
          </div>
        )}

        {/* Create */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
          <h2 className="text-lg font-semibold">Create a connector</h2>
          {isAdmin ? (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Name it after where it lives, e.g. "Claude - sales team"'
                  maxLength={50}
                  className="flex-1 rounded-lg px-3 py-2 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button onClick={createKey} disabled={creating}>
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5 ring-1 ring-gray-200 has-[:checked]:ring-2 has-[:checked]:ring-blue-500">
                  <input
                    type="radio"
                    name="access"
                    checked={newAccess === 'read'}
                    onChange={() => setNewAccess('read')}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-gray-900">Read-only (recommended)</span>
                    <span className="block text-xs text-gray-500">Look up projects, inventory, notes, and links. Can never change anything or message anyone.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5 ring-1 ring-gray-200 has-[:checked]:ring-2 has-[:checked]:ring-amber-500">
                  <input
                    type="radio"
                    name="access"
                    checked={newAccess === 'read_write'}
                    onChange={() => setNewAccess('read_write')}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-gray-900">Read + actions</span>
                    <span className="block text-xs text-gray-500">Everything above, plus: create projects and schedule, reschedule, or cancel video calls. Scheduling and rescheduling text the customer their join link, exactly like the app does. Give this only to assistants you trust with customer contact.</span>
                  </span>
                </label>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Only organization admins can create or revoke connectors. Ask an admin to set one up.
            </p>
          )}
        </div>

        {/* Existing keys */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5">
          <h2 className="text-lg font-semibold">Active connectors</h2>
          {keys.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">None yet.</p>
          ) : (
            <div className="mt-3 divide-y">
              {keys.map((k) => (
                <div key={k.keyId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {k.name}
                      <span
                        className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          k.scopes?.includes('mcp:write')
                            ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20'
                            : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
                        }`}
                      >
                        {k.scopes?.includes('mcp:write') ? 'read + actions' : 'read-only'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500">
                      <code className="font-mono">{k.prefix}...</code>
                      {' '}created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsed ? ` - last used ${new Date(k.lastUsed).toLocaleDateString()}` : ' - never used'}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button variant="outline" size="sm" onClick={() => revokeKey(k.keyId, k.name)}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* What the assistant can do */}
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5 text-sm text-gray-600">
          <h2 className="text-lg font-semibold text-gray-900">What connected assistants can do</h2>
          <p className="mt-2 font-medium text-gray-800">Every connector:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Find projects by customer name or phone, and browse recent projects</li>
            <li>Read inventory with going-aware totals, by room, with full item details</li>
            <li>Read AI walkthrough summaries, packing notes, and customer statements</li>
            <li>Fetch shareable links (customer review, crew review, self-survey, on-site walkthrough)</li>
            <li>See scheduled video calls (without join links)</li>
          </ul>
          <p className="mt-3 font-medium text-gray-800">"Read + actions" connectors can also:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Create projects (optionally texting the customer an upload link)</li>
            <li>Schedule video calls (the customer is texted a confirmation with their join link)</li>
            <li>Reschedule calls (the customer is texted the new time) and reassign reps</li>
            <li>Cancel calls (optionally texting the customer)</li>
          </ul>
          <p className="mt-3">
            No connector can edit inventory, delete anything, change settings, or access billing.
            Every tool call is logged with the connector, tool, and project.
          </p>
        </div>
      </div>
    </SettingsPageShell>
  );
}
