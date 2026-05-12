'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Save, Plus, Trash2, Tag as TagIcon, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

const MAX_TAG_LENGTH = 50;
const MAX_PROMPT_LENGTH = 500;

interface OrgTag {
  name: string;
  prompt?: string;
}

export default function TagsPage() {
  const { organization } = useOrganization();

  const [tags, setTags] = useState<OrgTag[]>([]);
  const [aiTaggingEnabled, setAiTaggingEnabled] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/tags');
      if (response.ok) {
        const data = await response.json();
        const incoming: OrgTag[] = Array.isArray(data.tags)
          ? data.tags
              .map((t: any) =>
                typeof t === 'string'
                  ? { name: t, prompt: '' }
                  : { name: String(t?.name ?? ''), prompt: String(t?.prompt ?? '') }
              )
              .filter((t: OrgTag) => t.name)
          : [];
        setTags(incoming);
        setAiTaggingEnabled(Boolean(data.aiTaggingEnabled));
      }
    } catch (error) {
      console.error('Error loading tags:', error);
      toast.error('Failed to load tags');
    } finally {
      setLoading(false);
    }
  };

  const addTag = () => {
    const trimmed = newTag.trim().slice(0, MAX_TAG_LENGTH);
    if (!trimmed) return;
    if (tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Tag already exists');
      return;
    }
    setTags([...tags, { name: trimmed, prompt: '' }]);
    setNewTag('');
    setHasUnsavedChanges(true);
    inputRef.current?.focus();
  };

  const removeTag = (name: string) => {
    setTags(tags.filter((t) => t.name !== name));
    setHasUnsavedChanges(true);
  };

  const updatePrompt = (name: string, prompt: string) => {
    setTags(tags.map((t) => (t.name === name ? { ...t, prompt: prompt.slice(0, MAX_PROMPT_LENGTH) } : t)));
    setHasUnsavedChanges(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  const saveTags = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, aiTaggingEnabled }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save tags: ${response.status}`);
      }
      const data = await response.json();
      const saved: OrgTag[] = Array.isArray(data.tags)
        ? data.tags.map((t: any) => ({ name: String(t?.name ?? ''), prompt: String(t?.prompt ?? '') }))
        : [];
      setTags(saved);
      setAiTaggingEnabled(Boolean(data.aiTaggingEnabled));
      setHasUnsavedChanges(false);
      toast.success('Tags saved successfully!');
    } catch (error) {
      console.error('Error saving tags:', error);
      toast.error(
        `Failed to save tags. ${error instanceof Error ? error.message : 'Please try again.'}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16"></div>
        <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Tags</h1>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="text-gray-500">Loading tags...</div>
            </div>
          ) : (
            <div className="max-w-2xl">
              <div className="space-y-6">
                {organization && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-medium text-blue-900 mb-1">Organization Settings</h3>
                    <p className="text-sm text-blue-700">
                      These tags will be available to all members of{' '}
                      <strong>{organization.name}</strong>. Add a prompt to each tag so our AI can
                      auto-tag matching items in video walkthroughs.
                    </p>
                  </div>
                )}

                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h2 className="text-lg font-medium flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        AI auto-tagging
                      </h2>
                      <p className="text-sm text-gray-600 mt-1">
                        When enabled, our AI uses each tag's prompt to automatically apply matching
                        tags to items detected in video walkthroughs.
                      </p>
                    </div>
                    <Switch
                      checked={aiTaggingEnabled}
                      onCheckedChange={(checked) => {
                        setAiTaggingEnabled(checked);
                        setHasUnsavedChanges(true);
                      }}
                      aria-label="Toggle AI auto-tagging"
                    />
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h2 className="text-lg font-medium mb-4">Add a tag</h2>
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={handleKeyDown}
                      maxLength={MAX_TAG_LENGTH}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. Fragile, Disassembly required"
                    />
                    <Button type="button" onClick={addTag} disabled={!newTag.trim()} variant="outline">
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Press Enter to add. Up to {MAX_TAG_LENGTH} characters.
                  </p>
                </div>

                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h2 className="text-lg font-medium mb-4">Your tags ({tags.length})</h2>

                  {tags.length === 0 ? (
                    <div className="text-sm text-gray-500 border border-dashed rounded-lg p-6 text-center">
                      <TagIcon className="h-6 w-6 mx-auto mb-2 text-gray-400" />
                      No tags yet. Add your first tag above.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {tags.map((tag) => {
                        const promptLen = (tag.prompt ?? '').length;
                        return (
                          <div key={tag.name} className="border rounded-lg p-4">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div className="flex items-center gap-2">
                                <TagIcon className="h-4 w-4 text-gray-500" />
                                <span className="font-medium text-gray-900">{tag.name}</span>
                              </div>
                              <Button
                                type="button"
                                onClick={() => removeTag(tag.name)}
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                aria-label={`Remove tag ${tag.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              AI auto-tag prompt
                            </label>
                            <textarea
                              value={tag.prompt ?? ''}
                              onChange={(e) => updatePrompt(tag.name, e.target.value)}
                              maxLength={MAX_PROMPT_LENGTH}
                              rows={3}
                              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-y"
                              placeholder={`Describe when an item should be tagged "${tag.name}". e.g. Items made of glass, ceramics, or any easily breakable material.`}
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                              <span>Used by AI to auto-tag matching items in videos.</span>
                              <span>
                                {promptLen}/{MAX_PROMPT_LENGTH}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Button onClick={saveTags} disabled={saving} className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'Save Tags'}
                </Button>

                {hasUnsavedChanges && (
                  <p className="text-sm text-orange-600 text-center mt-2">
                    You have unsaved changes
                  </p>
                )}
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
