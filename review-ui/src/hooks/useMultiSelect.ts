import { useState, useCallback } from 'react';

export type SelectResult = 'range' | 'toggle' | 'plain';

export function useMultiSelect<T, K extends string | number = number>(
  items: T[],
  getKey: (item: T) => K
) {
  const [selectedIds, setSelectedIds] = useState<Set<K>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  const handleClick = useCallback((
    e: React.MouseEvent,
    item: T,
    idx: number
  ): SelectResult => {
    const key = getKey(item);
    if (e.shiftKey && lastClickedIdx !== null) {
      e.preventDefault();
      const lo = Math.min(lastClickedIdx, idx);
      const hi = Math.max(lastClickedIdx, idx);
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const k = getKey(items[i]);
          if (k !== undefined) next.add(k);
        }
        return next;
      });
      return 'range';
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      setLastClickedIdx(idx);
      return 'toggle';
    } else {
      return 'plain';
    }
  }, [lastClickedIdx, items, getKey]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastClickedIdx(null);
  }, []);

  const isSelected = useCallback((key: K) => selectedIds.has(key), [selectedIds]);

  return { selectedIds, lastClickedIdx, setLastClickedIdx, handleClick, clearSelection, isSelected, setSelectedIds };
}
