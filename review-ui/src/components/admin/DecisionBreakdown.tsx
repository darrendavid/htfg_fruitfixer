import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AdminStats } from '@/types/api';

const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  confirm: { label: 'Confirmed', icon: '✓' },
  reject: { label: 'Rejected', icon: '✕' },
  classify: { label: 'Classified', icon: '🏷' },
  discard: { label: 'Discarded', icon: '🗑' },
  idk: { label: 'IDK escalated', icon: '?' },
};

interface DecisionBreakdownProps {
  stats: AdminStats;
}

export function DecisionBreakdown({ stats }: DecisionBreakdownProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Decision Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {Object.entries(ACTION_LABELS).map(([action, { label, icon }]) => (
            <div key={action} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{icon} {label}</span>
              <span className="font-medium">{(stats.decisions_by_action[action] ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
