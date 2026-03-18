import { NavLink } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/swipe', label: 'Swipe', icon: '👆' },
  { to: '/classify', label: 'Classify', icon: '🏷️' },
  { to: '/ocr-review', label: 'OCR', icon: '📝' },
  { to: '/plants', label: 'Plants', icon: '🌱' },
  { to: '/leaderboard', label: 'Stats', icon: '📊' },
];

const adminItem = { to: '/admin', label: 'Admin', icon: '⚙️' };

export function BottomNav() {
  const user = useCurrentUser();
  const items = user?.role === 'admin' ? [...navItems, adminItem] : navItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
      <div className="flex h-12 items-stretch">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors min-h-[44px]',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
