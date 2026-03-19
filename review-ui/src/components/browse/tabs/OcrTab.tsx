import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LazyImage } from '@/components/images/LazyImage';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import type { BrowseOcr } from '@/types/browse';

interface KeyFact {
  field: string;
  value: string;
}

function parseKeyFacts(raw: string | null): KeyFact[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

interface OcrTabProps {
  ocrExtractions: BrowseOcr[];
  onOcrDeleted?: (id: number) => void;
}

export function OcrTab({ ocrExtractions, onOcrDeleted }: OcrTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState(ocrExtractions);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [viewingImage, setViewingImage] = useState<{ src: string; title: string } | null>(null);

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/browse/ocr-extractions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setItems((prev) => prev.filter((o) => o.Id !== id));
        onOcrDeleted?.(id);
      }
    } catch {
      // error
    } finally {
      setDeletingId(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No OCR extractions available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((ocr) => {
        const keyFacts = parseKeyFacts(ocr.Key_Facts);

        return (
          <Card key={ocr.Id} className="p-4 overflow-hidden">
            <div className="flex items-start gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm select-text break-words">{ocr.Title}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">{ocr.Content_Type}</Badge>
              {isAdmin && (
                deletingId === ocr.Id ? (
                  <div className="flex gap-1 shrink-0">
                    <Button variant="destructive" size="sm" className="h-6 text-xs" onClick={() => handleDelete(ocr.Id)}>
                      Confirm
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setDeletingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-destructive hover:text-destructive shrink-0"
                    onClick={() => setDeletingId(ocr.Id)}
                  >
                    Delete
                  </Button>
                )
              )}
            </div>

            <div className="space-y-3">
              {/* Source image — shown first so text doesn't overlap */}
              {ocr.Image_Path && (
                <div className="clear-both">
                  <h4 className="text-sm font-medium mb-1">Source Image</h4>
                  <div
                    className="cursor-pointer hover:opacity-80 transition-opacity inline-block"
                    onClick={() => setViewingImage({
                      src: `/content-files/${ocr.Image_Path.replace(/^content\//, '')}`,
                      title: ocr.Title,
                    })}
                  >
                    <img
                      src={`/content-files/${ocr.Image_Path.replace(/^content\//, '')}`}
                      alt={ocr.Title}
                      className="max-w-full max-h-48 rounded border"
                      loading="lazy"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">Click to view full size</p>
                  </div>
                </div>
              )}

              {/* Key facts table */}
              {keyFacts.length > 0 && (
                <div className="rounded border overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <tbody>
                      {keyFacts.map((fact, i) => (
                        <tr key={i} className="border-b last:border-b-0">
                          <td className="px-2 py-1 font-medium text-muted-foreground bg-muted/50 w-1/3 select-text break-words">
                            {fact.field}
                          </td>
                          <td className="px-2 py-1 select-text break-words">{fact.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Extracted text */}
              {ocr.Extracted_Text && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Extracted Text</h4>
                  <div className="max-h-60 overflow-y-auto border rounded p-2">
                    <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground select-text">
                      {ocr.Extracted_Text}
                    </p>
                  </div>
                </div>
              )}

              {ocr.Source_Context && (
                <p className="text-xs text-muted-foreground select-text break-words mt-1">Context: {ocr.Source_Context}</p>
              )}
            </div>
          </Card>
        );
      })}

      {/* Full-size image viewer dialog */}
      <Dialog open={viewingImage !== null} onOpenChange={(open) => { if (!open) setViewingImage(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-2 flex flex-col overflow-hidden">
          <DialogTitle className="sr-only">{viewingImage?.title ?? 'Image'}</DialogTitle>
          {viewingImage && (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={viewingImage.src}
                alt={viewingImage.title}
                className="max-w-full max-h-[80vh] object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
