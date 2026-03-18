import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LazyImage } from '@/components/images/LazyImage';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
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
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (ocrExtractions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No OCR extractions available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ocrExtractions.map((ocr) => {
        const isExpanded = expandedId === ocr.Id;
        const keyFacts = parseKeyFacts(ocr.Key_Facts);

        return (
          <Card
            key={ocr.Id}
            className={cn('p-4 cursor-pointer transition-colors hover:bg-muted/50', isExpanded && 'ring-1 ring-ring')}
            onClick={() => setExpandedId(isExpanded ? null : ocr.Id)}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{ocr.Title}</p>
                {keyFacts.length > 0 && !isExpanded && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {keyFacts.length} key fact{keyFacts.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="shrink-0">{ocr.Content_Type}</Badge>
            </div>

            {/* Key facts mini-table (always shown if present) */}
            {keyFacts.length > 0 && !isExpanded && (
              <div className="mt-2 space-y-0.5">
                {keyFacts.slice(0, 3).map((fact, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">{fact.field}:</span>
                    <span>{fact.value}</span>
                  </div>
                ))}
                {keyFacts.length > 3 && (
                  <p className="text-xs text-muted-foreground">+{keyFacts.length - 3} more...</p>
                )}
              </div>
            )}

            {isExpanded && (
              <div className="mt-3 space-y-3">
                {/* Full key facts table */}
                {keyFacts.length > 0 && (
                  <div className="rounded border overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {keyFacts.map((fact, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            <td className="px-2 py-1 font-medium text-muted-foreground bg-muted/50 w-1/3">
                              {fact.field}
                            </td>
                            <td className="px-2 py-1">{fact.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Full extracted text */}
                {ocr.Extracted_Text && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Extracted Text</h4>
                    <ScrollArea className="max-h-60">
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">Context: {ocr.Source_Context}</p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
