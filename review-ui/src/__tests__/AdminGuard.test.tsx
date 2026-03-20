/**
 * AdminGuard component tests.
 *
 * AdminGuard has three distinct routing behaviours:
 *   1. user=null              → <Navigate to="/admin/login" />
 *   2. user.role='reviewer'   → <Navigate to="/swipe" />
 *   3. user.role='admin'      → renders children
 *
 * isLoading=true shows a skeleton (same pattern as AuthGuard, tested briefly).
 *
 * No DOM/RTL required — we call the component as a plain function and inspect
 * the returned React element tree.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// ── Mock dependencies before importing the component ─────────────────────────

let _user: { id: number; email: string; first_name: string; last_name: string; role: 'reviewer' | 'admin' } | null = null;
let _isLoading = false;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: _user, isLoading: _isLoading }),
}));

let MockNavigate: React.FC<any>;
vi.mock('react-router-dom', () => {
  MockNavigate = (props: any) => React.createElement('div', props);
  return { Navigate: MockNavigate };
});

let MockSkeleton: React.FC<any>;
vi.mock('@/components/ui/skeleton', () => {
  MockSkeleton = (props: any) => React.createElement('div', props);
  return { Skeleton: MockSkeleton };
});

const { AdminGuard } = await import('@/components/auth/AdminGuard');

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderGuard(children: React.ReactNode = React.createElement('span', { 'data-testid': 'child' }, 'admin content')) {
  return AdminGuard({ children }) as React.ReactElement | null;
}

function findAllByType(el: unknown, type: unknown): React.ReactElement[] {
  if (!el || typeof el !== 'object') return [];
  const rEl = el as React.ReactElement;
  const results: React.ReactElement[] = [];
  if (rEl.type === type) results.push(rEl);
  const children = (rEl.props as Record<string, unknown>)?.children;
  if (children) {
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) {
      results.push(...findAllByType(child, type));
    }
  }
  return results;
}

function findByTestId(el: React.ReactElement | null | undefined, testId: string): React.ReactElement | null {
  if (!el || typeof el !== 'object') return null;
  const props = (el as React.ReactElement).props as Record<string, unknown>;
  if (props?.['data-testid'] === testId) return el as React.ReactElement;
  const children = props?.children;
  if (!children) return null;
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    const found = findByTestId(child as React.ReactElement, testId);
    if (found) return found;
  }
  return null;
}

function getNavigateTo(result: React.ReactElement | null): string | null {
  const navs = findAllByType(result, MockNavigate);
  if (navs.length === 0) return null;
  return (navs[0].props as Record<string, unknown>).to as string;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminGuard', () => {
  beforeEach(() => {
    _user = null;
    _isLoading = false;
  });

  it('redirects to /admin/login when user is null', () => {
    _user = null;
    const result = renderGuard();
    expect(getNavigateTo(result)).toBe('/admin/login');
  });

  it('redirects reviewer to /swipe', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderGuard();
    expect(getNavigateTo(result)).toBe('/swipe');
  });

  it('renders children for admin user', () => {
    _user = { id: 2, email: 'a@test.com', first_name: 'A', last_name: 'A', role: 'admin' };
    const result = renderGuard();

    // No redirect
    expect(getNavigateTo(result)).toBeNull();
    // Children are present
    const child = findByTestId(result, 'child');
    expect(child).not.toBeNull();
  });

  it('shows skeleton while loading instead of redirecting', () => {
    _user = null;
    _isLoading = true;
    const result = renderGuard();

    expect(findAllByType(result, MockSkeleton).length).toBeGreaterThan(0);
    expect(findAllByType(result, MockNavigate).length).toBe(0);
  });
});
