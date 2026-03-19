import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import type { StaffNote, BrowseVariety } from '@/types/browse';

interface NotesTabProps {
  plantId: string;
  notes: StaffNote[];
  varieties: BrowseVariety[];
  onNotesChanged: (notes: StaffNote[]) => void;
}

export function NotesTab({ plantId, notes, varieties, onNotesChanged }: NotesTabProps) {
  const { user } = useAuth();
  const [newText, setNewText] = useState('');
  const [newVarietyId, setNewVarietyId] = useState<string>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const handleSubmit = async () => {
    if (!newText.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = { text: newText.trim() };
      if (newVarietyId !== 'none') body.variety_id = Number(newVarietyId);

      const res = await fetch(`/api/browse/${plantId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        onNotesChanged([...notes, data]);
        setNewText('');
        setNewVarietyId('none');
        toast.success('Note added');
      } else {
        toast.error('Failed to add note');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (noteId: number) => {
    if (!editText.trim()) return;
    try {
      const res = await fetch(`/api/browse/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText.trim() }),
        credentials: 'include',
      });
      if (res.ok) {
        onNotesChanged(notes.map((n) => (n.id === noteId ? { ...n, text: editText.trim() } : n)));
        setEditingId(null);
        toast.success('Note updated');
      }
    } catch {
      toast.error('Failed to update note');
    }
  };

  const handleDelete = async (noteId: number) => {
    try {
      const res = await fetch(`/api/browse/notes/${noteId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        onNotesChanged(notes.filter((n) => n.id !== noteId));
        toast.success('Note deleted');
      }
    } catch {
      toast.error('Failed to delete note');
    }
  };

  const canModify = (note: StaffNote) =>
    user?.id === note.user_id || user?.role === 'admin';

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* Existing notes */}
      {notes.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No notes yet. Add the first one below.</p>
      )}

      {notes.map((note) => (
        <div key={note.id} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">{note.user_name}</span>
              <span className="text-xs text-muted-foreground ml-2">{formatDate(note.created_at)}</span>
            </div>
            {canModify(note) && editingId !== note.id && (
              <div className="flex gap-1">
                {user?.id === note.user_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(note.id);
                      setEditText(note.text);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => handleDelete(note.id)}
                >
                  Delete
                </Button>
              </div>
            )}
          </div>

          {editingId === note.id ? (
            <div className="space-y-2">
              <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleUpdate(note.id)}>Save</Button>
                <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{note.text}</p>
          )}

          {note.variety_id && (
            <p className="text-xs text-muted-foreground">
              Variety: {varieties.find((v) => v.Id === note.variety_id)?.Variety_Name ?? `#${note.variety_id}`}
            </p>
          )}
        </div>
      ))}

      {/* Add note form */}
      <div className="rounded-lg border p-3 space-y-3">
        <h4 className="text-sm font-medium">Add a note</h4>
        <Textarea
          placeholder="Write a note..."
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={3}
        />
        {varieties.length > 0 && (
          <Select value={newVarietyId} onValueChange={setNewVarietyId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Associate with variety (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No variety</SelectItem>
              {varieties.map((v) => (
                <SelectItem key={v.Id} value={String(v.Id)}>
                  {v.Variety_Name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" onClick={handleSubmit} disabled={!newText.trim() || isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add Note'}
        </Button>
      </div>
    </div>
  );
}
