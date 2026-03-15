import { useState, useCallback } from 'react';
import type { Plant } from '@/types/api';

const STORAGE_KEY = 'htfg_recent_plants';
const MAX_RECENT = 6;

export function useRecentPlants() {
  const [recentPlants, setRecentPlants] = useState<Plant[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const addRecentPlant = useCallback((plant: Plant) => {
    setRecentPlants(prev => {
      const filtered = prev.filter(p => p.id !== plant.id);
      const updated = [plant, ...filtered].slice(0, MAX_RECENT);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  return { recentPlants, addRecentPlant };
}
