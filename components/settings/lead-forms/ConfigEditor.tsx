'use client';

// components/settings/lead-forms/ConfigEditor.tsx
//
// Three-tab editor for a single LeadFormConfig. Maintains local working
// state across all tabs. The top-right Save button persists the mutable
// subset of the document via PATCH. The Active/Paused switch persists
// immediately without going through the working state.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Eye, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldsTab } from './tabs/FieldsTab';
import { SubmissionsTab } from './tabs/SubmissionsTab';
import { CrmRoutingTab } from './tabs/CrmRoutingTab';
import { EmbedCodeTab } from './tabs/EmbedCodeTab';
import { PostSubmitTab } from './tabs/PostSubmitTab';
import { JavaScriptPluginTab } from './tabs/JavaScriptPluginTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { FormStatsStrip } from './FormStatsStrip';
import type {
  ILeadFormConfig,
  ILeadFormConfigCrmRouting,
  ILeadFormConfigField,
  ILeadFormCustomField,
  LeadFormPostSubmit,
  LeadFormStep,
  MoveSizeRoutingRule,
  SchedulingSettings,
} from '@/models/LeadFormConfig';
import { toast } from 'sonner';

// Shape of what we get back from GET /api/embedded-forms/[id].
// We only need a subset of ILeadFormConfig (which is a Mongoose Document).
export interface LeadFormConfigDTO {
  _id: string;
  name: string;
  isActive: boolean;
  fields: ILeadFormConfigField[];
  customFields?: ILeadFormCustomField[];
  crmRouting: ILeadFormConfigCrmRouting;
  postSubmit: ILeadFormConfig['postSubmit'];
  theme: ILeadFormConfig['theme'];
  abuse?: ILeadFormConfig['abuse'];
  schedulingSettings?: SchedulingSettings;
  moveSizeOptions?: string[];
  moveSizeRouting?: MoveSizeRoutingRule[];
  steps?: LeadFormStep[];
}

// Mutable subset that the Save button sends back.
interface EditableState {
  name: string;
  fields: ILeadFormConfigField[];
  customFields?: ILeadFormCustomField[];
  crmRouting: ILeadFormConfigCrmRouting;
  postSubmit: LeadFormPostSubmit;
  theme: ILeadFormConfig['theme'];
  schedulingSettings?: SchedulingSettings;
  moveSizeOptions?: string[];
  moveSizeRouting?: MoveSizeRoutingRule[];
  steps?: LeadFormStep[];
}

function toEditable(config: LeadFormConfigDTO): EditableState {
  return {
    name: config.name,
    fields: config.fields.map((f) => ({ ...f })),
    customFields: Array.isArray(config.customFields)
      ? config.customFields.map((cf) => ({
          ...cf,
          options: cf.options ? [...cf.options] : undefined,
        }))
      : undefined,
    crmRouting: JSON.parse(JSON.stringify(config.crmRouting || {})),
    postSubmit: JSON.parse(
      JSON.stringify(config.postSubmit ?? { kind: 'redirect-chooser' })
    ),
    theme: JSON.parse(JSON.stringify(config.theme ?? {
      title: 'Get a Quote',
      buttonText: 'Get a Quote',
      buttonColor: '#2563eb',
    })),
    schedulingSettings: config.schedulingSettings
      ? JSON.parse(JSON.stringify(config.schedulingSettings))
      : undefined,
    moveSizeOptions: Array.isArray(config.moveSizeOptions)
      ? [...config.moveSizeOptions]
      : undefined,
    moveSizeRouting: Array.isArray(config.moveSizeRouting)
      ? config.moveSizeRouting.map((r) => ({ ...r }))
      : undefined,
    steps: Array.isArray(config.steps)
      ? config.steps.map((s) => ({
          heading: s.heading,
          fields: [...s.fields],
        }))
      : undefined,
  };
}

const DEFAULT_MOVE_SIZE_OPTIONS = [
  'Studio',
  '1 Bedroom',
  '2 Bedroom',
  '3 Bedroom',
  '4+ Bedroom',
  'Office',
  'Storage Unit',
];

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface ConfigEditorProps {
  config: LeadFormConfigDTO;
}

export function ConfigEditor({ config: initialConfig }: ConfigEditorProps) {
  const router = useRouter();

  const [config, setConfig] = useState<LeadFormConfigDTO>(initialConfig);
  const [draft, setDraft] = useState<EditableState>(() =>
    toEditable(initialConfig)
  );
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Keep working state in sync if the persisted config changes (e.g. after a
  // successful save we replace it with the server response).
  useEffect(() => {
    setDraft(toEditable(config));
  }, [config]);

  const persisted = useMemo(() => toEditable(config), [config]);
  const hasUnsavedChanges = !deepEqual(draft, persisted);

  // Validation: Supermove requires projectType + jobType when routing is on.
  const supermove = draft.crmRouting.supermove;
  const supermoveInvalid =
    !!supermove &&
    (!supermove.projectType?.trim() || !supermove.jobType?.trim());
  const nameInvalid = !draft.name.trim();
  // Server-side validation rejects an empty theme.title, and an empty
  // buttonText renders a blank submit button on the embed.
  const themeTextInvalid =
    !draft.theme.title?.trim() || !draft.theme.buttonText?.trim();
  // Custom fields need a label, and dropdowns need at least one real option —
  // the server validator rejects both, so block save up front.
  const customFieldsInvalid = (draft.customFields ?? []).some(
    (cf) =>
      !cf.label.trim() ||
      (cf.type === 'select' &&
        (cf.options ?? []).filter((o) => o.trim()).length === 0),
  );

  const saveDisabled =
    !hasUnsavedChanges ||
    saving ||
    supermoveInvalid ||
    nameInvalid ||
    themeTextInvalid ||
    customFieldsInvalid;

  const save = async () => {
    if (saveDisabled) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/embedded-forms/${config._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          fields: draft.fields,
          customFields:
            draft.customFields?.map((cf) => ({
              ...cf,
              label: cf.label.trim(),
              options:
                cf.type === 'select'
                  ? (cf.options ?? []).map((o) => o.trim()).filter(Boolean)
                  : undefined,
            })) ?? null,
          crmRouting: draft.crmRouting,
          postSubmit: draft.postSubmit,
          theme: draft.theme,
          schedulingSettings: draft.schedulingSettings ?? null,
          moveSizeOptions: draft.moveSizeOptions ?? null,
          moveSizeRouting: draft.moveSizeRouting ?? null,
          steps: draft.steps ?? null,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to save (${response.status})`);
      }
      const updated = (await response.json()) as LeadFormConfigDTO;
      setConfig(updated);
      toast.success('Lead form saved.');
    } catch (error) {
      console.error('Error saving lead form:', error);
      toast.error(
        `Failed to save. ${
          error instanceof Error ? error.message : 'Please try again.'
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (next: boolean) => {
    setTogglingActive(true);
    try {
      const response = await fetch(`/api/embedded-forms/${config._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || `Failed (${response.status})`);
      }
      const updated = (await response.json()) as LeadFormConfigDTO;
      setConfig(updated);
      toast.success(next ? 'Lead form activated.' : 'Lead form paused.');
    } catch (error) {
      console.error('Error toggling active state:', error);
      toast.error(
        `Failed to update status. ${
          error instanceof Error ? error.message : 'Please try again.'
        }`
      );
    } finally {
      setTogglingActive(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/embedded-forms/${config._id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || `Failed (${response.status})`);
      }
      toast.success('Lead form deleted.');
      router.push('/settings/lead-forms');
    } catch (error) {
      console.error('Error deleting lead form:', error);
      toast.error(
        `Failed to delete. ${
          error instanceof Error ? error.message : 'Please try again.'
        }`
      );
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex flex-row items-center gap-4 flex-wrap">
          <Link
            href="/settings/lead-forms"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 shrink-0"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to lead forms
          </Link>

          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                autoFocus
                className="max-w-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="group inline-flex items-center gap-2 text-left"
            >
              <span className="text-xl font-semibold text-gray-900 truncate">
                {draft.name || 'Untitled form'}
              </span>
              <Pencil className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-white">
            <Switch
              checked={config.isActive}
              disabled={togglingActive}
              onCheckedChange={toggleActive}
            />
            <span className="text-sm font-medium text-gray-700">
              {config.isActive ? 'Active' : 'Paused'}
            </span>
          </div>

          <Button
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete
          </Button>

          {/* Preview opens the saved version of the form in a new tab with
              `?preview=1`. Submissions go through a simulation endpoint —
              no Customer/Project, no SMS, no CRM, no credit consumption.
              We disable when there are unsaved changes so what the user
              sees actually matches what they think they're previewing. */}
          {hasUnsavedChanges ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button variant="outline" disabled>
                    <Eye className="mr-1.5 h-4 w-4" />
                    Preview
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Save your changes first to preview the latest version.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                window.open(`/embed/${config._id}?preview=1`, '_blank', 'noopener,noreferrer')
              }
            >
              <Eye className="mr-1.5 h-4 w-4" />
              Preview
              <ExternalLink className="ml-1.5 h-3.5 w-3.5 text-gray-400" />
            </Button>
          )}

          <Button onClick={save} disabled={saveDisabled}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-4 w-4" />
                Save changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Quick funnel — submissions → next-step engagement → inventory.
          Independent fetch, so it doesn't block the editor from rendering. */}
      <FormStatsStrip configId={config._id} />

      {/* Tabs. The trigger row is wider than a phone viewport (7 tabs), so
          it scrolls horizontally inside its own container — without this the
          inline-flex TabsList stretches the page and mobile Safari zooms the
          whole editor out to fit it (same pattern as InventoryManager's
          tab bar). */}
      <Tabs defaultValue="appearance" className="w-full">
        <div
          className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <TabsList className="flex w-max min-w-full">
            <TabsTrigger value="appearance" className="whitespace-nowrap">Appearance</TabsTrigger>
            <TabsTrigger value="fields" className="whitespace-nowrap">Fields</TabsTrigger>
            <TabsTrigger value="post-submit" className="whitespace-nowrap">After Submit</TabsTrigger>
            <TabsTrigger value="crm-routing" className="whitespace-nowrap">CRM Routing</TabsTrigger>
            <TabsTrigger value="embed-code" className="whitespace-nowrap">Embed Code</TabsTrigger>
            <TabsTrigger value="js-plugin" className="whitespace-nowrap">JavaScript Plugin</TabsTrigger>
            <TabsTrigger value="submissions" className="whitespace-nowrap">Submissions</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="fields" className="pt-4">
          <FieldsTab
            fields={draft.fields}
            onChange={(fields) => setDraft((d) => ({ ...d, fields }))}
            customFields={draft.customFields}
            onCustomFieldsChange={(customFields) =>
              setDraft((d) => ({ ...d, customFields }))
            }
            moveSizeOptions={draft.moveSizeOptions}
            onMoveSizeOptionsChange={(opts) =>
              setDraft((d) => ({ ...d, moveSizeOptions: opts }))
            }
            steps={draft.steps}
            onStepsChange={(steps) => setDraft((d) => ({ ...d, steps }))}
          />
        </TabsContent>
        <TabsContent value="post-submit" className="pt-4">
          <PostSubmitTab
            postSubmit={draft.postSubmit}
            onChange={(postSubmit) => setDraft((d) => ({ ...d, postSubmit }))}
            schedulingSettings={draft.schedulingSettings}
            onSchedulingSettingsChange={(schedulingSettings) =>
              setDraft((d) => ({ ...d, schedulingSettings }))
            }
            moveSizeFieldEnabled={
              !!draft.fields.find((f) => f.id === 'moveSize')?.enabled
            }
            moveSizeOptions={
              draft.moveSizeOptions && draft.moveSizeOptions.length > 0
                ? draft.moveSizeOptions
                : DEFAULT_MOVE_SIZE_OPTIONS
            }
            moveSizeRouting={draft.moveSizeRouting}
            onMoveSizeRoutingChange={(moveSizeRouting) =>
              setDraft((d) => ({ ...d, moveSizeRouting }))
            }
          />
        </TabsContent>
        <TabsContent value="appearance" className="pt-4">
          <AppearanceTab
            theme={draft.theme}
            onChange={(theme) => setDraft((d) => ({ ...d, theme }))}
          />
        </TabsContent>
        <TabsContent value="crm-routing" className="pt-4">
          <CrmRoutingTab
            routing={draft.crmRouting}
            onChange={(crmRouting) =>
              setDraft((d) => ({ ...d, crmRouting }))
            }
            fields={draft.fields}
            customFieldCount={draft.customFields?.length ?? 0}
          />
        </TabsContent>
        <TabsContent value="embed-code" className="pt-4">
          <EmbedCodeTab configId={config._id} />
        </TabsContent>
        <TabsContent value="js-plugin" className="pt-4">
          <JavaScriptPluginTab configId={config._id} />
        </TabsContent>
        <TabsContent value="submissions" className="pt-4">
          <SubmissionsTab configId={config._id} />
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this lead form?</DialogTitle>
            <DialogDescription>
              The form will stop accepting submissions immediately. Existing
              leads already captured will remain in Qube Sheets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete form'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
