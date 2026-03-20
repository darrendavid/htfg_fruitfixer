/**
 * AuthGuard component tests.
 *
 * Because @testing-library/react and jsdom are not installed, these tests
 * exercise the guard's decision logic by directly calling the component
 * function and inspecting its return value. React's JSX output is a plain
 * object tree, so we can assert on it without a DOM.
 *
 * The three behaviours under test:
 *   1. isLoading=true  → returns a skeleton <div>
 *   2. user=null       → returns a <Navigate to="/login" …> element
 *   3. user present    → passes children through unchanged
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// ── Mock @/contexts/AuthContext before importing the component ────────────────

let _user: object | null = null;
let _isLoading = false;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: _user, isLoading: _isLoading }),
}));

// ── Mock react-router-dom Navigate ───────────────────────────────────────────

let MockNavigate: React.FC<any>;
vi.mock('react-router-dom', () => {
  MockNavigate = (props: any) => React.createElement('div', props);
  return { Navigate: MockNavigate };
});

// ── Mock @/components/ui/skeleton ────────────────────────────────────────────

let MockSkeleton: React.FC<any>;
vi.mock('@/components/ui/skeleton', () => {
  MockSkeleton = (props: any) => React.createElement('div', props);
  return { Skeleton: MockSkeleton };
});

// Import AFTER mocks are registered
const { AuthGuard } = await import('@/components/auth/AuthGuard');

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderGuard(children: React.ReactNode = React.createElement('span', null, 'protected')) {
  return AuthGuard({ children }) as React.ReactElement | null;
}

/** Recursively find elements by their React component type. */
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthGuard', () => {
  beforeEach(() => {
    _user = null;
    _isLoading = false;
  });

  it('renders skeleton elements while auth is loading', () => {
    _isLoading = true;
    const result = renderGuard();

    // The guard returns a wrapper div containing Skeleton components
    expect(result).not.toBeNull();
    const skeletons = findAllByType(result, MockSkeleton);
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('redirects to /login when user is null and not loading', () => {
    _user = null;
    _isLoading = false;
    const result = renderGuard();

    const navs = findAllByType(result, MockNavigate);
    expect(navs.length).toBe(1);
    expect((navs[0].props as Record<string, unknown>).to).toBe('/login');
  });

  it('renders children when user is authenticated', () => {
    _user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'U', role: 'reviewer' };
    _isLoading = false;

    const child = React.createElement('span', { 'data-testid': 'protected-content' }, 'hello');
    const result = renderGuard(child);

    // The fragment wraps children; find the protected-content span
    const found = findByTestId(result, 'protected-content');
    expect(found).not.toBeNull();
  });

  it('does not render Navigate while loading even when user is null', () => {
    _user = null;
    _isLoading = true;
    const result = renderGuard();

    const navs = findAllByType(result, MockNavigate);
    expect(navs.length).toBe(0);
  });
});
