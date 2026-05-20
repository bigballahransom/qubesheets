'use client';

import { useEffect, useState } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Tags, Plus, Trash2, Sparkles, Hand, Info } from 'lucide-react';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type SmartTagMode = 'ai' | 'manual';
type SmartTag = {
  id: string;
  name: string;
  description: string;
  mode: SmartTagMode;
};

const DEFAULT_TAG_MODE: SmartTagMode = 'manual';
const MAX_TAGS_PER_ORG = 30;
const MAX_TAG_NAME_LENGTH = 40;
const MAX_TAG_DESCRIPTION_LENGTH = 300;

function newTagId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `tag-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `tag-${Math.random().toString(36).slice(2, 10)}`;
}

function blankTag(): SmartTag {
  return { id: newTagId(), name: '', description: '', mode: DEFAULT_TAG_MODE };
}

export default function SmartTagsSettingsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [tags, setTags] = useState<SmartTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges]);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings/smart-tags');
      if (response.ok) {
        const config = await response.json();
        setTags(
          Array.isArray(config.smartTags)
            ? config.smartTags.map((t: any) => ({
                id: t.id,
                name: t.name,
                description: t.description ?? '',
                mode: t.mode === 'ai' ? 'ai' : 'manual'
              }))
            : []
        );
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
        setTags([]);
      }
    } catch (error) {
      console.error('Error loading smart tags:', error);
      setTags([]);
    } finally {
      setLoading(false);
    }
  };

  const updateTag = (id: string, patch: Partial<SmartTag>) => {
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setHasUnsavedChanges(true);
  };

  const removeTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setHasUnsavedChanges(true);
  };

  const addTag = () => {
    if (tags.length >= MAX_TAGS_PER_ORG) {
      toast.error(`You can have at most ${MAX_TAGS_PER_ORG} smart tags.`);
      return;
    }
    setTags((prev) => [...prev, blankTag()]);
    setHasUnsavedChanges(true);
  };

  const validateClient = (): string | null => {
    const seen = new Set<string>();
    for (const t of tags) {
      const name = t.name.trim();
      if (!name) return 'Every smart tag needs a name.';
      if (name.length > MAX_TAG_NAME_LENGTH)
        return `"${name}" is too long (max ${MAX_TAG_NAME_LENGTH} chars).`;
      if (/["\r\n]/.test(name))
        return `"${name}" contains a quote or line break — please remove it.`;
      const key = name.toLowerCase();
      if (seen.has(key)) return `Duplicate tag name: "${name}". Names must be unique.`;
      seen.add(key);
      if (t.description.length > MAX_TAG_DESCRIPTION_LENGTH) {
        return `Description for "${name}" is too long (max ${MAX_TAG_DESCRIPTION_LENGTH} chars).`;
      }
      if (t.mode !== 'ai' && t.mode !== 'manual') {
        return `"${name}" has an invalid mode — choose AI or Manual.`;
      }
    }
    return null;
  };

  const saveSettings = async () => {
    const err = validateClient();
    if (err) {
      toast.error(err);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/settings/smart-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smartTags: tags })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data.smartTags)) {
        setTags(
          data.smartTags.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description ?? '',
            mode: t.mode === 'ai' ? 'ai' : 'manual'
          }))
        );
      }
      setHasUnsavedChanges(false);
      toast.success('Smart tags saved.');
    } catch (error) {
      console.error('Error saving smart tags:', error);
      toast.error(
        `Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPageShell
      title="Smart Tags"
      subtitle="Custom labels for inventory items. Set each tag to AI (auto-applied by the worker) or Manual (applied by hand)."
      icon={Tags}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      unsavedChanges={hasUnsavedChanges}
      saving={saving}
      onSave={saveSettings}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        loadSettings();
      }}
    >
      <div className="space-y-6">
        {/* Tag list */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-lg font-medium">Tags</h2>
            <span className="text-xs text-gray-500">
              {tags.length} of {MAX_TAGS_PER_ORG}
            </span>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Each tag has its own mode. AI tags are applied automatically based on the
            description; Manual tags stay available for your team to apply by hand.
          </p>

          <div className="space-y-3">
            {tags.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
                <Tags className="mx-auto h-8 w-8 text-gray-400" />
                <h3 className="mt-3 text-sm font-medium text-gray-900">No smart tags yet</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Add your first tag — e.g. &quot;Storage,&quot; &quot;High Value Item,&quot; or &quot;Damaged Item.&quot;
                </p>
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={addTag}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" /> Add tag
                  </button>
                </div>
              </div>
            ) : (
              tags.map((tag, idx) => {
                const trimmedName = tag.name.trim();
                const nameInvalid =
                  !trimmedName ||
                  /["\r\n]/.test(trimmedName) ||
                  trimmedName.length > MAX_TAG_NAME_LENGTH;
                return (
                  <div
                    key={tag.id}
                    className="group rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold">
                          {idx + 1}
                        </div>

                        <div className="flex-1 min-w-0">
                          <FieldShell label="Name" required>
                            <input
                              type="text"
                              value={tag.name}
                              onChange={(e) => updateTag(tag.id, { name: e.target.value })}
                              placeholder="e.g. Storage"
                              maxLength={MAX_TAG_NAME_LENGTH}
                              className={cn(
                                'w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                                nameInvalid ? 'border-red-300' : 'border-gray-300'
                              )}
                            />
                          </FieldShell>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeTag(tag.id)}
                          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          aria-label={`Remove ${trimmedName || `tag ${idx + 1}`}`}
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <FieldShell label="Description" className="mt-3">
                        <textarea
                          value={tag.description}
                          onChange={(e) =>
                            updateTag(tag.id, { description: e.target.value })
                          }
                          placeholder="When should this tag apply? E.g. this item goes to storage."
                          maxLength={MAX_TAG_DESCRIPTION_LENGTH}
                          rows={2}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-y"
                        />
                      </FieldShell>

                      <FieldShell label="Mode" className="mt-3">
                        <ModeToggle
                          value={tag.mode}
                          onChange={(next) => updateTag(tag.id, { mode: next })}
                        />
                      </FieldShell>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {tags.length > 0 && (
            <button
              type="button"
              onClick={addTag}
              disabled={tags.length >= MAX_TAGS_PER_ORG}
              className={cn(
                'mt-3 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed py-3 text-sm font-medium transition-colors',
                tags.length >= MAX_TAGS_PER_ORG
                  ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                  : 'border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/40'
              )}
            >
              <Plus className="h-4 w-4" />
              Add tag
            </button>
          )}
        </div>
      </div>
    </SettingsPageShell>
  );
}

function ModeToggle({
  value,
  onChange
}: {
  value: SmartTagMode;
  onChange: (next: SmartTagMode) => void;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="inline-flex items-stretch rounded-md border border-gray-200 bg-gray-50 p-0.5">
        <ModeOption
          active={value === 'ai'}
          icon={Sparkles}
          label="AI"
          tooltip="Our AI picks this tag from your library and applies it to items automatically during inventory based on the description above."
          onClick={() => onChange('ai')}
        />
        <ModeOption
          active={value === 'manual'}
          icon={Hand}
          label="Manual"
          tooltip="This tag stays available for your team to apply by hand. Our AI won't touch it."
          onClick={() => onChange('manual')}
        />
      </div>
    </TooltipProvider>
  );
}

function ModeOption({
  active,
  icon: Icon,
  label,
  tooltip,
  onClick
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center rounded transition-colors',
        active
          ? 'bg-white shadow-sm ring-1 ring-blue-200'
          : 'hover:bg-gray-100/60'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm font-medium transition-colors',
          active ? 'text-blue-700' : 'text-gray-600 hover:text-gray-900'
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', active ? 'text-blue-600' : 'text-gray-500')} />
        <span>{label}</span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label} mode`}
            className={cn(
              'mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
              active
                ? 'text-blue-400 hover:text-blue-700 hover:bg-blue-50'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200/70'
            )}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-left">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function FieldShell({
  label,
  required,
  className,
  children
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
