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
// We capture the `to` prop to verify the redirect destination.

vi.mock('react-router-dom', () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) =>
    React.createElement('div', { 'data-testid': 'navigate', 'data-to': to, 'data-replace': replace }),
}));

// ── Mock @/components/ui/skeleton ────────────────────────────────────────────

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement('div', { 'data-testid': 'skeleton', className }),
}));

// Import AFTER mocks are registered
const { AuthGuard } = await import('@/components/auth/AuthGuard');

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderGuard(children: React.ReactNode = React.createElement('span', null, 'protected')) {
  // Call the component as a plain function — valid for functional components.
  return AuthGuard({ children }) as React.ReactElement | null;
}

/** Recursively search a React element tree for a node with a given data-testid. */
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
    const skeleton = findByTestId(result, 'skeleton');
    expect(skeleton).not.toBeNull();
  });

  it('redirects to /login when user is null and not loading', () => {
    _user = null;
    _isLoading = false;
    const result = renderGuard();

    const nav = findByTestId(result, 'navigate');
    expect(nav).not.toBeNull();
    expect((nav!.props as Record<string, unknown>)['data-to']).toBe('/login');
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

    const nav = findByTestId(result, 'navigate');
    expect(nav).toBeNull();
  });
});
