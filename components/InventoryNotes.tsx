// components/InventoryNotes.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Pin,
  Trash2,
  Edit3,
  AlertCircle,
  AlertTriangle,
  Info,
  FileText,
  Package,
  User,
  Truck,
  Calendar,
  Tag,
  X,
  Loader2,
  Check,
  MapPin,
  Video
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";

interface Note {
  _id: string;
  title?: string;
  content: string;
  category: 'general' | 'inventory' | 'customer' | 'moving-day' | 'special-instructions' | 'video-call';
  tags: string[];
  isPinned: boolean;
  roomLocation?: string;
  attachedToVideoRecording?: string;
  attachedToRoomId?: string;
  videoTimestamp?: number;
  lastEditedBy?: {
    userId: string;
    userName: string;
    editedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface InventoryNotesProps {
  projectId: string;
  onNoteUpdate?: () => void;
}

const categoryConfig = {
  general: { icon: FileText, label: 'General', color: 'text-gray-500' },
  inventory: { icon: Package, label: 'Inventory', color: 'text-blue-500' },
  customer: { icon: User, label: 'Customer', color: 'text-purple-500' },
  'moving-day': { icon: Truck, label: 'Moving Day', color: 'text-green-500' },
  'special-instructions': { icon: AlertCircle, label: 'Special Instructions', color: 'text-orange-500' },
  'video-call': { icon: MessageSquare, label: 'Video Call', color: 'text-indigo-500' }
};


export default function InventoryNotes({ projectId, onNoteUpdate }: InventoryNotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt'>('createdAt');
  
  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  
  // Form states
  const [formData, setFormData] = useState({
    content: '',
    category: 'general' as Note['category'],
    tags: [] as string[],
    roomLocation: '',
    attachedToVideoRecording: undefined as string | undefined,
    attachedToRoomId: undefined as string | undefined,
    videoTimestamp: undefined as number | undefined
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Room states
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [isAddingNewRoom, setIsAddingNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        sortBy,
        sortOrder: 'desc'
      });

      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`/api/projects/${projectId}/notes?${params}`);
      if (!response.ok) throw new Error('Failed to fetch notes');

      const data = await response.json();
      setNotes(data.notes);
    } catch (error) {
      console.error('Error fetching notes:', error);
      toast.error('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedCategory, searchQuery, sortBy]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Fetch available rooms
  const fetchRooms = useCallback(async () => {
    try {
      setLoadingRooms(true);
      const response = await fetch(`/api/projects/${projectId}/rooms`);
      if (!response.ok) throw new Error('Failed to fetch rooms');

      const data = await response.json();
      setAvailableRooms(data.rooms || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      // Fail silently - rooms dropdown will just be empty
    } finally {
      setLoadingRooms(false);
    }
  }, [projectId]);

  // Fetch rooms on component mount and when dialog opens
  useEffect(() => {
    if (projectId) {
      fetchRooms();
    }
  }, [projectId, fetchRooms]);


  // Create note
  const handleCreate = async () => {
    try {
      setSaving(true);
      const response = await fetch(`/api/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error Response:', errorData);
        throw new Error(errorData.details || 'Failed to create note');
      }

      const result = await response.json();

      toast.success('Note added successfully');
      setIsCreateOpen(false);
      setIsEditOpen(false);
      setSelectedNote(null);
      resetForm();
      fetchNotes();
      onNoteUpdate?.();
    } catch (error) {
      console.error('Error creating note:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  // Update note
  const handleUpdate = async () => {
    if (!selectedNote) return;

    try {
      setSaving(true);
      const response = await fetch(`/api/projects/${projectId}/notes/${selectedNote._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to update note');

      toast.success('Note updated successfully');
      setIsEditOpen(false);
      resetForm();
      fetchNotes();
      onNoteUpdate?.();
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error('Failed to update note');
    } finally {
      setSaving(false);
    }
  };

  // Delete note
  const handleDelete = async () => {
    if (!selectedNote) return;

    try {
      setSaving(true);
      const response = await fetch(`/api/projects/${projectId}/notes/${selectedNote._id}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete note');

      toast.success('Note deleted successfully');
      setIsDeleteOpen(false);
      setSelectedNote(null);
      fetchNotes();
      onNoteUpdate?.();
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('Failed to delete note');
    } finally {
      setSaving(false);
    }
  };

  // Toggle pin
  const handleTogglePin = async (note: Note) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/notes/${note._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: !note.isPinned })
      });

      if (!response.ok) throw new Error('Failed to update note');

      toast.success(note.isPinned ? 'Note unpinned' : 'Note pinned');
      fetchNotes();
    } catch (error) {
      console.error('Error toggling pin:', error);
      toast.error('Failed to update note');
    }
  };


  // Add tag
  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  // Remove tag
  const handleRemoveTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      content: '',
      category: 'general',
      tags: [],
      roomLocation: '',
      attachedToVideoRecording: undefined,
      attachedToRoomId: undefined,
      videoTimestamp: undefined
    });
    setTagInput('');
    setSelectedNote(null);
  };

  // Open edit dialog
  const openEditDialog = (note: Note) => {
    setSelectedNote(note);
    setFormData({
      content: note.content,
      category: note.category,
      tags: note.tags,
      roomLocation: note.roomLocation || '',
      attachedToVideoRecording: note.attachedToVideoRecording,
      attachedToRoomId: note.attachedToRoomId,
      videoTimestamp: note.videoTimestamp
    });
    setIsEditOpen(true);
  };

  // Format date
  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return d.toLocaleDateString();
  };

  // Filtered and sorted notes
  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      if (selectedCategory !== 'all' && note.category !== selectedCategory) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          (note.title && note.title.toLowerCase().includes(query)) ||
          note.content.toLowerCase().includes(query) ||
          note.tags.some(tag => tag.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [notes, selectedCategory, searchQuery]);


  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex-1 flex flex-col sm:flex-row gap-2">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Filters */}
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(categoryConfig).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    <config.icon className={cn("h-4 w-4", config.color)} />
                    {config.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => {
          console.log('Add Note button clicked, current state:', { isCreateOpen, isEditOpen });
          setIsEditOpen(false);
          setSelectedNote(null);
          resetForm();
          setIsCreateOpen(true);
          console.log('Set isCreateOpen to true');
        }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Note
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="h-48">
              <CardHeader>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Notes grid */}
      {!loading && filteredNotes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredNotes.map((note) => {
            const category = categoryConfig[note.category];
            const CategoryIcon = category.icon;

            return (
              <Card
                key={note._id}
                className={cn(
                  "relative hover:shadow-md transition-shadow cursor-pointer border-l-4 border-gray-200",
                  note.isPinned && "ring-2 ring-primary"
                )}
                onClick={() => openEditDialog(note)}
              >
                {/* Pin indicator */}
                {note.isPinned && (
                  <div className="absolute top-2 right-2">
                    <Pin className="h-4 w-4 text-primary fill-current" />
                  </div>
                )}

                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <CategoryIcon className={cn("h-3 w-3", category.color)} />
                    <span>{category.label}</span>
                    <span>·</span>
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(note.updatedAt)}</span>
                    {note.roomLocation && (
                      <>
                        <span>·</span>
                        <MapPin className="h-3 w-3" />
                        <span>{note.roomLocation}</span>
                      </>
                    )}
                    {note.category === 'video-call' && (note.attachedToVideoRecording || note.attachedToRoomId) && (
                      <>
                        <span>·</span>
                        <Video className="h-3 w-3 text-blue-500" />
                        <span className="text-blue-600">
                          {note.attachedToRoomId ? `Room ${note.attachedToRoomId.split('-').pop()}` : 'Video Call'}
                        </span>
                      </>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100 line-clamp-4 mb-3">
                    {note.content}
                  </p>

                  {/* Tags */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {note.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          <Tag className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                      {note.tags.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{note.tags.length - 2}
                        </Badge>
                      )}
                    </div>

                    {/* Actions dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(note);
                        }}>
                          <Pin className="h-4 w-4 mr-2" />
                          {note.isPinned ? 'Unpin' : 'Pin'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(note);
                        }}>
                          <Edit3 className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNote(note);
                            setIsDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty state for no notes */}
      {!loading && notes.length === 0 && !searchQuery && selectedCategory === 'all' && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No notes yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add your first note to keep track of important information
          </p>
          <Button onClick={() => {
            console.log('Empty state Add Note button clicked');
            setIsEditOpen(false);
            setSelectedNote(null);
            resetForm();
            setIsCreateOpen(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Note
          </Button>
        </div>
      )}

      {/* No results from filters */}
      {!loading && filteredNotes.length === 0 && (searchQuery || selectedCategory !== 'all') && notes.length > 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No notes found matching your filters</p>
          <Button
            variant="link"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(open) => {
        console.log('Dialog onOpenChange called:', { open, isCreateOpen, isEditOpen });
        if (!open) {
          setIsCreateOpen(false);
          setIsEditOpen(false);
          setSelectedNote(null);
          resetForm();
        }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditOpen ? 'Edit Note' : 'Add Note'}</DialogTitle>
            <DialogDescription>
              {isEditOpen ? 'Update your note below' : 'Add a note to keep track of important information'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="content">Note</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Enter your note"
                rows={6}
                maxLength={10000}
              />
              <p className="text-xs text-muted-foreground text-right">
                {formData.content.length}/10000
              </p>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={formData.category}
                onValueChange={(value: any) => setFormData(prev => ({ ...prev, category: value }))}
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  {Object.entries(categoryConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <config.icon className={cn("h-4 w-4", config.color)} />
                        {config.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Room Location */}
            <div className="space-y-2">
              <Label htmlFor="room">Room Location (Optional)</Label>
              <Select
                value={formData.roomLocation || ''}
                onValueChange={(value) => {
                  if (value === 'add-new-room') {
                    setIsAddingNewRoom(true);
                    setNewRoomName('');
                  } else {
                    setFormData(prev => ({ ...prev, roomLocation: value }));
                  }
                }}
              >
                <SelectTrigger id="room" className="w-full">
                  <SelectValue placeholder="Select a room" />
                </SelectTrigger>
                <SelectContent>
                  {loadingRooms ? (
                    <SelectItem value="loading" disabled>
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading rooms...
                      </div>
                    </SelectItem>
                  ) : (
                    <>
                      {availableRooms.length === 0 && (
                        <SelectItem value="no-rooms" disabled>
                          No rooms available
                        </SelectItem>
                      )}
                      {availableRooms.map((room) => (
                        <SelectItem key={room} value={room}>
                          {room}
                        </SelectItem>
                      ))}
                      <SelectItem value="add-new-room">
                        <div className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          Add new room
                        </div>
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <div className="flex gap-2">
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add tags"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim()}
                >
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateOpen(false);
                setIsEditOpen(false);
                resetForm();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={isEditOpen ? handleUpdate : handleCreate}
              disabled={!formData.content || saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
{isEditOpen ? 'Update' : 'Add Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Note</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this note? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add New Room Dialog */}
      <Dialog open={isAddingNewRoom} onOpenChange={(open) => {
        setIsAddingNewRoom(open);
        if (!open) setNewRoomName('');
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Room</DialogTitle>
            <DialogDescription>
              Enter a name for the new room location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-room-name">Room Name</Label>
              <Input
                id="new-room-name"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="e.g., Living Room, Master Bedroom"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newRoomName.trim()) {
                    e.preventDefault();
                    setFormData(prev => ({ ...prev, roomLocation: newRoomName.trim() }));
                    setAvailableRooms(prev => [...prev, newRoomName.trim()].sort());
                    setIsAddingNewRoom(false);
                    setNewRoomName('');
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddingNewRoom(false);
                setNewRoomName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newRoomName.trim()) {
                  setFormData(prev => ({ ...prev, roomLocation: newRoomName.trim() }));
                  setAvailableRooms(prev => [...prev, newRoomName.trim()].sort());
                  setIsAddingNewRoom(false);
                  setNewRoomName('');
                }
              }}
              disabled={!newRoomName.trim()}
            >
              Add Room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}