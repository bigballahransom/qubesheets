'use client';

import { useState, useEffect } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Save, Plus, Trash2, Package, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_BOX_TYPES = 50;
const MAX_CUFT = 1000;

interface BoxType {
  name: string;
  cuft: number;
  description?: string;
}

export default function BoxTypesPage() {
  const { organization } = useOrganization();

  const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
  const [defaults, setDefaults] = useState<BoxType[]>([]);
  const [newName, setNewName] = useState('');
  const [newCuft, setNewCuft] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    loadBoxTypes();
  }, []);

  const loadBoxTypes = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/box-types');
      if (response.ok) {
        const data = await response.json();
        setBoxTypes(Array.isArray(data.boxTypes) ? data.boxTypes : []);
        setDefaults(Array.isArray(data.defaults) ? data.defaults : []);
      }
    } catch (error) {
      console.error('Error loading box types:', error);
      toast.error('Failed to load box types');
    } finally {
      setLoading(false);
    }
  };

  const updateBoxType = (index: number, patch: Partial<BoxType>) => {
    setBoxTypes((prev) =>
      prev.map((bt, i) => (i === index ? { ...bt, ...patch } : bt))
    );
    setHasUnsavedChanges(true);
  };

  const removeBoxType = (index: number) => {
    setBoxTypes((prev) => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const addBoxType = () => {
    const name = newName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) {
      toast.error('Name is required');
      return;
    }
    if (boxTypes.some((bt) => bt.name.toLowerCase() === name.toLowerCase())) {
      toast.error('A box type with that name already exists');
      return;
    }
    const cuftNum = Number(newCuft);
    if (!Number.isFinite(cuftNum) || cuftNum < 0 || cuftNum > MAX_CUFT) {
      toast.error('Cuft must be a number between 0 and 1000');
      return;
    }
    if (boxTypes.length >= MAX_BOX_TYPES) {
      toast.error(`Max ${MAX_BOX_TYPES} box types`);
      return;
    }
    const description = newDescription.trim().slice(0, MAX_DESCRIPTION_LENGTH);
    setBoxTypes([...boxTypes, description ? { name, cuft: cuftNum, description } : { name, cuft: cuftNum }]);
    setNewName('');
    setNewCuft('');
    setNewDescription('');
    setHasUnsavedChanges(true);
  };

  const resetToDefaults = () => {
    if (!confirm('Replace your current box types with the defaults? Unsaved customizations will be lost on save.')) {
      return;
    }
    setBoxTypes(defaults.map((bt) => ({ ...bt })));
    setHasUnsavedChanges(true);
  };

  const saveBoxTypes = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/box-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxTypes }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save box types: ${response.status}`);
      }
      const data = await response.json();
      setBoxTypes(Array.isArray(data.boxTypes) ? data.boxTypes : []);
      setHasUnsavedChanges(false);
      toast.success('Box types saved successfully!');
    } catch (error) {
      console.error('Error saving box types:', error);
      toast.error(
        `Failed to save box types. ${error instanceof Error ? error.message : 'Please try again.'}`
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
              <h1 className="text-2xl font-bold">Box Types</h1>
            </div>
            <Button
              type="button"
              onClick={resetToDefaults}
              variant="outline"
              size="sm"
              disabled={loading}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to defaults
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="text-gray-500">Loading box types...</div>
            </div>
          ) : (
            <div className="max-w-2xl">
              <div className="space-y-6">
                {organization && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-medium text-blue-900 mb-1">Organization Settings</h3>
                    <p className="text-sm text-blue-700">
                      These box types are used by packing recommendations for{' '}
                      <strong>{organization.name}</strong>. New organizations start with our defaults
                      &mdash; remove the ones you don&apos;t use and add your own custom box types.
                    </p>
                  </div>
                )}

                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h2 className="text-lg font-medium mb-4">Add a box type</h2>
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        maxLength={MAX_NAME_LENGTH}
                        className="sm:col-span-2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Name (e.g. Mirror Carton)"
                      />
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max={MAX_CUFT}
                        value={newCuft}
                        onChange={(e) => setNewCuft(e.target.value)}
                        className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Cuft"
                      />
                    </div>
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      rows={2}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-y"
                      placeholder="Description (what this box is used for) — optional"
                    />
                    <Button type="button" onClick={addBoxType} variant="outline" className="w-full sm:w-auto">
                      <Plus className="mr-2 h-4 w-4" />
                      Add box type
                    </Button>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h2 className="text-lg font-medium mb-4">Your box types ({boxTypes.length})</h2>

                  {boxTypes.length === 0 ? (
                    <div className="text-sm text-gray-500 border border-dashed rounded-lg p-6 text-center">
                      <Package className="h-6 w-6 mx-auto mb-2 text-gray-400" />
                      No box types. Add one above or click &ldquo;Reset to defaults&rdquo;.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {boxTypes.map((bt, index) => {
                        const descLen = (bt.description ?? '').length;
                        return (
                          <div key={`${bt.name}-${index}`} className="border rounded-lg p-4">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-gray-500" />
                                <span className="font-medium text-gray-900">{bt.name || 'Unnamed'}</span>
                              </div>
                              <Button
                                type="button"
                                onClick={() => removeBoxType(index)}
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                aria-label={`Remove ${bt.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                              <div className="sm:col-span-2">
                                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                                <input
                                  type="text"
                                  value={bt.name}
                                  onChange={(e) => updateBoxType(index, { name: e.target.value })}
                                  maxLength={MAX_NAME_LENGTH}
                                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Cuft</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max={MAX_CUFT}
                                  value={Number.isFinite(bt.cuft) ? bt.cuft : 0}
                                  onChange={(e) => updateBoxType(index, { cuft: Number(e.target.value) })}
                                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </div>

                            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                            <textarea
                              value={bt.description ?? ''}
                              onChange={(e) => updateBoxType(index, { description: e.target.value.slice(0, MAX_DESCRIPTION_LENGTH) })}
                              maxLength={MAX_DESCRIPTION_LENGTH}
                              rows={2}
                              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-y"
                              placeholder="What kinds of items go in this box?"
                            />
                            <div className="text-xs text-gray-500 text-right mt-1">
                              {descLen}/{MAX_DESCRIPTION_LENGTH}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Button onClick={saveBoxTypes} disabled={saving} className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'Save Box Types'}
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
