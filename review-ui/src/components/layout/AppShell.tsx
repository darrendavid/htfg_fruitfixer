import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { BottomNav } from './BottomNav';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  /** If set, shows a back arrow before the title linking to this path */
  backTo?: string;
  /** Tooltip for the back arrow (default: "Back") */
  backLabel?: string;
  /** Override title font size class (default: "text-base") */
  titleClassName?: string;
}

export function AppShell({ children, title, subtitle, backTo, backLabel, titleClassName }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {backTo && (
              <button
                onClick={() => navigate(backTo)}
                className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted transition-colors text-lg"
                title={backLabel ?? 'Back'}
              >
                &larr;
              </button>
            )}
            <div>
              <h1 className={`${titleClassName ?? 'text-base'} font-semibold leading-none`}>
                {title ?? 'HTFG Image Review'}
              </h1>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {user && (
            <button
              onClick={logout}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {user.first_name}
            </button>
          )}
        </div>
      </header>

      {/* Main content — padded bottom for nav */}
      <main className="flex-1 pb-16">
        {children}
      </main>

      {/* Bottom navigation */}
      <BottomNav />
    </div>
  );
}
