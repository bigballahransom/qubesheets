// components/VideoCallNotes.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  MoreVertical,
  Trash2,
  Edit3,
  User,
  Calendar,
  X,
  Loader2,
  Check,
  Send
} from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUser } from '@clerk/nextjs';

interface Note {
  _id: string;
  content: string;
  category: 'video-call';
  tags: string[];
  attachedToVideoRecording?: string;
  attachedToRoomId?: string;
  videoTimestamp?: number;
  userId: string;
  userName?: string;
  createdAt: string;
  updatedAt: string;
}

interface VideoCallNotesProps {
  projectId: string;
  recordingId?: string; // Optional - might not have it during live calls
  roomId?: string; // For live calls
}

export default function VideoCallNotes({ 
  projectId, 
  recordingId, 
  roomId
}: VideoCallNotesProps) {
  const { user } = useUser();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Fetch notes for this video recording
  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
      
      // When viewing a recording, search for notes with either the recordingId or roomId
      // This ensures we find notes created during the live call (with roomId)
      // and notes that have been migrated (with recordingId)
      if (recordingId && recordingId !== 'undefined') {
        params.append('attachedToVideoRecording', recordingId);
        if (roomId) {
          params.append('attachedToRoomId', roomId);
        }
      } else if (roomId) {
        // During live call, only use roomId
        params.append('attachedToRoomId', roomId);
      }

      console.log('Fetching notes - recordingId:', recordingId, 'roomId:', roomId);
      console.log('Fetching notes with params:', params.toString());
      
      const response = await fetch(`/api/projects/${projectId}/notes?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch notes');
      }

      const data = await response.json();
      console.log('Notes response:', data);
      setNotes(data.notes || []);
    } catch (error) {
      console.error('Error fetching notes:', error);
      toast.error('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [projectId, recordingId, roomId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Create note
  const handleCreate = async () => {
    if (!newNoteContent.trim()) return;
    
    try {
      setSaving(true);
      const noteData: any = {
        content: newNoteContent.trim(),
        category: 'video-call',
        tags: []
      };
      
      // Use recordingId if available, otherwise use roomId
      if (recordingId && recordingId !== 'undefined') {
        noteData.attachedToVideoRecording = recordingId;
      } else if (roomId) {
        noteData.attachedToRoomId = roomId;
      }

      const response = await fetch(`/api/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteData)
      });
      
      if (!response.ok) {
        throw new Error('Failed to create note');
      }

      const result = await response.json();
      
      toast.success('Note added');
      setNewNoteContent('');
      fetchNotes();
    } catch (error) {
      console.error('Error creating note:', error);
      toast.error('Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  // Update note
  const handleUpdate = async (noteId: string) => {
    if (!editContent.trim()) return;

    try {
      setSavingId(noteId);
      const updateData = {
        content: editContent.trim()
      };

      const response = await fetch(`/api/projects/${projectId}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) throw new Error('Failed to update note');

      toast.success('Note updated');
      setEditingId(null);
      setEditContent('');
      fetchNotes();
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error('Failed to update note');
    } finally {
      setSavingId(null);
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

      toast.success('Note deleted');
      setIsDeleteOpen(false);
      setSelectedNote(null);
      fetchNotes();
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('Failed to delete note');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (note: Note) => {
    setEditingId(note._id);
    setEditContent(note.content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent('');
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

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-600">Loading notes...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notes.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600">No notes yet</p>
            <p className="text-xs text-gray-500 mt-1">Add notes to document important points from the call</p>
          </div>
        ) : (
          notes.map((note) => (
            <Card key={note._id} className="group hover:shadow-sm transition-shadow">
              <CardContent className="p-3">
                {editingId === note._id ? (
                  // Edit mode
                  <div className="space-y-2">
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-[80px] resize-none text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelEditing}
                        disabled={savingId === note._id}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleUpdate(note._id)}
                        disabled={!editContent.trim() || savingId === note._id}
                      >
                        {savingId === note._id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Note header */}
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <User className="h-3 w-3" />
                        <span>{note.userName || 'Unknown User'}</span>
                        <span>·</span>
                        <Calendar className="h-3 w-3" />
                        <span>{formatDate(note.createdAt)}</span>
                      </div>
                      
                      {/* Note content */}
                      <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                        {note.content}
                      </p>
                    </div>

                    {/* Actions dropdown */}
                    {user?.id === note.userId && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startEditing(note)}>
                            <Edit3 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setSelectedNote(note);
                              setIsDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add new note section */}
      <div className="border-t bg-gray-50 dark:bg-gray-900 p-4">
        <div className="flex gap-2">
          <Textarea
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Add a note..."
            className="min-h-[60px] resize-none flex-1 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
            disabled={saving}
          />
          <Button
            onClick={handleCreate}
            disabled={!newNoteContent.trim() || saving}
            size="sm"
            className="self-end"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Press Enter to send, Shift+Enter for new line</p>
      </div>

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
    </div>
  );
}