/**
 * BottomNav component tests.
 *
 * BottomNav uses useCurrentUser() (which calls useAuth().user) to decide
 * whether to include the Admin tab. The component returns a <nav> containing
 * NavLink elements built from the navItems array.
 *
 * We call the component as a plain function and count/inspect the NavLink
 * elements in the returned element tree to verify tab counts and labels.
 * NavLink is mocked to a simple element so we can inspect props directly.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// ── Mock dependencies ─────────────────────────────────────────────────────────

let _user: { id: number; email: string; first_name: string; last_name: string; role: 'reviewer' | 'admin' } | null = null;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: _user,
    isLoading: false,
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

// useCurrentUser wraps useAuth().user — mock at the hook level too, since the
// module may be cached independently.
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => _user,
}));

vi.mock('react-router-dom', () => ({
  NavLink: ({ to, children }: { to: string; children: React.ReactNode | ((args: { isActive: boolean }) => React.ReactNode) }) => {
    const content = typeof children === 'function' ? children({ isActive: false }) : children;
    return React.createElement('a', { 'data-testid': 'nav-link', 'data-to': to }, content);
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

const { BottomNav } = await import('@/components/layout/BottomNav');

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNav() {
  return BottomNav({}) as React.ReactElement;
}

/** Collect all elements with a given data-testid from the tree. */
function findAllByTestId(el: React.ReactElement | null | undefined, testId: string): React.ReactElement[] {
  if (!el || typeof el !== 'object') return [];
  const props = (el as React.ReactElement).props as Record<string, unknown>;
  const results: React.ReactElement[] = [];
  if (props?.['data-testid'] === testId) results.push(el as React.ReactElement);
  const children = props?.children;
  if (children) {
    const childArray = Array.isArray(children) ? children : [children];
    for (const child of childArray) {
      results.push(...findAllByTestId(child as React.ReactElement, testId));
    }
  }
  return results;
}

function getNavLinks(result: React.ReactElement) {
  return findAllByTestId(result, 'nav-link');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BottomNav', () => {
  beforeEach(() => {
    _user = null;
  });

  it('renders 3 tabs for a reviewer (no Admin tab)', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderNav();
    const links = getNavLinks(result);
    expect(links).toHaveLength(3);
  });

  it('does not include /admin route for a reviewer', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderNav();
    const links = getNavLinks(result);
    const destinations = links.map((l) => (l.props as Record<string, unknown>)['data-to']);
    expect(destinations).not.toContain('/admin');
  });

  it('renders 4 tabs (including Admin) for an admin user', () => {
    _user = { id: 2, email: 'a@test.com', first_name: 'A', last_name: 'A', role: 'admin' };
    const result = renderNav();
    const links = getNavLinks(result);
    expect(links).toHaveLength(4);
  });

  it('includes /admin route for an admin user', () => {
    _user = { id: 2, email: 'a@test.com', first_name: 'A', last_name: 'A', role: 'admin' };
    const result = renderNav();
    const links = getNavLinks(result);
    const destinations = links.map((l) => (l.props as Record<string, unknown>)['data-to']);
    expect(destinations).toContain('/admin');
  });

  it('always includes /swipe, /classify, and /leaderboard tabs', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderNav();
    const links = getNavLinks(result);
    const destinations = links.map((l) => (l.props as Record<string, unknown>)['data-to']);
    expect(destinations).toContain('/swipe');
    expect(destinations).toContain('/classify');
    expect(destinations).toContain('/leaderboard');
  });
});
