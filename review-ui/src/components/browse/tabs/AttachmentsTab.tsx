import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { SimplePlantReassignField } from '@/components/browse/PlantAutocomplete';
import type { BrowseAttachment } from '@/types/browse';

interface AttachmentsTabProps {
  plantId: string;
  attachments: BrowseAttachment[];
  editMode: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileTypeColor(type: string): string {
  const t = (type || '').toUpperCase();
  if (t.includes('PDF')) return 'text-red-500';
  if (t.includes('PPT') || t.includes('POWERPOINT')) return 'text-orange-500';
  if (t.includes('DOC') || t.includes('WORD')) return 'text-blue-500';
  if (t.includes('XLS') || t.includes('EXCEL') || t.includes('SPREADSHEET')) return 'text-green-500';
  return 'text-gray-500';
}

function fileTypeIcon(type: string): string {
  const t = (type || '').toUpperCase();
  if (t.includes('PDF')) return 'PDF';
  if (t.includes('PPT') || t.includes('POWERPOINT')) return 'PPT';
  if (t.includes('DOC') || t.includes('WORD')) return 'DOC';
  if (t.includes('XLS') || t.includes('EXCEL') || t.includes('SPREADSHEET')) return 'XLS';
  return 'FILE';
}

export function AttachmentsTab({ plantId, attachments: initialAttachments, editMode }: AttachmentsTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [attachments, setAttachments] = useState(initialAttachments);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAttachment, setNewAttachment] = useState({
    Title: '',
    File_Path: '',
    File_Type: '',
    Description: '',
  });

  useEffect(() => {
    setAttachments(initialAttachments);
  }, [initialAttachments]);

  const startEditing = (att: BrowseAttachment) => {
    setEditingId(att.Id);
    setEditTitle(att.Title);
    setEditDescription(att.Description ?? '');
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const handleSave = async (att: BrowseAttachment) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/browse/attachments/${att.Id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Title: editTitle, Description: editDescription }),
      });
      if (res.ok) {
        const updated = await res.json();
        setAttachments((prev) =>
          prev.map((a) => (a.Id === updated.Id ? { ...a, ...updated } : a))
        );
        setEditingId(null);
      }
    } catch {
      // error
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (att: BrowseAttachment) => {
    if (!confirm(`Delete attachment "${att.Title}"?`)) return;
    try {
      const res = await fetch(`/api/browse/attachments/${att.Id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setAttachments((prev) => prev.filter((a) => a.Id !== att.Id));
      }
    } catch {
      // error
    }
  };

  const handleAdd = async () => {
    if (!newAttachment.Title || !newAttachment.File_Path) return;
    try {
      const res = await fetch(`/api/browse/${plantId}/attachments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Title: newAttachment.Title,
          File_Path: newAttachment.File_Path,
          File_Name: newAttachment.File_Path.split('/').pop() || '',
          File_Type: newAttachment.File_Type || 'unknown',
          File_Size: 0,
          Description: newAttachment.Description || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setAttachments((prev) => [...prev, created]);
        setNewAttachment({ Title: '', File_Path: '', File_Type: '', Description: '' });
        setShowAddForm(false);
      }
    } catch {
      // error
    }
  };

  if (attachments.length === 0 && !showAddForm) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
        <p className="text-lg text-muted-foreground">No attachments available</p>
        {isAdmin && editMode && (
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}>
            + Add Attachment
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{attachments.length} attachment{attachments.length !== 1 ? 's' : ''}</p>
        {isAdmin && editMode && (
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : '+ Add Attachment'}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground italic">
        File uploads will be available after migration to final deployment.
      </p>

      {/* Add form */}
      {showAddForm && isAdmin && (
        <Card className="p-4 space-y-3 border-dashed border-2">
          <h3 className="font-semibold text-sm">Add New Attachment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Title *</label>
              <input
                type="text"
                value={newAttachment.Title}
                onChange={(e) => setNewAttachment({ ...newAttachment, Title: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                placeholder="Document title"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">File Type</label>
              <input
                type="text"
                value={newAttachment.File_Type}
                onChange={(e) => setNewAttachment({ ...newAttachment, File_Type: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                placeholder="pdf, pptx, docx, etc."
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">File Path *</label>
            <input
              type="text"
              value={newAttachment.File_Path}
              onChange={(e) => setNewAttachment({ ...newAttachment, File_Path: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm bg-background font-mono"
              placeholder="content/source/path/to/file.pdf"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea
              value={newAttachment.Description}
              onChange={(e) => setNewAttachment({ ...newAttachment, Description: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm bg-background resize-y min-h-[60px]"
              placeholder="Optional description"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!newAttachment.Title || !newAttachment.File_Path}>
              Add
            </Button>
          </div>
        </Card>
      )}

      {/* Attachment cards */}
      {attachments.map((att) => {
        const isEditing = editingId === att.Id;
        return (
          <Card key={att.Id} className="p-4">
            <div className="flex items-start gap-3">
              {/* File type icon */}
              <div className={`shrink-0 w-10 h-10 rounded flex items-center justify-center text-xs font-bold bg-muted ${fileTypeColor(att.File_Type)}`}>
                {fileTypeIcon(att.File_Type)}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                {isEditing ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="font-bold text-sm border rounded px-2 py-1 w-full bg-background"
                  />
                ) : (
                  <p className="font-bold text-sm">{att.Title}</p>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{att.File_Type}</Badge>
                  {att.File_Size > 0 && (
                    <span className="text-xs text-muted-foreground">{formatFileSize(att.File_Size)}</span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground font-mono break-all">{att.File_Path}</p>

                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="text-sm border rounded px-2 py-1 w-full bg-background resize-y min-h-[60px]"
                    placeholder="Description"
                  />
                ) : (
                  att.Description && (
                    <p className="text-sm text-muted-foreground">{att.Description}</p>
                  )
                )}
              </div>

              {/* Action buttons — download always visible, edit/delete for admin */}
              <div className="flex items-center gap-1 shrink-0">
                {isEditing ? (
                  <>
                    <Button variant="default" size="sm" onClick={() => handleSave(att)} disabled={isSaving}>
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={cancelEditing}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <a
                      href={`/content-files/${att.File_Path?.replace(/^content\//, '')}`}
                      download={att.File_Name}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button variant="outline" size="sm" title="Download">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                          <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                          <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                        </svg>
                      </Button>
                    </a>
                    {isAdmin && editMode && (
                      <Button variant="outline" size="sm" onClick={() => startEditing(att)} title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                          <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                          <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25h5.5a.75.75 0 0 0 0-1.5h-5.5A2.75 2.75 0 0 0 2 5.75v8.5A2.75 2.75 0 0 0 4.75 17h8.5A2.75 2.75 0 0 0 16 14.25v-5.5a.75.75 0 0 0-1.5 0v5.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" />
                        </svg>
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(att)} title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022 1.005 11.36A2.75 2.75 0 0 0 7.76 20h4.48a2.75 2.75 0 0 0 2.742-2.489l1.005-11.36.149.022a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 1 .7.8l-.5 5.5a.75.75 0 0 1-1.496-.136l.5-5.5a.75.75 0 0 1 .796-.664Zm2.84 0a.75.75 0 0 1 .796.664l.5 5.5a.75.75 0 1 1-1.496.136l-.5-5.5a.75.75 0 0 1 .7-.8Z" clipRule="evenodd" />
                        </svg>
                      </Button>
                    )}
                  </>
                )}
              </div>
              {isAdmin && editMode && (
                <div className="mt-2 pt-2 border-t">
                  <SimplePlantReassignField
                    itemId={att.Id}
                    endpoint="reassign-attachment"
                    inputClassName="h-7 text-xs"
                    onReassigned={() => {
                      setAttachments((prev) => prev.filter((a) => a.Id !== att.Id));
                    }}
                  />
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
