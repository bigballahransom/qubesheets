'use client';

// Settings page for the org-wide Media Vault crew link — the one static QR
// movers and warehouse staff keep on their devices. Media captured through
// it is stored as reference only (never inventoried) and auto-files to the
// project matching the customer's phone number.
import { useState, useRef, useEffect } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Copy, ExternalLink, Check, Download, ClipboardList, Plus, Trash2, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import SafeIcon from '@/components/icons/SafeIcon';
import { toast } from 'sonner';

// Media Vault upload form builder — same idea as the lead-form field
// config: the org owns the field list (add / rename / reorder / delete,
// each optional or required). 'title' and 'description' are built-ins that
// map onto the vault card's label/description; anything else is a custom
// field stored with the media.
interface VaultFormField {
  fieldId: string;
  label: string;
  hint?: string;
  required: boolean;
}

const DEFAULT_FIELDS: VaultFormField[] = [
  { fieldId: 'title', label: 'Title', hint: 'Short label shown on the vault card', required: false },
  { fieldId: 'description', label: 'Description', hint: 'Condition notes, contents, context', required: false },
];

const newFieldId = () => 'f' + Math.random().toString(36).slice(2, 8);

export default function VaultLinkSettingsPage() {
  const { organization, isLoaded } = useOrganization();
  const [copied, setCopied] = useState(false);
  const qrWrapperRef = useRef<HTMLDivElement>(null);

  // Upload form builder state — explicit Save (label edits shouldn't POST
  // per keystroke)
  const [fields, setFields] = useState<VaultFormField[]>(DEFAULT_FIELDS);
  const [fieldsLoaded, setFieldsLoaded] = useState(false);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [savingFields, setSavingFields] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/vault-upload-fields')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.vaultUploadFormFields)) {
          setFields(d.vaultUploadFormFields);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFieldsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutateFields = (updater: (prev: VaultFormField[]) => VaultFormField[]) => {
    setFields(updater);
    setFieldsDirty(true);
  };

  const moveField = (index: number, dir: -1 | 1) => {
    mutateFields((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveFields = async () => {
    if (savingFields) return;
    if (fields.some((f) => !f.label.trim())) {
      toast.error('Every field needs a label');
      return;
    }
    setSavingFields(true);
    try {
      const res = await fetch('/api/settings/vault-upload-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultUploadFormFields: fields.map((f) => ({
            ...f,
            label: f.label.trim(),
            hint: f.hint?.trim() || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      setFieldsDirty(false);
      toast.success('Upload form saved');
    } catch (e: any) {
      toast.error(e.message || 'Could not save — try again');
    } finally {
      setSavingFields(false);
    }
  };

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  };

  const vaultLink = organization?.id ? `${getBaseUrl()}/vault/${organization.id}` : null;

  const copyToClipboard = async () => {
    if (!vaultLink) return;
    try {
      await navigator.clipboard.writeText(vaultLink);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy link');
    }
  };

  const openInNewTab = () => {
    if (!vaultLink) return;
    window.open(vaultLink, '_blank');
  };

  const downloadQr = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'media-vault-crew-qr.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <SettingsPageShell
      title="Media Vault Crew Link"
      subtitle="One QR code for all crew and warehouse devices. Walk-in/walk-out videos, receiving, and damage documentation get stored on the right job — never inventoried."
      icon={SafeIcon}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={!isLoaded}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <SafeIcon size={20} className="text-slate-700" />
            </div>
            <div>
              <h2 className="text-lg font-medium">Your Crew Capture Link</h2>
              <p className="text-sm text-gray-500">Put the QR on crew phones, truck clipboards, and the warehouse wall</p>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <code className="text-sm text-gray-800 break-all">{vaultLink}</code>
          </div>

          {vaultLink && (
            <div className="flex flex-col items-center gap-3 bg-white border border-gray-200 rounded-lg p-4 mb-4">
              <div ref={qrWrapperRef}>
                <QRCodeCanvas value={vaultLink} size={192} marginSize={2} />
              </div>
              <Button onClick={downloadQr} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Download QR code
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={copyToClipboard} className="flex-1 sm:flex-none">
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Link
                </>
              )}
            </Button>
            <Button onClick={openInNewTab} variant="outline" className="flex-1 sm:flex-none">
              <ExternalLink className="mr-2 h-4 w-4" />
              Preview Link
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <ClipboardList size={20} className="text-slate-700" />
            </div>
            <div>
              <h2 className="text-lg font-medium">Upload Form</h2>
              <p className="text-sm text-gray-500">
                Build the form crews fill in when adding media to the vault — add your own fields
                (e.g. Employee name, Job number), reorder them, and mark any as required. Applies
                to crew capture links and the desktop Add Media uploader.
              </p>
            </div>
          </div>

          <div className="space-y-2 mt-4">
            {fields.map((field, index) => (
              <div
                key={field.fieldId}
                className="flex items-start gap-2 border border-gray-200 rounded-lg p-3"
              >
                <div className="flex flex-col gap-0.5 pt-1">
                  <button
                    onClick={() => moveField(index, -1)}
                    disabled={index === 0}
                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 cursor-pointer"
                    aria-label="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveField(index, 1)}
                    disabled={index === fields.length - 1}
                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 cursor-pointer"
                    aria-label="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={field.label}
                      onChange={(e) =>
                        mutateFields((prev) =>
                          prev.map((f, i) => (i === index ? { ...f, label: e.target.value } : f))
                        )
                      }
                      maxLength={80}
                      placeholder="Field label"
                      className="flex-1 min-w-0 text-sm font-medium border border-gray-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-slate-400 outline-none"
                    />
                    {(field.fieldId === 'title' || field.fieldId === 'description') && (
                      <span className="text-[10px] uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        built-in
                      </span>
                    )}
                  </div>
                  <input
                    value={field.hint || ''}
                    onChange={(e) =>
                      mutateFields((prev) =>
                        prev.map((f, i) => (i === index ? { ...f, hint: e.target.value } : f))
                      )
                    }
                    maxLength={120}
                    placeholder="Helper text shown in the field (optional)"
                    className="w-full text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-slate-400 outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    {[false, true].map((req) => (
                      <button
                        key={String(req)}
                        onClick={() =>
                          mutateFields((prev) =>
                            prev.map((f, i) => (i === index ? { ...f, required: req } : f))
                          )
                        }
                        className={`px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                          field.required === req
                            ? req
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-700 text-white'
                            : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {req ? 'Required' : 'Optional'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => mutateFields((prev) => prev.filter((_, i) => i !== index))}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                    aria-label="Delete field"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {fields.length === 0 && (
              <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg p-4 text-center">
                No fields — crews won&apos;t be asked for any details. Add a field below.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!fieldsLoaded || fields.length >= 12}
              onClick={() =>
                mutateFields((prev) => [
                  ...prev,
                  { fieldId: newFieldId(), label: '', hint: '', required: false },
                ])
              }
            >
              <Plus size={14} className="mr-1" />
              Add field
            </Button>
            {!fields.some((f) => f.fieldId === 'title') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => mutateFields((prev) => [...prev, { ...DEFAULT_FIELDS[0] }])}
              >
                <Plus size={14} className="mr-1" />
                Title
              </Button>
            )}
            {!fields.some((f) => f.fieldId === 'description') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => mutateFields((prev) => [...prev, { ...DEFAULT_FIELDS[1] }])}
              >
                <Plus size={14} className="mr-1" />
                Description
              </Button>
            )}
            <div className="flex-1" />
            <Button onClick={saveFields} disabled={!fieldsDirty || savingFields} size="sm">
              {savingFields ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save form'
              )}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="text-lg font-medium mb-4">How It Works</h2>
          <div className="space-y-4">
            {[
              { step: 1, title: 'Crew Scans the QR', desc: 'No login and no seat needed — any phone with the QR can capture.' },
              { step: 2, title: 'They Enter the Customer Info', desc: "Customer name + phone from the job sheet. That's all the typing." },
              { step: 3, title: 'Media Files Itself', desc: "Phone match → the media lands in that job's Vault tab. No match → a new project is created and badged Unfiled so your admin can re-file it." },
              { step: 4, title: 'Stored, Not Inventoried', desc: 'Vault media never touches the inventory, totals, review links, or CRM sync. Run "Process inventory" on any vault video later if you want items from it.' }
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex items-start gap-4">
                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-700 font-medium text-sm">{step}</span>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-600">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-medium text-gray-900 mb-2">Tips</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• For recurring accounts (designers, logistics), use the per-project vault QR instead — Project → Actions → Vault Capture Link / QR — so everything lands in one folder with zero typing</li>
            <li>• Walk-in / walk-out videos: have crews scan at arrival and after loading</li>
            <li>• Warehouse receiving: post the per-project QR at the receiving dock</li>
          </ul>
        </div>
      </div>
    </SettingsPageShell>
  );
}
