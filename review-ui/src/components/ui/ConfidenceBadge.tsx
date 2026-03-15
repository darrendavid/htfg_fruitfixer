import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ConfidenceBadgeProps {
  confidence: string | null;
  className?: string;
}

const confidenceConfig: Record<string, { label: string; className: string }> = {
  high: { label: '●●● High', className: 'bg-green-100 text-green-800 border-green-200' },
  medium: { label: '●●○ Medium', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  low: { label: '●○○ Low', className: 'bg-red-100 text-red-800 border-red-200' },
  auto: { label: '⚡ Auto', className: 'bg-blue-100 text-blue-800 border-blue-200' },
};

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const config = confidence ? confidenceConfig[confidence] : null;
  if (!config) return null;

  return (
    <Badge
      variant="outline"
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
