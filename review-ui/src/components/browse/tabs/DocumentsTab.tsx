import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { SimplePlantReassignField } from '@/components/browse/PlantAutocomplete';
import type { BrowseDocument } from '@/types/browse';

interface DocumentsTabProps {
  documents: BrowseDocument[];
}

export function DocumentsTab({ documents: initialDocuments }: DocumentsTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [documents, setDocuments] = useState(initialDocuments);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  const selectedDoc = selectedIndex !== null ? documents[selectedIndex] : null;

  const openDialog = (index: number) => {
    setSelectedIndex(index);
    const doc = documents[index];
    setEditTitle(doc.Title);
    setEditContent(doc.Content_Text ?? doc.Content_Preview ?? '');
  };

  const closeDialog = () => {
    setSelectedIndex(null);
  };

  const goNext = useCallback(() => {
    if (selectedIndex === null) return;
    if (selectedIndex < documents.length - 1) {
      const next = selectedIndex + 1;
      setSelectedIndex(next);
      setEditTitle(documents[next].Title);
      setEditContent(documents[next].Content_Text ?? documents[next].Content_Preview ?? '');
    }
  }, [selectedIndex, documents]);

  const goPrev = useCallback(() => {
    if (selectedIndex === null) return;
    if (selectedIndex > 0) {
      const prev = selectedIndex - 1;
      setSelectedIndex(prev);
      setEditTitle(documents[prev].Title);
      setEditContent(documents[prev].Content_Text ?? documents[prev].Content_Preview ?? '');
    }
  }, [selectedIndex, documents]);

  const handleSave = useCallback(async () => {
    if (!selectedDoc || !isAdmin) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/browse/documents/${selectedDoc.Id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Title: editTitle, Content_Text: editContent }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDocuments((prev) =>
          prev.map((d) => (d.Id === updated.Id ? { ...d, ...updated } : d))
        );
      }
    } catch {
      // error
    } finally {
      setIsSaving(false);
    }
  }, [selectedDoc, isAdmin, editTitle, editContent]);

  const handleDelete = useCallback(async () => {
    if (!selectedDoc || !isAdmin) return;
    if (!confirm(`Delete document "${selectedDoc.Title}"?`)) return;
    try {
      const res = await fetch(`/api/browse/documents/${selectedDoc.Id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setDocuments((prev) => {
          const next = prev.filter((d) => d.Id !== selectedDoc.Id);
          if (next.length === 0 || selectedIndex === null) {
            closeDialog();
          } else if (selectedIndex >= next.length) {
            setSelectedIndex(next.length - 1);
            setEditTitle(next[next.length - 1].Title);
            setEditContent(next[next.length - 1].Content_Text ?? next[next.length - 1].Content_Preview ?? '');
          } else {
            setEditTitle(next[selectedIndex].Title);
            setEditContent(next[selectedIndex].Content_Text ?? next[selectedIndex].Content_Preview ?? '');
          }
          return next;
        });
      }
    } catch {
      // error
    }
  }, [selectedDoc, isAdmin, selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (selectedIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'x' && isAdmin) { e.preventDefault(); handleDelete(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedIndex, goNext, goPrev, handleDelete, isAdmin]);

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No documents available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc, idx) => (
        <Card
          key={doc.Id}
          className="p-4 cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => openDialog(idx)}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">{doc.Title}</p>
              {doc.Content_Preview && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {doc.Content_Preview}
                </p>
              )}
            </div>
            <Badge variant="secondary" className="shrink-0">{doc.Doc_Type}</Badge>
          </div>
        </Card>
      ))}

      {/* Document Dialog */}
      <Dialog open={selectedIndex !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">{selectedDoc?.Title ?? 'Document'}</DialogTitle>
          {selectedDoc && (
            <div className="flex flex-col gap-3 min-h-0">
              {/* Navigation indicator */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {(selectedIndex ?? 0) + 1} / {documents.length}
                </span>
                <Badge variant="secondary">{selectedDoc.Doc_Type}</Badge>
              </div>

              {/* Title */}
              {isAdmin ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-lg font-bold border rounded px-2 py-1 w-full bg-background"
                />
              ) : (
                <h2 className="text-lg font-bold">{selectedDoc.Title}</h2>
              )}

              {/* Content */}
              {isAdmin ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="text-sm whitespace-pre-wrap border rounded px-3 py-2 w-full min-h-[150px] max-h-[40vh] resize-y bg-background font-mono flex-1"
                />
              ) : (
                <div className="text-sm whitespace-pre-wrap max-h-[40vh] overflow-y-auto border rounded px-3 py-2 flex-1">
                  {selectedDoc.Content_Text ?? selectedDoc.Content_Preview ?? 'No content'}
                </div>
              )}

              {/* File path */}
              <p className="text-xs text-muted-foreground font-mono break-all">
                {selectedDoc.Original_File_Path}
              </p>

              {/* Plant IDs */}
              {selectedDoc.Plant_Ids && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-muted-foreground">Plants:</span>
                  {selectedDoc.Plant_Ids.split(',').map((id) => (
                    <Badge key={id.trim()} variant="outline" className="text-xs">
                      {id.trim()}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Plant reassignment */}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Move to:</span>
                  <div className="flex-1">
                    <SimplePlantReassignField
                      itemId={selectedDoc.Id}
                      endpoint="reassign-document"
                      onReassigned={(plantId) => {
                        setDocuments((prev) => prev.filter((d) => d.Id !== selectedDoc.Id));
                        if (documents.length <= 1) closeDialog();
                        else if (selectedIndex !== null && selectedIndex >= documents.length - 1) {
                          setSelectedIndex(documents.length - 2);
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={goPrev} disabled={selectedIndex === 0}>
                    &larr; Prev
                  </Button>
                  <Button variant="outline" size="sm" onClick={goNext} disabled={selectedIndex === documents.length - 1}>
                    Next &rarr;
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {selectedDoc.Original_File_Path && (
                    <a
                      href={`/content-files/${selectedDoc.Original_File_Path.replace(/^content\//, '')}`}
                      download={selectedDoc.Original_File_Path.split('/').pop()}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm" title="Download">
                        Download
                      </Button>
                    </a>
                  )}
                  {isAdmin && (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving}
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDelete}
                        title="Delete document (x)"
                      >
                        Delete (x)
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" onClick={closeDialog}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
