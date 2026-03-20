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

let MockNavLink: React.FC<any>;

vi.mock('react-router-dom', () => {
  MockNavLink = (props: any) => React.createElement('a', props);
  return { NavLink: MockNavLink };
});

vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

const { BottomNav } = await import('@/components/layout/BottomNav');

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNav() {
  return BottomNav({}) as React.ReactElement;
}

/** Recursively collect all elements whose `type` matches the given component function. */
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

function getNavLinks(result: React.ReactElement) {
  return findAllByType(result, MockNavLink);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BottomNav', () => {
  beforeEach(() => {
    _user = null;
  });

  it('renders 5 tabs for a reviewer (no Admin tab)', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderNav();
    const links = getNavLinks(result);
    expect(links).toHaveLength(5);
  });

  it('does not include /admin route for a reviewer', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderNav();
    const links = getNavLinks(result);
    const destinations = links.map((l) => (l.props as Record<string, unknown>).to);
    expect(destinations).not.toContain('/admin');
  });

  it('renders 6 tabs (including Admin) for an admin user', () => {
    _user = { id: 2, email: 'a@test.com', first_name: 'A', last_name: 'A', role: 'admin' };
    const result = renderNav();
    const links = getNavLinks(result);
    expect(links).toHaveLength(6);
  });

  it('includes /admin route for an admin user', () => {
    _user = { id: 2, email: 'a@test.com', first_name: 'A', last_name: 'A', role: 'admin' };
    const result = renderNav();
    const links = getNavLinks(result);
    const destinations = links.map((l) => (l.props as Record<string, unknown>).to);
    expect(destinations).toContain('/admin');
  });

  it('always includes /swipe, /classify, /ocr-review, /plants, and /leaderboard tabs', () => {
    _user = { id: 1, email: 'r@test.com', first_name: 'R', last_name: 'R', role: 'reviewer' };
    const result = renderNav();
    const links = getNavLinks(result);
    const destinations = links.map((l) => (l.props as Record<string, unknown>).to);
    expect(destinations).toContain('/swipe');
    expect(destinations).toContain('/classify');
    expect(destinations).toContain('/ocr-review');
    expect(destinations).toContain('/plants');
    expect(destinations).toContain('/leaderboard');
  });
});
