import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface ImagePreviewDialogProps {
  src: string | null;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImagePreviewDialog({ src, alt, open, onOpenChange }: ImagePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl p-0 overflow-hidden bg-black [&>button[data-slot=dialog-close]]:bg-white [&>button[data-slot=dialog-close]]:text-black [&>button[data-slot=dialog-close]]:rounded-full [&>button[data-slot=dialog-close]]:size-7 [&>button[data-slot=dialog-close]]:flex [&>button[data-slot=dialog-close]]:items-center [&>button[data-slot=dialog-close]]:justify-center [&>button[data-slot=dialog-close]]:opacity-100 [&>button[data-slot=dialog-close]]:shadow-md [&>button[data-slot=dialog-close]]:ring-1 [&>button[data-slot=dialog-close]]:ring-black/20 [&>button[data-slot=dialog-close]]:z-20"
        style={{ maxHeight: '90dvh' }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{alt ?? 'Image preview'}</DialogTitle>
        {src && (
          <div className="flex items-center justify-center" style={{ maxHeight: '90dvh' }}>
            <img
              src={src}
              alt={alt ?? ''}
              className="max-w-full max-h-[90dvh] object-contain"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
