import { Skeleton } from '@/components/ui/skeleton';

interface PlantGroupItem {
  id: string;
  label: string;
  count: number;
}

interface PlantGroupSidebarProps {
  title: string;
  subtitle: string;
  groups: PlantGroupItem[];
  selectedId: string | null;
  liveCounts?: Map<string, number>;
  isLoading: boolean;
  onSelect: (id: string) => void;
}

export function PlantGroupSidebar({
  title, subtitle, groups, selectedId, liveCounts, isLoading, onSelect
}: PlantGroupSidebarProps) {
  return (
    <aside className="w-[250px] shrink-0 border-r flex flex-col overflow-hidden">
      <div className="p-3 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-1">
            {[1, 2, 3].map(n => <Skeleton key={n} className="h-7 w-full" />)}
          </div>
        ) : (
          groups.map(g => {
            const liveCount = liveCounts?.get(g.id) ?? g.count;
            const isDone = liveCount === 0;
            return (
              <button
                key={g.id}
                className={`w-full text-left px-3 py-2 text-xs transition-colors border-b truncate ${
                  selectedId === g.id
                    ? 'bg-accent font-medium'
                    : isDone ? 'opacity-40 hover:bg-muted' : 'hover:bg-muted'
                }`}
                onClick={() => onSelect(g.id)}
                title={g.label}
              >
                {g.label}
                <span className={`float-right ${isDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {isDone ? '✓' : liveCount}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
