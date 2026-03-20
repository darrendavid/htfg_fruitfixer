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
// We mock Button as a simple wrapper so we can find it in the element tree.
// When the component function is called directly, React.createElement stores
// the mock function as the element's `type` — it does NOT invoke it.
// We therefore locate Button elements by matching their `type` to the mock.

let MockButton: React.FC<any>;

vi.mock('@/components/ui/button', () => {
  MockButton = (props: any) => React.createElement('button', props);
  return { Button: MockButton };
});

const { SwipeActions } = await import('@/components/swipe/SwipeActions');

// ── Helpers ───────────────────────────────────────────────────────────────────

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

interface SwipeActionsProps {
  onConfirm: () => void;
  onReject: () => void;
  onIdk: () => void;
  onIgnore: () => void;
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
  let onIgnore: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn();
    onReject = vi.fn();
    onIdk = vi.fn();
    onIgnore = vi.fn();
  });

  it('renders exactly 4 buttons (reject, idk, confirm, ignore)', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: false });
    const buttons = findAllByType(result, MockButton);
    expect(buttons).toHaveLength(4);
  });

  it('all buttons are enabled when isSubmitting=false', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: false });
    const buttons = findAllByType(result, MockButton);
    const disabledStates = buttons.map((b) => (b.props as Record<string, unknown>).disabled);
    expect(disabledStates.every((d) => !d)).toBe(true);
  });

  it('all buttons are disabled when isSubmitting=true', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: true });
    const buttons = findAllByType(result, MockButton);
    expect(buttons).toHaveLength(4);
    const disabledStates = buttons.map((b) => (b.props as Record<string, unknown>).disabled);
    expect(disabledStates.every(Boolean)).toBe(true);
  });

  it('reject button (destructive variant) calls onReject', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: false });
    const buttons = findAllByType(result, MockButton);
    const rejectBtn = buttons.find((b) => (b.props as Record<string, unknown>).variant === 'destructive');
    expect(rejectBtn).toBeDefined();
    ((rejectBtn!.props as Record<string, unknown>).onClick as () => void)();
    expect(onReject).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onIdk).not.toHaveBeenCalled();
  });

  it('outline (IDK) button calls onIdk', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: false });
    const buttons = findAllByType(result, MockButton);
    const idkBtn = buttons.find((b) => (b.props as Record<string, unknown>).variant === 'outline');
    expect(idkBtn).toBeDefined();
    ((idkBtn!.props as Record<string, unknown>).onClick as () => void)();
    expect(onIdk).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignore button (ghost variant) calls onIgnore', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: false });
    const buttons = findAllByType(result, MockButton);
    const ignoreBtn = buttons.find((b) => (b.props as Record<string, unknown>).variant === 'ghost');
    expect(ignoreBtn).toBeDefined();
    ((ignoreBtn!.props as Record<string, unknown>).onClick as () => void)();
    expect(onIgnore).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onIdk).not.toHaveBeenCalled();
  });

  it('confirm button (no variant / default) calls onConfirm', () => {
    const result = renderActions({ onConfirm, onReject, onIdk, onIgnore, isSubmitting: false });
    const buttons = findAllByType(result, MockButton);
    // The confirm button has no variant prop (uses default Button styling)
    const confirmBtn = buttons.find(
      (b) =>
        (b.props as Record<string, unknown>).variant !== 'destructive' &&
        (b.props as Record<string, unknown>).variant !== 'outline' &&
        (b.props as Record<string, unknown>).variant !== 'ghost'
    );
    expect(confirmBtn).toBeDefined();
    ((confirmBtn!.props as Record<string, unknown>).onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(onIdk).not.toHaveBeenCalled();
  });
});
