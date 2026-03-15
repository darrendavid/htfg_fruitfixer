import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ReferencePhotoGrid } from '@/components/images/ReferencePhotoGrid';
import type { QueueItem, ReferenceImage } from '@/types/api';

interface DetailPanelProps {
  item: QueueItem;
  referenceImages: ReferenceImage[];
  onClose: () => void;
}

export function DetailPanel({ item, referenceImages, onClose }: DetailPanelProps) {
  return (
    <div className="fixed inset-0 z-30 bg-background flex flex-col">
      {/* Hint to scroll back */}
      <button
        onClick={onClose}
        className="sticky top-0 z-10 w-full py-3 text-sm text-center text-muted-foreground border-b bg-background hover:bg-muted transition-colors"
      >
        ↓ Tap to go back and decide
      </button>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Match details */}
          <section>
            <h2 className="font-semibold mb-3">Match Details</h2>
            <Separator className="mb-3" />
            <dl className="space-y-2 text-sm">
              {item.match_type && (
                <div>
                  <dt className="text-muted-foreground">Match Type</dt>
                  <dd className="font-mono">{item.match_type}</dd>
                </div>
              )}
              {item.reasoning && (
                <div>
                  <dt className="text-muted-foreground">Reasoning</dt>
                  <dd>{item.reasoning}</dd>
                </div>
              )}
              {item.source_directories && (
                <div>
                  <dt className="text-muted-foreground">Source Directories</dt>
                  <dd className="font-mono text-xs">{item.source_directories}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Image Path</dt>
                <dd className="font-mono text-xs break-all">{item.image_path}</dd>
              </div>
            </dl>
          </section>

          {/* Reference photos */}
          <section>
            <h2 className="font-semibold mb-3">Reference Photos</h2>
            <Separator className="mb-3" />
            <ReferencePhotoGrid images={referenceImages} />
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
