import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { BrowseDocument } from '@/types/browse';

interface DocumentsTabProps {
  documents: BrowseDocument[];
}

export function DocumentsTab({ documents }: DocumentsTabProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-lg text-muted-foreground">No documents available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => {
        const isExpanded = expandedId === doc.Id;
        return (
          <Card
            key={doc.Id}
            className={cn('p-4 cursor-pointer transition-colors hover:bg-muted/50', isExpanded && 'ring-1 ring-ring')}
            onClick={() => setExpandedId(isExpanded ? null : doc.Id)}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{doc.Title}</p>
                {doc.Content_Preview && !isExpanded && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {doc.Content_Preview}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="shrink-0">{doc.Doc_Type}</Badge>
            </div>

            {isExpanded && doc.Content_Text && (
              <ScrollArea className="mt-3 max-h-80">
                <p className="text-sm whitespace-pre-wrap">{doc.Content_Text}</p>
              </ScrollArea>
            )}

            {isExpanded && !doc.Content_Text && doc.Content_Preview && (
              <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
                {doc.Content_Preview}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
