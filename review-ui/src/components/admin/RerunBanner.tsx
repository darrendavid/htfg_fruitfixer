import { Alert, AlertDescription } from '@/components/ui/alert';

interface RerunBannerProps {
  count: number;
  threshold?: number;
}

export function RerunBanner({ count, threshold = 5 }: RerunBannerProps) {
  if (count === 0) return null;
  const ready = count >= threshold;
  return (
    <Alert className={ready ? 'border-amber-400 bg-amber-50 text-amber-900' : ''}>
      <AlertDescription>
        {ready
          ? `⚠ Phase 4B Re-run Ready — ${count}/${threshold} new plants (threshold reached)`
          : `${count}/${threshold} new plants toward re-run threshold`}
      </AlertDescription>
    </Alert>
  );
}
