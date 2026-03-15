/**
 * SwipeActions component tests.
 *
 * SwipeActions is a pure presentational component — it receives four props:
 *   onConfirm, onReject, onIdk, isSubmitting
 *
 * Tests verify:
 *   1. Three buttons are rendered (reject, idk, confirm)
 *   2. All buttons are disabled when isSubmitting=true
 *   3. Each button calls its respective callback when clicked
 *
 * Button clicks are simulated by reading the `onClick` prop from the returned
 * React element tree and invoking it directly, avoiding the need for a DOM.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// ── Mock @/components/ui/button ───────────────────────────────────────────────
// Replace shadcn Button with a native <button> so we can inspect props easily.

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    className?: string;
  }) =>
    React.createElement(
      'button',
      {
        'data-testid': 'button',
        'data-variant': variant,
        'data-disabled': disabled,
        onClick,
        disabled,
        className,
      },
      children
    ),
}));

const { SwipeActions } = await import('@/components/swipe/SwipeActions');

// ── Helpers ───────────────────────────────────────────────────────────────────

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

interface SwipeActionsProps {
  onConfirm: () => void;
  onReject: () => void;
  onIdk: () => void;
  isSubmitting: boolean;
}

function renderActions(props: SwipeActionsProps) {
  return SwipeActions(props) as React.ReactElement;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SwipeActions', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;
  let onIdk: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn();
    onReject = vi.fn();
    onIdk = vi.fn();
  });

  it('renders exactly 3 buttons', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, isSubmitting: false });
    const buttons = findAllByTestId(result, 'button');
    expect(buttons).toHaveLength(3);
  });

  it('all buttons are enabled when isSubmitting=false', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, isSubmitting: false });
    const buttons = findAllByTestId(result, 'button');
    const disabledStates = buttons.map((b) => (b.props as Record<string, unknown>).disabled);
    expect(disabledStates.every((d) => !d)).toBe(true);
  });

  it('all buttons are disabled when isSubmitting=true', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, isSubmitting: true });
    const buttons = findAllByTestId(result, 'button');
    expect(buttons).toHaveLength(3);
    const disabledStates = buttons.map((b) => (b.props as Record<string, unknown>).disabled);
    expect(disabledStates.every(Boolean)).toBe(true);
  });

  it('reject button (destructive variant) calls onReject', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, isSubmitting: false });
    const buttons = findAllByTestId(result, 'button');
    const rejectBtn = buttons.find((b) => (b.props as Record<string, unknown>)['data-variant'] === 'destructive');
    expect(rejectBtn).toBeDefined();
    (rejectBtn!.props as Record<string, unknown>).onClick?.();
    expect(onReject).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onIdk).not.toHaveBeenCalled();
  });

  it('outline (IDK) button calls onIdk', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, isSubmitting: false });
    const buttons = findAllByTestId(result, 'button');
    const idkBtn = buttons.find((b) => (b.props as Record<string, unknown>)['data-variant'] === 'outline');
    expect(idkBtn).toBeDefined();
    (idkBtn!.props as Record<string, unknown>).onClick?.();
    expect(onIdk).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm button (no variant / default) calls onConfirm', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, isSubmitting: false });
    const buttons = findAllByTestId(result, 'button');
    // The confirm button has no variant prop (uses default Button styling)
    const confirmBtn = buttons.find(
      (b) =>
        (b.props as Record<string, unknown>)['data-variant'] !== 'destructive' &&
        (b.props as Record<string, unknown>)['data-variant'] !== 'outline'
    );
    expect(confirmBtn).toBeDefined();
    (confirmBtn!.props as Record<string, unknown>).onClick?.();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(onIdk).not.toHaveBeenCalled();
  });
});
