/**
 * Frontend test setup file.
 *
 * @testing-library/react and jsdom are NOT installed, so these tests operate
 * at the module/logic level using vi.mock. This file establishes shared mock
 * factories that individual test files can import and configure.
 *
 * If @testing-library/react + jsdom are added in the future, replace the mock
 * stubs here with proper RTL wrappers and extend the tests accordingly.
 */

import { vi } from 'vitest';

// ── react-router-dom stubs ────────────────────────────────────────────────────
// Provide minimal stubs for router primitives used by the components under test.

export const mockNavigate = vi.fn();
export const mockUseLocation = vi.fn(() => ({ pathname: '/' }));

/** Factory to create a Navigate stub that records where it would redirect. */
export function makeNavigateStub(recordTo: { to: string | null }) {
  return function NavigateStub({ to }: { to: string }) {
    recordTo.to = to;
    return null;
  };
}

// ── Auth context mock state ───────────────────────────────────────────────────
// Shared mutable object that tests can configure before importing components.

export interface MockAuthState {
  user: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    role: 'reviewer' | 'admin';
  } | null;
  isLoading: boolean;
  logout: ReturnType<typeof vi.fn>;
  refreshUser: ReturnType<typeof vi.fn>;
}

export const mockAuthState: MockAuthState = {
  user: null,
  isLoading: false,
  logout: vi.fn(),
  refreshUser: vi.fn(),
};

/** Helper: configure auth state as a logged-in reviewer. */
export function asReviewer() {
  mockAuthState.user = {
    id: 1,
    email: 'reviewer@test.com',
    first_name: 'Test',
    last_name: 'Reviewer',
    role: 'reviewer',
  };
  mockAuthState.isLoading = false;
}

/** Helper: configure auth state as a logged-in admin. */
export function asAdmin() {
  mockAuthState.user = {
    id: 2,
    email: 'admin@test.com',
    first_name: 'Test',
    last_name: 'Admin',
    role: 'admin',
  };
  mockAuthState.isLoading = false;
}

/** Helper: configure auth state as loading (not yet resolved). */
export function asLoading() {
  mockAuthState.user = null;
  mockAuthState.isLoading = true;
}

/** Helper: configure auth state as unauthenticated. */
export function asUnauthenticated() {
  mockAuthState.user = null;
  mockAuthState.isLoading = false;
}
