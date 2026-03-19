import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LazyImage } from '@/components/images/LazyImage';
import { ScrollArea } from '@/components/ui/scroll-area';
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
}

export function OcrTab({ ocrExtractions }: OcrTabProps) {
  if (ocrExtractions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No OCR extractions available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ocrExtractions.map((ocr) => {
        const keyFacts = parseKeyFacts(ocr.Key_Facts);

        return (
          <Card key={ocr.Id} className="p-4">
            <div className="flex items-start gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm select-text">{ocr.Title}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">{ocr.Content_Type}</Badge>
            </div>

            <div className="space-y-3">
              {/* Key facts table */}
              {keyFacts.length > 0 && (
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {keyFacts.map((fact, i) => (
                        <tr key={i} className="border-b last:border-b-0">
                          <td className="px-2 py-1 font-medium text-muted-foreground bg-muted/50 w-1/3 select-text">
                            {fact.field}
                          </td>
                          <td className="px-2 py-1 select-text">{fact.value}</td>
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
                  <ScrollArea className="max-h-60">
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground select-text">
                      {ocr.Extracted_Text}
                    </p>
                  </ScrollArea>
                </div>
              )}

              {/* Source image */}
              {ocr.Image_Path && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Source Image</h4>
                  <LazyImage
                    src={`/images/${ocr.Image_Path}`}
                    alt={ocr.Title}
                    className="max-w-full max-h-64 rounded"
                  />
                </div>
              )}

              {ocr.Source_Context && (
                <p className="text-xs text-muted-foreground select-text">Context: {ocr.Source_Context}</p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
