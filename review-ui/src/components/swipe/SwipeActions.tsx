import { Button } from '@/components/ui/button';

interface SwipeActionsProps {
  onConfirm: () => void;
  onReject: () => void;
  onIdk: () => void;
  onIgnore: () => void;
  isSubmitting: boolean;
}

export function SwipeActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting }: SwipeActionsProps) {
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="destructive"
          size="lg"
          className="flex-1 min-h-[48px] text-base font-bold"
          onClick={onReject}
          disabled={isSubmitting}
        >
          ← REJECT
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="min-h-[48px] px-4 text-muted-foreground"
          onClick={onIdk}
          disabled={isSubmitting}
        >
          ? IDK
        </Button>
        <Button
          size="lg"
          className="flex-1 min-h-[48px] text-base font-bold bg-green-600 hover:bg-green-700 text-white"
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          CONFIRM →
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground/60 hover:text-muted-foreground"
        onClick={onIgnore}
        disabled={isSubmitting}
      >
        Ignore (not relevant to database)
      </Button>
    </div>
  );
}
