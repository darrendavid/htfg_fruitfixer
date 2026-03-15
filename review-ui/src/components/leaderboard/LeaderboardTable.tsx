import { cn } from '@/lib/utils';
import type { LeaderboardEntry } from '@/types/api';
import type { User } from '@/types/api';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  currentUser: User | null;
}

const medalColors: Record<number, string> = {
  1: 'text-yellow-600',
  2: 'text-slate-400',
  3: 'text-amber-700',
};

export function LeaderboardTable({ entries, currentUser }: LeaderboardTableProps) {
  return (
    <div>
      <h2 className="font-semibold mb-3">Top Reviewers (All Time)</h2>
      <div className="space-y-1">
        {entries.map((entry) => {
          const isMe = currentUser && entry.user_id === currentUser.id;
          return (
            <div
              key={entry.user_id}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                isMe ? 'bg-accent font-medium' : 'hover:bg-muted'
              )}
            >
              <span className={cn('w-6 text-center font-bold', medalColors[entry.rank] ?? 'text-muted-foreground')}>
                {entry.rank}
              </span>
              <span className="flex-1">
                {isMe ? 'You' : entry.display_name}
              </span>
              <span className="text-muted-foreground">{entry.count.toLocaleString()}</span>
            </div>
          );
        })}
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground px-3">No reviews yet.</p>
        )}
      </div>
    </div>
  );
}
