'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, Plus, X, Tag as TagIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const MAX_TAG_LENGTH = 50;
const MAX_TAGS_PER_ITEM = 50;

function normalizeName(name) {
  return (name || '').trim().slice(0, MAX_TAG_LENGTH);
}

export default function TagsCell({
  tags = [],
  orgTags = [],
  onTagsChange,
  refreshOrgTags,
  disabled = false,
  isPersonalAccount = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const inputRef = useRef(null);

  const appliedSet = useMemo(() => new Set(tags.map((t) => t.toLowerCase())), [tags]);

  const filteredOrgTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgTags;
    return orgTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [orgTags, search]);

  const trimmedSearch = normalizeName(search);
  const searchKey = trimmedSearch.toLowerCase();
  const exactExistsInOrg = orgTags.some((t) => t.name.toLowerCase() === searchKey);
  const exactExistsApplied = appliedSet.has(searchKey);
  const showAddRow = trimmedSearch.length > 0 && !exactExistsInOrg && !exactExistsApplied;

  const applyTag = (name) => {
    const trimmed = normalizeName(name);
    if (!trimmed) return;
    if (appliedSet.has(trimmed.toLowerCase())) return;
    if (tags.length >= MAX_TAGS_PER_ITEM) {
      toast.error(`Max ${MAX_TAGS_PER_ITEM} tags per item`);
      return;
    }
    onTagsChange?.([...tags, trimmed]);
    setSearch('');
    inputRef.current?.focus();
  };

  const removeTag = (name) => {
    onTagsChange?.(tags.filter((t) => t.toLowerCase() !== name.toLowerCase()));
  };

  const toggleOrgTag = (name) => {
    if (appliedSet.has(name.toLowerCase())) {
      removeTag(name);
    } else {
      applyTag(name);
    }
  };

  const saveCustomToOrg = async () => {
    const trimmed = normalizeName(search);
    if (!trimmed || savingOrg) return;
    setSavingOrg(true);
    try {
      const response = await fetch('/api/settings/tags/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save tag (${response.status})`);
      }
      await refreshOrgTags?.();
      applyTag(trimmed);
      toast.success(`Saved "${trimmed}" to organization tags`);
    } catch (error) {
      console.error('Error saving org tag:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save org tag');
    } finally {
      setSavingOrg(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showAddRow) {
        applyTag(trimmedSearch);
      } else if (trimmedSearch && exactExistsInOrg) {
        applyTag(trimmedSearch);
      }
    } else if (e.key === 'Backspace' && search === '' && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="w-full">
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-h-[28px] text-left px-1 py-1 rounded hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {tags.length === 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                <Plus className="h-3 w-3" />
                Add tag
              </span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b">
            <Input
              ref={inputRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_TAG_LENGTH}
              placeholder="Search or type a new tag…"
              className="h-8 text-sm"
            />
          </div>

          {tags.length > 0 && (
            <div className="px-2 pt-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Applied
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-gray-300 text-gray-600 hover:text-gray-800"
                      aria-label={`Remove ${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto">
            {!isPersonalAccount && (
              <>
                <div className="px-2 pt-2 text-[10px] uppercase tracking-wider text-gray-500">
                  Organization tags
                </div>
                {filteredOrgTags.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400">
                    {orgTags.length === 0 ? 'No org tags yet.' : 'No matches.'}
                  </div>
                ) : (
                  <ul className="py-1">
                    {filteredOrgTags.map((tag) => {
                      const isApplied = appliedSet.has(tag.name.toLowerCase());
                      return (
                        <li key={tag.name}>
                          <button
                            type="button"
                            onClick={() => toggleOrgTag(tag.name)}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-left hover:bg-gray-100"
                          >
                            <span className="flex items-center gap-2">
                              <TagIcon className="h-3.5 w-3.5 text-gray-500" />
                              {tag.name}
                            </span>
                            {isApplied && <Check className="h-4 w-4 text-blue-600" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>

          {showAddRow && (
            <div className="border-t p-2 space-y-2 bg-gray-50">
              <div className="text-xs text-gray-700">
                Add <span className="font-semibold">&ldquo;{trimmedSearch}&rdquo;</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => applyTag(trimmedSearch)}
                  className="flex-1"
                >
                  Apply once
                </Button>
                {!isPersonalAccount && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={saveCustomToOrg}
                    disabled={savingOrg}
                    className="flex-1"
                  >
                    {savingOrg ? 'Saving…' : 'Save to org'}
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                Apply once = on this item only. Save to org = available to all members.
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
