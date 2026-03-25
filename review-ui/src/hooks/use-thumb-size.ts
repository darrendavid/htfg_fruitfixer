import { useState, useEffect } from 'react';

export type ThumbSize = 'lg' | 'md' | 'sm';

const STORAGE_KEY = 'htfg_thumb_size';

function loadThumbSize(): ThumbSize {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === 'lg' || v === 'md' || v === 'sm') return v;
  } catch { /* ignore */ }
  return 'lg';
}

export function useThumbSize() {
  const [thumbSize, setThumbSize] = useState<ThumbSize>(loadThumbSize);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, thumbSize); } catch { /* ignore */ }
  }, [thumbSize]);

  return [thumbSize, setThumbSize] as const;
}
